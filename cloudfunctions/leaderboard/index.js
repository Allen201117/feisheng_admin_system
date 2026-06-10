// 云函数 - leaderboard (排行榜 3维度×3周期)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const bjTime = require('./beijing-time')
const { filterRankListForViewer } = require('./privacy.logic')

function toDateStr(val) {
  if (!val) return ''
  if (typeof val === 'string') return val
  // serverDate/Date 统一转北京时间日期串（之前用本地时区 getFullYear/getMonth 在 UTC 服务器上会偏移一天）
  var ts = bjTime.toUTCTimestamp(val)
  if (ts) return bjTime.formatBeijingDate(ts)
  return String(val)
}

function getMonthRange(monthStr) {
  if (monthStr) {
    var range = bjTime.getBeijingMonthRange(monthStr)
    return { startDate: range.startDate || range.start, endDate: range.endDate || range.end, month: monthStr }
  }
  var curMonth = bjTime.getBeijingMonth()
  var range = bjTime.getBeijingMonthRange(curMonth)
  return { startDate: range.startDate || range.start, endDate: range.endDate || range.end, month: curMonth }
}

function getYearRange(yearStr) {
  var y = yearStr ? parseInt(yearStr) : parseInt(bjTime.getBeijingMonth().split('-')[0])
  var range = bjTime.getBeijingYearRange(y)
  return { startDate: range.startDate || range.start, endDate: range.endDate || range.end, year: String(y) }
}

// 获取订单的日期范围
async function getOrderRange(orderId) {
  if (!orderId) return null
  try {
    var orderRes = await db.collection('Orders').doc(orderId).get()
    return orderRes.data || null
  } catch (e) { return null }
}

const authGuard = require('./auth-guard')

// 统一鉴权（见 auth-guard.js）：必须携带有效 token，工厂 status=active，失败一律拒绝。
async function getCallerUserByEvent(event, wxContext) {
  return await authGuard.getCallerUserByEvent(db, event)
}

function getOrgId(user) {
  return user && user.org_id ? user.org_id : ''
}

async function fetchAllDocs(collectionName, where) {
  var all = []
  var batchLen = 0
  do {
    var res = await db.collection(collectionName).where(where).skip(all.length).limit(100).get()
    batchLen = (res.data || []).length
    all = all.concat(res.data || [])
  } while (batchLen === 100)
  return all
}

exports.main = async function(event, context) {
  var action = event.action
  switch (action) {
    case 'getMonthlyRank': return await getRank(event, 'monthly')
    case 'getOrderRank': return await getRank(event, 'order')
    case 'getYearlyRank': return await getRank(event, 'yearly')
    default: return { code: -1, msg: '未知操作' }
  }
}

// 统一排行榜接口
// event.dimension: 'hours' | 'salary' | 'quality'
// event.month: '2024-01' (for monthly)
// event.order_id: orderId (for order)
// event.year: '2024' (for yearly)
async function getRank(event, period) {
  var dimension = event.dimension || 'hours'

  // 鉴权：boss看完整榜单；employee/qc始终可看自己的排名，公开开关只控制是否返回全榜。
  var caller = await getCallerUserByEvent(event)
  if (!caller) return { code: -1, msg: '请先登录' }

  // 与 attendance 同口径：org 文档缺失时回退遗留 'main' 文档，避免老数据工厂开关永远为 false
  var leaderboardVisible = false
  try {
    var settingsData = null
    try {
      var settingsRes = await db.collection('factory_settings').doc(getOrgId(caller)).get()
      settingsData = settingsRes.data || null
    } catch (e) {
      settingsData = null
    }
    if (!settingsData) {
      var mainRes = await db.collection('factory_settings').doc('main').get()
      settingsData = mainRes.data || null
    }
    leaderboardVisible = !!(settingsData && settingsData.leaderboard_visible)
  } catch (e) {
    console.error('[leaderboard] 读取榜单公开开关失败，按不公开处理', e)
    leaderboardVisible = false
  }

  // 确定日期范围
  var startDate, endDate
  var orderInfo = null
  if (period === 'monthly') {
    var mr = getMonthRange(event.month)
    startDate = mr.startDate; endDate = mr.endDate
  } else if (period === 'yearly') {
    var yr = getYearRange(event.year)
    startDate = yr.startDate; endDate = yr.endDate
  } else if (period === 'order') {
    if (!event.order_id) return { code: -1, msg: '请选择订单' }
    orderInfo = await getOrderRange(event.order_id)
    if (!orderInfo || orderInfo.org_id !== getOrgId(caller)) return { code: -1, msg: '订单不存在' }
    // 订单维度使用订单创建到现在（或结束）的范围
    startDate = toDateStr(orderInfo.created_at) || '2020-01-01'
    endDate = toDateStr(orderInfo.completed_at) || '2099-12-31'
  }

  try {
    // 获取所有活跃员工（分页获取，避免默认20条截断）
    var users = []
    var batchLen = 0
    do {
      var usersRes = await db.collection('Users').where({
        org_id: getOrgId(caller),
        role: _.in(['employee', 'qc']), status: 'active'
      }).skip(users.length).limit(100).get()
      batchLen = usersRes.data.length
      users = users.concat(usersRes.data)
    } while (batchLen === 100)

    // 一次性按 org+日期范围(+订单) 拉取记录后内存按 user_id 分组，
    // 替代原先「每员工 × 分页」的 N+1 嵌套循环查库；薪资口径不变（quantity*snapshot_price）。
    var groupMap = {}
    function groupOf(userId) {
      var key = String(userId)
      if (!groupMap[key]) groupMap[key] = []
      return groupMap[key]
    }

    if (dimension === 'hours') {
      // 注意：出勤不区分订单，订单周期只能用日期范围近似
      var attQuery = { org_id: getOrgId(caller), date: _.gte(startDate).and(_.lt(endDate)) }
      var attData = await fetchAllDocs('Attendances', attQuery)
      attData.forEach(function(r) { if (r.user_id) groupOf(r.user_id).push(r) })
    } else {
      var logQuery = { org_id: getOrgId(caller), date: _.gte(startDate).and(_.lt(endDate)) }
      if (dimension === 'quality') logQuery.status = 'inspected'
      if (period === 'order' && event.order_id) logQuery.order_id = event.order_id
      var logData = await fetchAllDocs('WorkLogs', logQuery)
      logData.forEach(function(l) { if (l.user_id) groupOf(l.user_id).push(l) })
    }

    var rankList = users.map(function(user) {
      var item = {
        user_id: user._id,
        user_name: user.name,
        role: user.role,
        rank_value: 0
      }
      var records = groupMap[String(user._id)] || []

      if (dimension === 'hours') {
        var totalHours = 0, attendDays = 0
        records.forEach(function(r) {
          totalHours += r.hours || 0
          if (r.clock_in_time) attendDays++
        })
        item.rank_value = Math.round(totalHours * 10) / 10
        item.total_hours = item.rank_value
        item.attend_days = attendDays
      } else if (dimension === 'salary') {
        var totalSalary = 0
        records.forEach(function(log) {
          totalSalary += Math.round((log.quantity || 0) * (log.snapshot_price || 0) * 100) / 100
        })
        item.rank_value = Math.round(totalSalary * 100) / 100
        item.total_salary = item.rank_value
      } else if (dimension === 'quality') {
        var totalQty = 0, totalPassed = 0
        records.forEach(function(log) {
          totalQty += log.quantity || 0
          totalPassed += log.passed_qty || 0
        })
        var passRate = totalQty > 0 ? Math.round(totalPassed / totalQty * 100) : 0
        item.rank_value = passRate
        item.total_quantity = totalQty
        item.total_passed = totalPassed
        item.pass_rate = passRate
      }

      return item
    })

    // 降序排列
    rankList.sort(function(a, b) { return b.rank_value - a.rank_value })

    // 加排名号（相同值同排名）
    var currentRank = 1
    for (var j = 0; j < rankList.length; j++) {
      if (j > 0 && rankList[j].rank_value < rankList[j - 1].rank_value) {
        currentRank = j + 1
      }
      rankList[j].rank = currentRank
    }

    var viewerRank = filterRankListForViewer(rankList, {
      caller: caller,
      leaderboardVisible: leaderboardVisible
    })

    return {
      code: 0,
      data: {
        list: viewerRank.list,
        period: period,
        dimension: dimension,
        total_employees: viewerRank.total_employees,
        visibility: viewerRank.visibility,
        leaderboard_visible: leaderboardVisible
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取排行榜失败' }
  }
}
