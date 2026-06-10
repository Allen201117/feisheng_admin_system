// 云函数 - export (数据导出 v2: 按月/按年/按订单 × 汇总/细节) — 已统一北京时间
const cloud = require('wx-server-sdk')
const bjTime = require('./beijing-time')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const XLSX = require('xlsx')
const { buildOrderMatrix } = require('./order-matrix.logic')

// ---- 公共工具 ----


const authGuard = require('./auth-guard')

// 统一鉴权（见 auth-guard.js）：必须携带有效 token，工厂 status=active，失败一律拒绝。
async function getCallerUserByEvent(event, wxContext) {
  return await authGuard.getCallerUserByEvent(db, event)
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

// 批量取整段时间的奖惩/考勤（避免按员工 N+1 查库），内存按 user_id 分组
async function getAdjustmentsGrouped(monthList, orgId) {
  const where = Array.isArray(monthList)
    ? { org_id: orgId, month: _.in(monthList) }
    : { org_id: orgId, month: monthList }
  const all = await fetchAll('SalaryAdjustments', where)
  return groupByUserId(all)
}

async function getAttendancesGrouped(dateWhere, orgId) {
  const all = await fetchAll('Attendances', Object.assign({ org_id: orgId }, dateWhere))
  return groupByUserId(all)
}

function groupByUserId(list) {
  const map = {}
  ;(list || []).forEach((item) => {
    const uid = item.user_id || ''
    if (!map[uid]) map[uid] = []
    map[uid].push(item)
  })
  return map
}

// 实时工价 join（CLAUDE.md §2.9）：按 process_id 批量取 Processes.current_price
async function buildCurrentPriceMap(logs, orgId) {
  const processIds = Array.from(new Set((logs || []).map(l => l.process_id).filter(Boolean)))
  const priceMap = {}
  for (let i = 0; i < processIds.length; i += 50) {
    const chunk = processIds.slice(i, i + 50)
    const res = await fetchAll('Processes', { org_id: orgId, _id: _.in(chunk) })
    res.forEach(p => { priceMap[String(p._id)] = p.current_price != null ? p.current_price : null })
  }
  return priceMap
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

  // 批量取奖惩/考勤后内存分组，避免按员工 N+1 查库
  const [adjMap, attMap] = await Promise.all([
    getAdjustmentsGrouped(monthsForAdj, orgId),
    getAttendancesGrouped({ date: _.gte(startDate).and(_.lt(endDate)) }, orgId)
  ])

  let sumDays = 0, sumHours = 0, sumQty = 0, sumPiece = 0, sumReward = 0, sumPenalty = 0, sumTotal = 0

  for (const user of users) {
    const uLogs = userLogMap[user._id] || []
    let pieceRate = 0, totalQty = 0
    const orderSet = new Set()
    uLogs.forEach(l => {
      pieceRate += round2((l.quantity || 0) * (l.snapshot_price || 0))
      totalQty += l.quantity || 0
      if (l.order_id) orderSet.add(l.order_id)
    })

    const adjs = adjMap[user._id] || []
    let reward = 0, penalty = 0
    adjs.forEach(a => { if (a.type === 'reward') reward += a.amount || 0; else penalty += a.amount || 0 })

    const atts = attMap[user._id] || []
    let hours = 0, days = 0
    atts.forEach(a => { hours += a.hours || 0; if (a.clock_in_time) days++ })

    const total = Math.max(0, round2(pieceRate + reward - penalty))
    sumDays += days
    sumHours += hours
    sumQty += totalQty
    sumPiece += pieceRate
    sumReward += reward
    sumPenalty += penalty
    sumTotal += total

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

  rows.push(['合计', '', '', sumDays, Math.round(sumHours * 10) / 10, sumQty, '',
    round2(sumPiece), round2(sumReward), round2(sumPenalty), round2(sumTotal)])

  return { headers, rows, title: `${label} 工资核算表` }
}

// ---- 细节型数据表 (按月/按年) ----

async function buildDetailByDateRange(startDate, endDate, label, orgId) {
  const logs = await getWorkLogs({ date: _.gte(startDate).and(_.lt(endDate)) }, orgId)

  // 实时工价（CLAUDE.md §2.9）：结算按 snapshot_price，当前价仅展示
  const priceMap = await buildCurrentPriceMap(logs, orgId)

  const headers = ['员工', '订单名称', '工序名称', '报工数量', '结算单价(元)', '当前工价(元)',
    '小计薪资(元)', '报工时间', '所属月份', '备注']
  const rows = logs.map(l => {
    const currentPrice = l.process_id != null ? priceMap[String(l.process_id)] : null
    return [
      l.user_name || '',
      l.order_name || '',
      l.process_name || '',
      l.quantity || 0,
      l.snapshot_price || 0,
      currentPrice != null ? currentPrice : '—',
      round2((l.quantity || 0) * (l.snapshot_price || 0)),
      formatTs(l.created_at) || l.date || '',
      l.date ? l.date.substring(0, 7) : '',
      l.note || l.remark || ''
    ]
  })

  return { headers, rows, title: `${label} 报工明细表` }
}

// ---- 按订单 汇总 ----

// 订单工资核算表：每个员工一行（报工数量/计件工资/奖励/处罚/应发），含合计行
async function buildSummaryByOrder(orderId, orgId) {
  const orderRes = await db.collection('Orders').doc(orderId).get()
  const order = orderRes.data
  if (!order || order.org_id !== orgId) return null
  const logs = await fetchAll('WorkLogs', { org_id: orgId, order_id: orderId })
  const adjustments = await fetchAll('SalaryAdjustments', { org_id: orgId, order_id: orderId })

  // 按员工聚合（含只有奖惩没有报工的员工）
  const userMap = {}
  const ensureUser = (uid, name) => {
    if (!userMap[uid]) {
      userMap[uid] = { name: name || '未知', totalQty: 0, totalSalary: 0, reward: 0, penalty: 0 }
    }
    return userMap[uid]
  }
  logs.forEach(l => {
    const u = ensureUser(l.user_id || 'unknown', l.user_name)
    u.totalQty += l.quantity || 0
    u.totalSalary += round2((l.quantity || 0) * (l.snapshot_price || 0))
  })
  adjustments.forEach(a => {
    const u = ensureUser(a.user_id || 'unknown', a.user_name)
    if (a.type === 'reward') u.reward += a.amount || 0
    else u.penalty += a.amount || 0
  })

  const headers = ['员工', '报工数量', '计件工资(元)', '奖励(元)', '处罚(元)', '应发工资(元)']
  let sumQty = 0, sumSalary = 0, sumReward = 0, sumPenalty = 0, sumTotal = 0
  const rows = Object.values(userMap)
    .sort((a, b) => String(a.name).localeCompare(String(b.name), 'zh-Hans-CN'))
    .map(u => {
      const total = Math.max(0, round2(u.totalSalary + u.reward - u.penalty))
      sumQty += u.totalQty
      sumSalary += u.totalSalary
      sumReward += u.reward
      sumPenalty += u.penalty
      sumTotal += total
      return [u.name, u.totalQty, round2(u.totalSalary), round2(u.reward), round2(u.penalty), total]
    })
  rows.push(['合计', sumQty, round2(sumSalary), round2(sumReward), round2(sumPenalty), round2(sumTotal)])

  return { headers, rows, title: `订单-${order.order_name} 工资核算表` }
}

// ---- 按订单 细节（计件核算表 / 矩阵：工序为行，员工拆数量|金额两列）----

async function buildDetailByOrder(orderId, orgId) {
  const orderRes = await db.collection('Orders').doc(orderId).get()
  const order = orderRes.data
  if (!order || order.org_id !== orgId) return null
  const logs = await fetchAll('WorkLogs', { org_id: orgId, order_id: orderId }, { orderBy: { field: 'created_at', order: 'asc' } })
  // 取工序以确定行顺序与工价（工价显示在工序单元格括号内）
  const processes = await fetchAll('Processes', { org_id: orgId, order_id: orderId }, { orderBy: { field: 'created_at', order: 'asc' } })

  const { headers, rows } = buildOrderMatrix({
    logs,
    processes,
    options: { includeRowTotal: true, includeColTotal: true, priceInLabel: true }
  })

  return { headers, rows, title: `订单-${order.order_name} 报工核算表` }
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
    case 'getTableDataV2': return await getTableDataV2(event, wxContext)
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
