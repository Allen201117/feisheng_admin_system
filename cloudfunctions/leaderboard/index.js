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
  if (val instanceof Date) {
    return val.getFullYear() + '-' +
      String(val.getMonth() + 1).padStart(2, '0') + '-' +
      String(val.getDate()).padStart(2, '0')
  }
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

async function getCallerUserByEvent(event) {
  const authUserId = event && event.auth_user_id
  const authSessionToken = event && event.auth_session_token
  if (authUserId && authSessionToken) {
    try {
      var res = await db.collection('Users').where({
        _id: authUserId,
        session_token: authSessionToken,
        status: 'active'
      }).limit(1).get()
      if (res.data.length > 0) {
        var user = res.data[0]
        if (user.org_id) {
          var orgRes = await db.collection('Organizations').doc(user.org_id).get()
          if (!orgRes.data || orgRes.data.status !== 'active') return null
        }
        return user
      }
    } catch (e) {}
  }
  return null
}

function getOrgId(user) {
  return user && user.org_id ? user.org_id : ''
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

  var leaderboardVisible = false
  try {
    var settingsRes = await db.collection('factory_settings').doc(getOrgId(caller)).get()
    leaderboardVisible = !!(settingsRes.data && settingsRes.data.leaderboard_visible)
  } catch (e) {
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

    var rankList = []

    for (var i = 0; i < users.length; i++) {
      var user = users[i]
      var item = {
        user_id: user._id,
        user_name: user.name,
        role: user.role,
        rank_value: 0
      }

      if (dimension === 'hours') {
        // 工时维度
        var attQuery = { org_id: getOrgId(caller), user_id: user._id, date: _.gte(startDate).and(_.lt(endDate)) }
        if (period === 'order' && event.order_id) {
          // 订单维度工时：取该时间段的出勤
          // 注意：出勤不区分订单，故只能用日期范围
        }
        var attData = []
        var attBatch = 0
        do {
          var attRes = await db.collection('Attendances').where(attQuery).skip(attData.length).limit(100).get()
          attBatch = attRes.data.length
          attData = attData.concat(attRes.data)
        } while (attBatch === 100)
        var totalHours = 0, attendDays = 0
        attData.forEach(function(r) {
          totalHours += r.hours || 0
          if (r.clock_in_time) attendDays++
        })
        item.rank_value = Math.round(totalHours * 10) / 10
        item.total_hours = item.rank_value
        item.attend_days = attendDays

      } else if (dimension === 'salary') {
        // 薪资维度
        var logQuery = { org_id: getOrgId(caller), user_id: user._id, date: _.gte(startDate).and(_.lt(endDate)) }
        if (period === 'order' && event.order_id) {
          logQuery.order_id = event.order_id
        }
        var logData = []
        var logBatch = 0
        do {
          var logRes = await db.collection('WorkLogs').where(logQuery).skip(logData.length).limit(100).get()
          logBatch = logRes.data.length
          logData = logData.concat(logRes.data)
        } while (logBatch === 100)
        var totalSalary = 0
        logData.forEach(function(log) {
          totalSalary += Math.round((log.quantity || 0) * (log.snapshot_price || 0) * 100) / 100
        })
        item.rank_value = Math.round(totalSalary * 100) / 100
        item.total_salary = item.rank_value

      } else if (dimension === 'quality') {
        // 质量维度
        var qLogQuery = { org_id: getOrgId(caller), user_id: user._id, date: _.gte(startDate).and(_.lt(endDate)), status: 'inspected' }
        if (period === 'order' && event.order_id) {
          qLogQuery.order_id = event.order_id
        }
        var qLogData = []
        var qLogBatch = 0
        do {
          var qLogRes = await db.collection('WorkLogs').where(qLogQuery).skip(qLogData.length).limit(100).get()
          qLogBatch = qLogRes.data.length
          qLogData = qLogData.concat(qLogRes.data)
        } while (qLogBatch === 100)
        var totalQty = 0, totalPassed = 0
        qLogData.forEach(function(log) {
          totalQty += log.quantity || 0
          totalPassed += log.passed_qty || 0
        })
        var passRate = totalQty > 0 ? Math.round(totalPassed / totalQty * 100) : 0
        item.rank_value = passRate
        item.total_quantity = totalQty
        item.total_passed = totalPassed
        item.pass_rate = passRate
      }

      rankList.push(item)
    }

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
