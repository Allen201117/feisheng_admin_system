// 云函数 - export (数据导出)
const cloud = require('wx-server-sdk')
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

function getMonthRange(monthStr) {
  const now = new Date()
  let startDate, endDate, month

  if (monthStr) {
    startDate = monthStr + '-01'
    const parts = monthStr.split('-')
    const m = parseInt(parts[1])
    endDate = m >= 12
      ? `${parseInt(parts[0]) + 1}-01-01`
      : `${parts[0]}-${String(m + 1).padStart(2, '0')}-01`
    month = monthStr
  } else {
    const y = now.getFullYear()
    const m = now.getMonth() + 1
    startDate = `${y}-${String(m).padStart(2, '0')}-01`
    const nm = m + 1
    endDate = nm > 12 ? `${y + 1}-01-01` : `${y}-${String(nm).padStart(2, '0')}-01`
    month = `${y}-${String(m).padStart(2, '0')}`
  }

  return { startDate, endDate, month }
}

// ---- 数据采集（返回 { headers, rows, title }） ----

async function fetchSalaryData(startDate, endDate, monthStr) {
  const usersRes = await db.collection('Users').where({
    role: _.in(['employee', 'qc']),
    status: 'active'
  }).get()

  const headers = [
    '姓名', '角色', '入厂时间', '出勤天数', '工时(小时)', '报工数量',
    '合格数量', '合格率(%)', '计件工资(元)', '奖励(元)', '处罚(元)', '应发工资(元)'
  ]
  const rows = []

  for (const user of usersRes.data) {
    const logRes = await db.collection('WorkLogs').where({
      user_id: user._id,
      date: _.gte(startDate).and(_.lt(endDate)),
      status: 'inspected'
    }).get()

    let pieceRate = 0, totalQty = 0, passedQty = 0
    logRes.data.forEach(l => {
      pieceRate += l.amount || 0
      totalQty += l.quantity || 0
      passedQty += l.passed_qty || 0
    })

    const adjRes = await db.collection('SalaryAdjustments').where({
      user_id: user._id, month: monthStr
    }).get()

    let reward = 0, penalty = 0
    adjRes.data.forEach(a => {
      if (a.type === 'reward') reward += a.amount
      else penalty += a.amount
    })

    const attRes = await db.collection('Attendances').where({
      user_id: user._id,
      date: _.gte(startDate).and(_.lt(endDate))
    }).get()

    let hours = 0, days = 0
    attRes.data.forEach(a => {
      hours += a.hours || 0
      if (a.clock_in_time) days++
    })

    const total = Math.max(0, Math.round((pieceRate + reward - penalty) * 100) / 100)

    rows.push([
      user.name,
      user.role === 'employee' ? '员工' : '质检员',
      user.join_date || '未设置',
      days,
      Math.round(hours * 10) / 10,
      totalQty,
      passedQty,
      totalQty > 0 ? Math.round(passedQty / totalQty * 100) : 0,
      Math.round(pieceRate * 100) / 100,
      reward,
      penalty,
      total
    ])
  }

  return { headers, rows, title: `${monthStr}工资报表` }
}

async function fetchAttendanceData(startDate, endDate, monthStr) {
  const res = await db.collection('Attendances').where({
    date: _.gte(startDate).and(_.lt(endDate))
  }).orderBy('date', 'asc').orderBy('user_name', 'asc').get()

  const headers = ['姓名', '日期', '签到时间', '签退时间', '工时(小时)', '状态', '来源']
  const rows = res.data.map(r => ([
    r.user_name || '',
    r.date,
    r.clock_in_time ? new Date(r.clock_in_time).toLocaleTimeString('zh-CN') : '未签到',
    r.clock_out_time ? new Date(r.clock_out_time).toLocaleTimeString('zh-CN') : '未签退',
    r.hours || 0,
    r.status === 'normal' ? '正常' : r.status === 'abnormal' ? '异常' : '已补签',
    r.source === 'qrcode' ? '扫码' : '正常'
  ]))

  return { headers, rows, title: `${monthStr}考勤报表` }
}

async function fetchWorkLogData(startDate, endDate, monthStr) {
  const res = await db.collection('WorkLogs').where({
    date: _.gte(startDate).and(_.lt(endDate))
  }).orderBy('date', 'desc').orderBy('created_at', 'desc').get()

  const headers = [
    '姓名', '日期', '订单', '工序', '报工数量',
    '快照单价(元)', '合格数量', '金额(元)', '状态', '质检员'
  ]
  const rows = res.data.map(r => ([
    r.user_name || '',
    r.date,
    r.order_name || '',
    r.process_name || '',
    r.quantity,
    r.snapshot_price,
    r.passed_qty || 0,
    r.amount || 0,
    r.status === 'pending' ? '待检' : '已检',
    r.inspected_by_name || ''
  ]))

  return { headers, rows, title: `${monthStr}报工记录` }
}

async function fetchOrderCostData(monthStr) {
  const ordersRes = await db.collection('Orders').get()
  const headers = ['订单名称', '状态', '总数量', '完成数量', '人工成本(元)']
  const rows = []

  for (const order of ordersRes.data) {
    const logRes = await db.collection('WorkLogs').where({
      order_id: order._id,
      status: 'inspected'
    }).get()

    let totalCost = 0, totalQty = 0
    logRes.data.forEach(l => {
      totalCost += l.amount || 0
      totalQty += l.passed_qty || 0
    })

    rows.push([
      order.order_name,
      order.status === 'active' ? '进行中' : order.status === 'completed' ? '已完成' : '已取消',
      order.total_quantity || 0,
      totalQty,
      Math.round(totalCost * 100) / 100
    ])
  }

  return { headers, rows, title: `订单成本报表` }
}

/** 根据 export_type 调度获取数据 */
async function fetchReportData(export_type, startDate, endDate, monthStr) {
  switch (export_type) {
    case 'salary':
      return await fetchSalaryData(startDate, endDate, monthStr)
    case 'attendance':
      return await fetchAttendanceData(startDate, endDate, monthStr)
    case 'worklog':
      return await fetchWorkLogData(startDate, endDate, monthStr)
    case 'order_cost':
      return await fetchOrderCostData(monthStr)
    default:
      return null
  }
}

/** 将 { headers, rows } 转为 XLSX workbook */
function buildWorkbook(tableData, sheetName) {
  const aoa = [tableData.headers, ...tableData.rows]
  const wb = XLSX.utils.book_new()
  const ws = XLSX.utils.aoa_to_sheet(aoa)
  XLSX.utils.book_append_sheet(wb, ws, sheetName)
  return wb
}

// ---- Actions ----

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  switch (action) {
    case 'getTableData': return await getTableData(event, wxContext)
    case 'exportToFile':  return await exportToFile(event, wxContext)
    case 'getHistory':    return await getHistory(event, wxContext)
    default: return { code: -1, msg: '未知操作' }
  }
}

/**
 * getTableData — 返回报表的 JSON 数据（用于前端内联表格展示）
 */
async function getTableData(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { export_type, month } = event
  const { startDate, endDate, month: monthStr } = getMonthRange(month)

  try {
    const tableData = await fetchReportData(export_type, startDate, endDate, monthStr)
    if (!tableData) {
      return { code: -1, msg: '未知导出类型' }
    }

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

/**
 * exportToFile — 生成 Excel → 上传云存储 → 返回 file_id 和临时下载链接
 */
async function exportToFile(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { export_type, month } = event
  const { startDate, endDate, month: monthStr } = getMonthRange(month)

  try {
    const tableData = await fetchReportData(export_type, startDate, endDate, monthStr)
    if (!tableData) {
      return { code: -1, msg: '未知导出类型' }
    }

    // 文件名映射
    const filenameMap = {
      salary: `工资报表_${monthStr}.xlsx`,
      attendance: `考勤报表_${monthStr}.xlsx`,
      worklog: `报工记录_${monthStr}.xlsx`,
      order_cost: `订单成本_${monthStr}.xlsx`
    }
    const filename = filenameMap[export_type]

    // 生成 Excel Buffer
    const sheetName = tableData.title || export_type
    const workbook = buildWorkbook(tableData, sheetName)
    const buffer = XLSX.write(workbook, { bookType: 'xlsx', type: 'buffer' })

    // 上传到云存储
    const uploadRes = await cloud.uploadFile({
      cloudPath: `exports/${filename}`,
      fileContent: buffer
    })

    // 获取临时下载链接
    const urlRes = await cloud.getTempFileURL({
      fileList: [uploadRes.fileID]
    })
    const tempUrl = (urlRes.fileList && urlRes.fileList[0] && urlRes.fileList[0].tempFileURL) || ''

    // 记录导出历史
    await db.collection('export_history').add({
      data: {
        export_type,
        month: monthStr,
        filename,
        file_id: uploadRes.fileID,
        status: 'downloaded',
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
        temp_url: tempUrl
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
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  try {
    const res = await db.collection('export_history')
      .orderBy('created_at', 'desc')
      .limit(20)
      .get()
    return { code: 0, data: res.data }
  } catch (err) {
    return { code: -1, msg: '获取历史失败' }
  }
}
