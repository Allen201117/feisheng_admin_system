// 云函数 - leaderboard (排行榜 3维度×3周期)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

function getMonthRange(monthStr) {
  var now = new Date()
  var startDate, endDate, month
  if (monthStr) {
    startDate = monthStr + '-01'
    var parts = monthStr.split('-')
    var m = parseInt(parts[1])
    endDate = m >= 12
      ? (parseInt(parts[0]) + 1) + '-01-01'
      : parts[0] + '-' + String(m + 1).padStart(2, '0') + '-01'
    month = monthStr
  } else {
    var y = now.getFullYear(), m2 = now.getMonth() + 1
    startDate = y + '-' + String(m2).padStart(2, '0') + '-01'
    var nm = m2 + 1
    endDate = nm > 12 ? (y + 1) + '-01-01' : y + '-' + String(nm).padStart(2, '0') + '-01'
    month = y + '-' + String(m2).padStart(2, '0')
  }
  return { startDate: startDate, endDate: endDate, month: month }
}

function getYearRange(yearStr) {
  var now = new Date()
  var y = yearStr ? parseInt(yearStr) : now.getFullYear()
  return { startDate: y + '-01-01', endDate: (y + 1) + '-01-01', year: String(y) }
}

// 获取订单的日期范围
async function getOrderRange(orderId) {
  if (!orderId) return null
  try {
    var orderRes = await db.collection('Orders').doc(orderId).get()
    return orderRes.data || null
  } catch (e) { return null }
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
    if (!orderInfo) return { code: -1, msg: '订单不存在' }
    // 订单维度使用订单创建到现在（或结束）的范围
    startDate = orderInfo.created_at || '2020-01-01'
    endDate = orderInfo.completed_at || '2099-12-31'
  }

  try {
    // 获取所有活跃员工
    var usersRes = await db.collection('Users').where({
      role: _.in(['employee', 'qc']), status: 'active'
    }).get()
    var users = usersRes.data

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
        var attQuery = { user_id: user._id, date: _.gte(startDate).and(_.lt(endDate)) }
        if (period === 'order' && event.order_id) {
          // 订单维度工时：取该时间段的出勤
          // 注意：出勤不区分订单，故只能用日期范围
        }
        var attRes = await db.collection('Attendances').where(attQuery).get()
        var totalHours = 0, attendDays = 0
        attRes.data.forEach(function(r) {
          totalHours += r.hours || 0
          if (r.clock_in_time) attendDays++
        })
        item.rank_value = Math.round(totalHours * 10) / 10
        item.total_hours = item.rank_value
        item.attend_days = attendDays

      } else if (dimension === 'salary') {
        // 薪资维度
        var logQuery = { user_id: user._id, date: _.gte(startDate).and(_.lt(endDate)) }
        if (period === 'order' && event.order_id) {
          logQuery.order_id = event.order_id
        }
        var logRes = await db.collection('WorkLogs').where(logQuery).get()
        var totalSalary = 0
        logRes.data.forEach(function(log) {
          totalSalary += Math.round((log.quantity || 0) * (log.snapshot_price || 0) * 100) / 100
        })
        item.rank_value = Math.round(totalSalary * 100) / 100
        item.total_salary = item.rank_value

      } else if (dimension === 'quality') {
        // 质量维度
        var qLogQuery = { user_id: user._id, date: _.gte(startDate).and(_.lt(endDate)), status: 'inspected' }
        if (period === 'order' && event.order_id) {
          qLogQuery.order_id = event.order_id
        }
        var qLogRes = await db.collection('WorkLogs').where(qLogQuery).get()
        var totalQty = 0, totalPassed = 0
        qLogRes.data.forEach(function(log) {
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

    return {
      code: 0,
      data: {
        list: rankList,
        period: period,
        dimension: dimension,
        total_employees: rankList.length
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取排行榜失败' }
  }
}
