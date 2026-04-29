// 云函数 - export (数据导出 v2: 按月/按年/按订单 × 汇总/细节) — 已统一北京时间
const cloud = require('wx-server-sdk')
const bjTime = require('./beijing-time')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const XLSX = require('xlsx')

// ---- 公共工具 ----

async function getCallerUser(wxContext) {
  const res = await db.collection('Users').where({
    openid: wxContext.OPENID,
    status: 'active'
  }).get()
  return res.data.length > 0 ? res.data[0] : null
}

async function getCallerUserByEvent(event, wxContext) {
  const authUserId = event && event.auth_user_id
  const authSessionToken = event && event.auth_session_token
  if (authUserId && authSessionToken) {
    try {
      const res = await db.collection('Users').where({
        _id: authUserId,
        session_token: authSessionToken,
        status: 'active'
      }).limit(1).get()
      if (res.data.length > 0) {
        const user = res.data[0]
        if (user.org_id) {
          const orgRes = await db.collection('Organizations').doc(user.org_id).get()
          if (!orgRes.data || orgRes.data.status !== 'active') return null
        }
        return user
      }
    } catch (e) {}
  }
  return await getCallerUser(wxContext)
}

function getOrgId(user) {
  return user && user.org_id ? user.org_id : ''
}

/** 分页拉取全量数据 */
async function fetchAll(collectionName, where, options = {}) {
  const orderBy = options.orderBy || null
  const pageSize = 100
  let all = [], batchLen = 0
  do {
    let q = db.collection(collectionName).where(where)
    if (orderBy) q = q.orderBy(orderBy.field, orderBy.order || 'asc')
    const res = await q.skip(all.length).limit(pageSize).get()
    batchLen = (res.data || []).length
    all = all.concat(res.data || [])
  } while (batchLen === pageSize)
  return all
}

function getMonthRange(monthStr) {
  return bjTime.getBeijingMonthRange(monthStr)
}

function getYearRange(yearStr) {
  return bjTime.getBeijingYearRange(yearStr)
}

function pad2(n) { return String(n).padStart(2, '0') }

function formatTs(input) {
  if (!input) return ''
  var ts = bjTime.toUTCTimestamp(input)
  if (!ts) return ''
  return bjTime.formatBeijingDateTime(ts)
}

function round2(n) { return Math.round((n || 0) * 100) / 100 }

/** 清理 Excel Sheet 名称中的非法字符 */
function sanitizeSheetName(name) {
  return String(name || '报表').replace(/[:\\\/?*\[\]]/g, '-').substring(0, 31)
}

// ---- 数据获取：按时间范围通用 ----

async function getWorkLogs(dateWhere, orgId) {
  return await fetchAll('WorkLogs', Object.assign({ org_id: orgId }, dateWhere), { orderBy: { field: 'created_at', order: 'desc' } })
}

async function getActiveUsers(orgId) {
  return await fetchAll('Users', { org_id: orgId, role: _.in(['employee', 'qc']), status: 'active' })
}

async function getAdjustments(userId, monthList, orgId) {
  // monthList: 如 ['2026-01', '2026-02', ...] 或单个月 'YYYY-MM'
  if (Array.isArray(monthList)) {
    return await fetchAll('SalaryAdjustments', { org_id: orgId, user_id: userId, month: _.in(monthList) })
  }
  return await fetchAll('SalaryAdjustments', { org_id: orgId, user_id: userId, month: monthList })
}

async function getAttendances(userId, dateWhere, orgId) {
  return await fetchAll('Attendances', Object.assign({ org_id: orgId, user_id: userId }, dateWhere))
}

// ---- 汇总型数据表 (按月/按年) ----

async function buildSummaryByDateRange(startDate, endDate, label, monthsForAdj, orgId) {
  const users = await getActiveUsers(orgId)
  const logs = await getWorkLogs({ date: _.gte(startDate).and(_.lt(endDate)) }, orgId)

  // 按 user_id 分组
  const userLogMap = {}
  logs.forEach(l => {
    const uid = l.user_id || ''
    if (!userLogMap[uid]) userLogMap[uid] = []
    userLogMap[uid].push(l)
  })

  const headers = ['姓名', '角色', '入厂时间', '出勤天数', '工时(小时)', '报工数量',
    '参与订单数', '计件工资(元)', '奖励(元)', '处罚(元)', '应发工资(元)']
  const rows = []

  for (const user of users) {
    const uLogs = userLogMap[user._id] || []
    let pieceRate = 0, totalQty = 0
    const orderSet = new Set()
    uLogs.forEach(l => {
      pieceRate += round2((l.quantity || 0) * (l.snapshot_price || 0))
      totalQty += l.quantity || 0
      if (l.order_id) orderSet.add(l.order_id)
    })

    const adjs = await getAdjustments(user._id, monthsForAdj, orgId)
    let reward = 0, penalty = 0
    adjs.forEach(a => { if (a.type === 'reward') reward += a.amount || 0; else penalty += a.amount || 0 })

    const atts = await getAttendances(user._id, { date: _.gte(startDate).and(_.lt(endDate)) }, orgId)
    let hours = 0, days = 0
    atts.forEach(a => { hours += a.hours || 0; if (a.clock_in_time) days++ })

    const total = Math.max(0, round2(pieceRate + reward - penalty))

    rows.push([
      user.name,
      user.role === 'employee' ? '员工' : '质检员',
      user.join_date || '未设置',
      days,
      Math.round(hours * 10) / 10,
      totalQty,
      orderSet.size,
      round2(pieceRate),
      reward,
      penalty,
      total
    ])
  }

  return { headers, rows, title: `${label} 员工汇总报表` }
}

// ---- 细节型数据表 (按月/按年) ----

async function buildDetailByDateRange(startDate, endDate, label, orgId) {
  const logs = await getWorkLogs({ date: _.gte(startDate).and(_.lt(endDate)) }, orgId)

  const headers = ['员工', '订单名称', '工序名称', '报工数量', '单价(元)',
    '小计薪资(元)', '报工时间', '所属月份', '备注']
  const rows = logs.map(l => ([
    l.user_name || '',
    l.order_name || '',
    l.process_name || '',
    l.quantity || 0,
    l.snapshot_price || 0,
    round2((l.quantity || 0) * (l.snapshot_price || 0)),
    formatTs(l.created_at) || l.date || '',
    l.date ? l.date.substring(0, 7) : '',
    l.note || l.remark || ''
  ]))

  return { headers, rows, title: `${label} 报工明细表` }
}

// ---- 按订单 汇总 ----

async function buildSummaryByOrder(orderId, orgId) {
  const orderRes = await db.collection('Orders').doc(orderId).get()
  const order = orderRes.data
  if (!order || order.org_id !== orgId) return null
  const logs = await fetchAll('WorkLogs', { org_id: orgId, order_id: orderId })

  // 按员工聚合
  const userMap = {}
  logs.forEach(l => {
    const uid = l.user_id || 'unknown'
    if (!userMap[uid]) {
      userMap[uid] = { name: l.user_name || '未知', totalQty: 0, totalSalary: 0 }
    }
    userMap[uid].totalQty += l.quantity || 0
    userMap[uid].totalSalary += round2((l.quantity || 0) * (l.snapshot_price || 0))
  })

  const headers = ['员工', '报工数量', '计件薪资(元)']
  const rows = Object.values(userMap).map(u => ([
    u.name,
    u.totalQty,
    round2(u.totalSalary)
  ]))

  return { headers, rows, title: `订单-${order.order_name} 员工汇总` }
}

// ---- 按订单 细节 ----

async function buildDetailByOrder(orderId, orgId) {
  const orderRes = await db.collection('Orders').doc(orderId).get()
  const order = orderRes.data
  if (!order || order.org_id !== orgId) return null
  const logs = await fetchAll('WorkLogs', { org_id: orgId, order_id: orderId }, { orderBy: { field: 'created_at', order: 'desc' } })

  const headers = ['员工', '工序名称', '报工数量', '单价(元)', '小计薪资(元)', '报工时间', '备注']
  const rows = logs.map(l => ([
    l.user_name || '',
    l.process_name || '',
    l.quantity || 0,
    l.snapshot_price || 0,
    round2((l.quantity || 0) * (l.snapshot_price || 0)),
    formatTs(l.created_at) || l.date || '',
    l.note || l.remark || ''
  ]))

  return { headers, rows, title: `订单-${order.order_name} 报工明细` }
}

// ---- 月份列表工具 ----
function getMonthsInYear(yearStr) {
  const y = parseInt(yearStr)
  const months = []
  for (let m = 1; m <= 12; m++) months.push(`${y}-${pad2(m)}`)
  return months
}

// ---- 统一数据调度 ----

async function fetchReportDataV2(dimension, reportType, params) {
  const orgId = params.orgId
  if (dimension === 'month') {
    const { startDate, endDate, month: monthStr } = getMonthRange(params.month)
    if (reportType === 'summary') {
      return await buildSummaryByDateRange(startDate, endDate, `${monthStr}`, monthStr, orgId)
    } else {
      return await buildDetailByDateRange(startDate, endDate, `${monthStr}`, orgId)
    }
  }

  if (dimension === 'year') {
    const { startDate, endDate, year } = getYearRange(params.year)
    const months = getMonthsInYear(year)
    if (reportType === 'summary') {
      return await buildSummaryByDateRange(startDate, endDate, `${year}年`, months, orgId)
    } else {
      return await buildDetailByDateRange(startDate, endDate, `${year}年`, orgId)
    }
  }

  if (dimension === 'order') {
    if (!params.order_id) return null
    if (reportType === 'summary') {
      return await buildSummaryByOrder(params.order_id, orgId)
    } else {
      return await buildDetailByOrder(params.order_id, orgId)
    }
  }

  return null
}

// ---- 兼容旧接口的数据获取 (保留原有 export_type 逻辑) ----

async function fetchReportDataLegacy(export_type, startDate, endDate, monthStr, orgId) {
  switch (export_type) {
    case 'salary': {
      return await buildSummaryByDateRange(startDate, endDate, monthStr, monthStr, orgId)
    }
    case 'worklog': {
      return await buildDetailByDateRange(startDate, endDate, monthStr, orgId)
    }
    default:
      return null
  }
}

/** 将 { headers, rows } 转为 XLSX workbook */
function buildWorkbook(tableData, sheetName) {
  const aoa = [tableData.headers, ...tableData.rows]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(aoa)

  // 设置列宽
  const colWidths = tableData.headers.map((h, i) => {
    let maxLen = h.length
    tableData.rows.forEach(r => {
      const cellLen = String(r[i] || '').length
      if (cellLen > maxLen) maxLen = cellLen
    })
    return { wch: Math.min(Math.max(maxLen + 2, 8), 40) }
  })
  ws['!cols'] = colWidths

  XLSX.utils.book_append_sheet(wb, ws, sanitizeSheetName(sheetName))
  return wb
}

// ---- Actions ----

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  switch (action) {
    case 'getTableData': return await getTableData(event, wxContext)
    case 'getTableDataV2': return await getTableDataV2(event, wxContext)
    case 'exportToFile':  return await exportToFile(event, wxContext)
    case 'exportToFileV2': return await exportToFileV2(event, wxContext)
    case 'getHistory':    return await getHistory(event, wxContext)
    case 'getOrderList':  return await getOrderList(event, wxContext)
    case 'exportProcessSummary': return await exportProcessSummary(event, wxContext)
    default: return { code: -1, msg: '未知操作' }
  }
}

/** 获取订单列表（供前端选择器使用） */
async function getOrderList(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }
  try {
    const orders = await fetchAll('Orders', { org_id: getOrgId(caller) }, { orderBy: { field: 'created_at', order: 'desc' } })
    const list = orders.map(o => ({
      _id: o._id,
      order_name: o.order_name,
      status: o.status,
      total_quantity: o.total_quantity || 0
    }))
    return { code: 0, data: list }
  } catch (err) {
    return { code: -1, msg: '获取订单列表失败' }
  }
}

/** V2: 获取报表数据（按维度+报表类型） */
async function getTableDataV2(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }

  const { dimension, report_type, month, year, order_id } = event

  try {
    const tableData = await fetchReportDataV2(dimension, report_type, { month, year, order_id, orgId: getOrgId(caller) })
    if (!tableData) return { code: -1, msg: '未找到数据或参数错误' }

    return {
      code: 0,
      data: {
        headers: tableData.headers,
        rows: tableData.rows,
        title: tableData.title
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取数据失败: ' + err.message }
  }
}

/** V2: 导出文件（按维度+报表类型） */
async function exportToFileV2(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }

  const { dimension, report_type, month, year, order_id } = event

  try {
    const tableData = await fetchReportDataV2(dimension, report_type, { month, year, order_id, orgId: getOrgId(caller) })
    if (!tableData) return { code: -1, msg: '未找到数据或参数错误' }

    // 生成文件名
    const typeLabel = report_type === 'summary' ? '汇总表' : '明细表'
    let dimLabel = ''
    if (dimension === 'month') dimLabel = month || '当月'
    else if (dimension === 'year') dimLabel = (year || '当年') + '年'
    else if (dimension === 'order') dimLabel = '订单'
    const filename = `${dimLabel}_${typeLabel}_${Date.now()}.xlsx`

    const workbook = buildWorkbook(tableData, tableData.title || '报表')
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })

    const uploadRes = await cloud.uploadFile({
      cloudPath: `exports/${filename}`,
      fileContent: buffer
    })

    const urlRes = await cloud.getTempFileURL({ fileList: [uploadRes.fileID] })
    const tempUrl = (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) || ''

    await db.collection('export_history').add({
      data: {
        dimension,
        org_id: getOrgId(caller),
        report_type,
        month: month || '',
        year: year || '',
        order_id: order_id || '',
        filename,
        file_id: uploadRes.fileID,
        title: tableData.title,
        row_count: tableData.rows.length,
        operator_id: caller._id,
        operator_name: caller.name,
        created_at: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: '导出成功',
      data: {
        file_id: uploadRes.fileID,
        temp_url: tempUrl,
        filename
      }
    }
  } catch (err) {
    return { code: -1, msg: '导出失败: ' + err.message }
  }
}

/**
 * getTableData — 兼容旧版前端（保留原接口）
 */
async function getTableData(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }

  const { export_type, month } = event
  const { startDate, endDate, month: monthStr } = getMonthRange(month)

  try {
    const tableData = await fetchReportDataLegacy(export_type, startDate, endDate, monthStr, getOrgId(caller))
    if (!tableData) return { code: -1, msg: '未知导出类型' }
    return { code: 0, data: { headers: tableData.headers, rows: tableData.rows, title: tableData.title } }
  } catch (err) {
    return { code: -1, msg: '获取数据失败: ' + err.message }
  }
}

/**
 * exportToFile — 兼容旧版前端
 */
async function exportToFile(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }

  const { export_type, month } = event
  const { startDate, endDate, month: monthStr } = getMonthRange(month)

  try {
    const tableData = await fetchReportDataLegacy(export_type, startDate, endDate, monthStr, getOrgId(caller))
    if (!tableData) return { code: -1, msg: '未知导出类型' }

    const filename = `${export_type}_${monthStr}_${Date.now()}.xlsx`
    const workbook = buildWorkbook(tableData, tableData.title || export_type)
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })

    const uploadRes = await cloud.uploadFile({
      cloudPath: `exports/${filename}`,
      fileContent: buffer
    })
    const urlRes = await cloud.getTempFileURL({ fileList: [uploadRes.fileID] })
    const tempUrl = (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) || ''

    await db.collection('export_history').add({
      data: {
        org_id: getOrgId(caller),
        export_type, month: monthStr, filename,
        file_id: uploadRes.fileID, status: 'downloaded',
        operator_id: caller._id, operator_name: caller.name,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '导出成功', data: { file_id: uploadRes.fileID, temp_url: tempUrl } }
  } catch (err) {
    return { code: -1, msg: '导出失败: ' + err.message }
  }
}

/**
 * getHistory — 获取导出历史记录
 */
async function getHistory(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }

  try {
    const res = await db.collection('export_history')
      .where({ org_id: getOrgId(caller) })
      .orderBy('created_at', 'desc')
      .limit(20)
      .get()
    return { code: 0, data: res.data }
  } catch (err) {
    return { code: -1, msg: '获取历史失败' }
  }
}

/** 导出工序汇总表（订单详情页使用） */
async function exportProcessSummary(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }

  const { order_id } = event
  if (!order_id) return { code: -1, msg: '缺少订单ID' }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    const order = orderRes.data
    if (!order || order.org_id !== getOrgId(caller)) return { code: -1, msg: '订单不存在' }

    const processes = await fetchAll('Processes', { org_id: getOrgId(caller), order_id }, { orderBy: { field: 'created_at', order: 'asc' } })

    const headers = ['序号', '工序名称', '工价(元/件)', '备注']
    const rows = processes.map((p, i) => ([
      i + 1,
      p.process_name || '',
      p.current_price != null ? p.current_price : '未设置',
      p.note || ''
    ]))

    const title = `${order.order_name || '订单'} 工序汇总`
    const tableData = { headers, rows, title }

    const filename = `工序汇总_${sanitizeSheetName(order.order_name || order_id)}_${Date.now()}.xlsx`
    const workbook = buildWorkbook(tableData, title)
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })

    const uploadRes = await cloud.uploadFile({
      cloudPath: `exports/${filename}`,
      fileContent: buffer
    })

    return {
      code: 0,
      msg: '导出成功',
      data: {
        file_id: uploadRes.fileID,
        filename
      }
    }
  } catch (err) {
    return { code: -1, msg: '导出失败: ' + err.message }
  }
}
