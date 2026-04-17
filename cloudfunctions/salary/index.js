// 云函数 - salary (工资管理 + 员工隐私脱敏)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const bjTime = require('./beijing-time')
const { resolvePeriodRange, buildSalaryPeriodSummary } = require('./period-statistics')

async function fetchAllByWhere(collectionName, where, options = {}) {
  const orderBy = options.orderBy || null
  const field = options.field || null
  const pageSize = options.pageSize || 100

  let all = []
  let batchLen = 0

  do {
    let query = db.collection(collectionName).where(where)
    if (field) query = query.field(field)
    if (orderBy && orderBy.field) query = query.orderBy(orderBy.field, orderBy.order || 'asc')

    const res = await query.skip(all.length).limit(pageSize).get()
    batchLen = (res.data || []).length
    all = all.concat(res.data || [])
  } while (batchLen === pageSize)

  return all
}

async function getCallerUser(wxContext) {
  const res = await db.collection('Users').where({
    openid: wxContext.OPENID, status: 'active'
  }).get()
  return res.data.length > 0 ? res.data[0] : null
}

function getMonthRange(monthStr) {
  const range = monthStr
    ? bjTime.getBeijingMonthRange(monthStr)
    : bjTime.getBeijingMonthRange(bjTime.getBeijingMonth())
  return { startDate: range.startDate, endDate: range.endDate }
}

function getCurrentMonth(month) {
  if (month) return month
  return bjTime.getBeijingMonth()
}

function buildMonthFilter(monthKeys) {
  if (!monthKeys || monthKeys.length === 0) return ''
  return monthKeys.length === 1 ? monthKeys[0] : _.in(monthKeys)
}

async function getPeriodSalarySummary(params = {}) {
  const period = resolvePeriodRange(params)
  const monthFilter = buildMonthFilter(period.monthKeys)

  const users = await fetchAllByWhere('Users', {
    role: _.in(['employee', 'qc']),
    status: 'active'
  }, {
    field: { _id: true, name: true, role: true }
  })

  const [logs, adjustments, attendances, payments] = await Promise.all([
    fetchAllByWhere('WorkLogs', {
      date: _.gte(period.startDate).and(_.lt(period.endDate))
    }, {
      field: { user_id: true, quantity: true, passed_qty: true, snapshot_price: true, date: true }
    }),
    fetchAllByWhere('SalaryAdjustments', {
      month: monthFilter
    }, {
      field: { user_id: true, month: true, type: true, amount: true }
    }),
    fetchAllByWhere('Attendances', {
      date: _.gte(period.startDate).and(_.lt(period.endDate))
    }, {
      field: { user_id: true, date: true, hours: true, clock_in_time: true }
    }),
    fetchAllByWhere('SalaryPayments', {
      month: monthFilter,
      paid: true
    }, {
      field: { user_id: true, month: true, paid: true, paid_at: true, operator_name: true }
    })
  ])

  return buildSalaryPeriodSummary({
    users,
    logs,
    adjustments,
    attendances,
    payments,
    monthKeys: period.monthKeys
  })
}

// 计算某用户某月的完整薪资数据
async function calcUserSalary(userId, month) {
  const { startDate, endDate } = getMonthRange(month)
  const currentMonth = getCurrentMonth(month)

  const [logs, adjustments, attendances] = await Promise.all([
    fetchAllByWhere('WorkLogs', {
      user_id: userId,
      date: _.gte(startDate).and(_.lt(endDate))
    }, {
      field: { quantity: true, passed_qty: true, snapshot_price: true, date: true, process_name: true, order_name: true }
    }),
    fetchAllByWhere('SalaryAdjustments', {
      user_id: userId,
      month: currentMonth
    }, {
      orderBy: { field: 'created_at', order: 'desc' }
    }),
    fetchAllByWhere('Attendances', {
      user_id: userId,
      date: _.gte(startDate).and(_.lt(endDate))
    }, {
      field: { clock_in_time: true, hours: true }
    })
  ])

  let totalPieceRate = 0, totalQuantity = 0, totalPassed = 0
  logs.forEach(function(log) {
    totalQuantity += log.quantity || 0
    totalPassed += log.passed_qty || 0
    totalPieceRate += Math.round((log.quantity || 0) * (log.snapshot_price || 0) * 100) / 100
  })

  var totalReward = 0, totalPenalty = 0
  adjustments.forEach(function(adj) {
    if (adj.type === 'reward') totalReward += adj.amount
    else totalPenalty += adj.amount
  })

  var totalHours = 0, attendDays = 0
  attendances.forEach(function(r) {
    if (r.clock_in_time) attendDays++
    totalHours += r.hours || 0
  })

  var totalSalary = Math.round((totalPieceRate + totalReward - totalPenalty) * 100) / 100

  return {
    piece_rate: Math.round(totalPieceRate * 100) / 100,
    reward: totalReward,
    penalty: totalPenalty,
    total: Math.max(0, totalSalary),
    work_stats: {
      total_quantity: totalQuantity,
      total_passed: totalPassed,
      pass_rate: totalQuantity > 0 ? Math.round(totalPassed / totalQuantity * 100) : 0,
      attend_days: attendDays,
      total_hours: Math.round(totalHours * 10) / 10
    },
    adjustments,
    logs
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  switch (action) {
    case 'getUserMonthlySalary': return await getUserMonthlySalary(event, wxContext)
    case 'getUserMonthlySalaryByBoss': return await getUserMonthlySalaryByBoss(event, wxContext)
    case 'getAllMonthlySalary': return await getAllMonthlySalary(event, wxContext)
    case 'getAllPeriodSalary': return await getAllPeriodSalary(event, wxContext)
    case 'addAdjustment': return await addAdjustment(event, wxContext)
    case 'updateAdjustment': return await updateAdjustment(event, wxContext)
    case 'deleteAdjustment': return await deleteAdjustment(event, wxContext)
    case 'getAdjustments': return await getAdjustments(event, wxContext)
    case 'getDashboard': return await getDashboard(event, wxContext)
    case 'markPaid': return await markPaid(event, wxContext)
    case 'getPaidStatus': return await getPaidStatus(event, wxContext)
    case 'getAvailableMonths': return await getAvailableMonths(event, wxContext)
    default: return { code: -1, msg: '未知操作' }
  }
}

// 员工查看自己的月工资 - 已发薪记录脱敏
async function getUserMonthlySalary(event, wxContext) {
  const { user_id, month } = event
  const currentMonth = getCurrentMonth(month)

  // Auth check: caller must be the user themselves or a boss
  const caller = await getCallerUser(wxContext)
  if (!caller) return { code: -1, msg: '登录已失效' }
  if (String(caller._id) !== String(user_id) && caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  try {
    var data = await calcUserSalary(user_id, month)

    // 检查该月是否已发薪
    var paidRes = await db.collection('SalaryPayments').where({
      user_id: user_id, month: currentMonth, paid: true
    }).get()
    var isPaid = paidRes.data.length > 0

    if (isPaid) {
      // 已发薪 - 后端字段级脱敏：移除工件数、单价、明细条目
      var paidAt = paidRes.data[0].paid_at || null
      return {
        code: 0,
        data: {
          total: data.total,
          month: currentMonth,
          is_paid: true,
          paid_at: paidAt,
          reward: data.reward,
          penalty: data.penalty,
          work_stats: {
            attend_days: data.work_stats.attend_days,
            total_hours: data.work_stats.total_hours
          },
          adjustments: data.adjustments.map(function(a) {
            return { type: a.type, amount: a.amount, reason: a.reason, date: a.date || a.created_at }
          })
          // 注意：不返回 piece_rate, logs, work_stats.total_quantity, total_passed, pass_rate
        }
      }
    }

    // 未发薪 - 返回数据（对 price_hidden 的订单做脱敏）
    // 查询相关订单的 price_hidden 状态
    const orderIds = [...new Set((data.logs || []).map(l => l.order_id).filter(Boolean))]
    const orderHiddenMap = {}
    if (orderIds.length > 0) {
      for (let i = 0; i < orderIds.length; i += 100) {
        const batch = orderIds.slice(i, i + 100)
        const orderRes = await db.collection('Orders').where({
          _id: _.in(batch)
        }).field({ _id: true, price_hidden: true }).get()
        orderRes.data.forEach(o => {
          orderHiddenMap[o._id] = o.price_hidden === true
        })
      }
    }

    // 对隐藏了工价的订单脱敏 snapshot_price / amount
    let visiblePieceRate = 0
    const maskedLogs = (data.logs || []).map(function(log) {
      if (orderHiddenMap[log.order_id]) {
        return {
          ...log,
          snapshot_price: null,
          amount: null,
          price_hidden: true
        }
      }
      visiblePieceRate += Math.round((log.quantity || 0) * (log.snapshot_price || 0) * 100) / 100
      return { ...log, price_hidden: false }
    })

    const hasHidden = Object.values(orderHiddenMap).some(v => v)
    data.logs = maskedLogs
    data.is_paid = false
    if (hasHidden) {
      data.has_hidden_orders = true
    }
    return { code: 0, data: data }
  } catch (err) {
    return { code: -1, msg: '获取工资失败' }
  }
}

// 管理员查看某员工月工资 - 完整明细
async function getUserMonthlySalaryByBoss(event, wxContext) {
  var caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }

  var { user_id, month } = event
  var currentMonth = getCurrentMonth(month)

  try {
    var data = await calcUserSalary(user_id, month)
    // 检查发薪状态
    var paidRes = await db.collection('SalaryPayments').where({
      user_id: user_id, month: currentMonth, paid: true
    }).get()
    data.is_paid = paidRes.data.length > 0
    if (data.is_paid) data.paid_at = paidRes.data[0].paid_at
    return { code: 0, data: data }
  } catch (err) {
    return { code: -1, msg: '获取工资失败' }
  }
}

// 管理员查看全部员工月工资汇总
async function getAllMonthlySalary(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { month } = event
  const { startDate, endDate } = getMonthRange(month)
  const currentMonth = month || bjTime.getBeijingMonth()

  try {
    // 获取所有员工（仅必要字段）
    const users = await fetchAllByWhere('Users', {
      role: _.in(['employee', 'qc']),
      status: 'active'
    }, {
      field: { _id: true, name: true, role: true }
    })

    // 批量拉取当月报工、奖惩、出勤，避免按员工循环查询导致超时
    const [monthLogs, monthAdjustments, monthAttendances] = await Promise.all([
      fetchAllByWhere('WorkLogs', {
        date: _.gte(startDate).and(_.lt(endDate))
      }, {
        field: { user_id: true, quantity: true, passed_qty: true, snapshot_price: true }
      }),
      fetchAllByWhere('SalaryAdjustments', {
        month: currentMonth
      }, {
        field: { user_id: true, type: true, amount: true }
      }),
      fetchAllByWhere('Attendances', {
        date: _.gte(startDate).and(_.lt(endDate))
      }, {
        field: { user_id: true, hours: true, clock_in_time: true }
      })
    ])

    const pieceRateMap = {}
    monthLogs.forEach(log => {
      const userId = log.user_id
      if (!userId) return
      if (!pieceRateMap[userId]) pieceRateMap[userId] = 0
      pieceRateMap[userId] += Math.round((log.quantity || 0) * (log.snapshot_price || 0) * 100) / 100
    })

    const adjustMap = {}
    monthAdjustments.forEach(adj => {
      const userId = adj.user_id
      if (!userId) return
      if (!adjustMap[userId]) adjustMap[userId] = { reward: 0, penalty: 0 }
      if (adj.type === 'reward') adjustMap[userId].reward += adj.amount || 0
      else adjustMap[userId].penalty += adj.amount || 0
    })

    const attendanceMap = {}
    monthAttendances.forEach(att => {
      const userId = att.user_id
      if (!userId) return
      if (!attendanceMap[userId]) attendanceMap[userId] = { totalHours: 0, attendDays: 0 }
      attendanceMap[userId].totalHours += att.hours || 0
      if (att.clock_in_time) attendanceMap[userId].attendDays += 1
    })

    const salaryList = []
    let totalExpenditure = 0

    for (const user of users) {
      const userId = user._id
      const pieceRate = pieceRateMap[userId] || 0
      const reward = (adjustMap[userId] && adjustMap[userId].reward) || 0
      const penalty = (adjustMap[userId] && adjustMap[userId].penalty) || 0
      const totalHours = (attendanceMap[userId] && attendanceMap[userId].totalHours) || 0
      const attendDays = (attendanceMap[userId] && attendanceMap[userId].attendDays) || 0

      const total = Math.round((pieceRate + reward - penalty) * 100) / 100

      salaryList.push({
        user_id: user._id,
        user_name: user.name,
        role: user.role,
        piece_rate: Math.round(pieceRate * 100) / 100,
        reward,
        penalty,
        total: Math.max(0, total),
        attend_days: attendDays,
        total_hours: Math.round(totalHours * 10) / 10
      })

      totalExpenditure += Math.max(0, total)
    }

    salaryList.sort((a, b) => b.total - a.total)

    return {
      code: 0,
      data: {
        list: salaryList,
        total_expenditure: Math.round(totalExpenditure * 100) / 100,
        employee_count: salaryList.length
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取工资汇总失败' }
  }
}

// 添加奖惩
async function getAllPeriodSalary(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const params = event.dimension === 'year'
    ? { year: event.year }
    : { month: event.month }

  try {
    const summary = await getPeriodSalarySummary(params)
    return { code: 0, data: summary }
  } catch (err) {
    return { code: -1, msg: '\u83b7\u53d6\u5de5\u8d44\u6c47\u603b\u5931\u8d25' }
  }
}
/*
    return { code: -1, msg: '获取工资汇总失败' }
  }
}
/*
    return { code: -1, msg: '鑾峰彇宸ヨ祫姹囨€诲け璐? }
  }
}

*/
async function addAdjustment(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { user_id, user_name, type, amount, reason, month } = event
  if (!user_id || !type || !amount || amount <= 0) {
    return { code: -1, msg: '参数不完整' }
  }

  if (!['reward', 'penalty'].includes(type)) {
    return { code: -1, msg: '类型无效' }
  }

  const currentMonth = month || bjTime.getBeijingMonth()

  try {
    await db.collection('SalaryAdjustments').add({
      data: {
        user_id,
        user_name: user_name || '',
        type,
        amount: parseFloat(amount),
        reason: reason || '',
        month: currentMonth,
        operator_id: caller._id,
        operator_name: caller.name,
        created_at: db.serverDate()
      }
    })

    // 审计日志
    await db.collection('audit_logs').add({
      data: {
        operator_id: caller._id,
        operator_name: caller.name,
        action: type === 'reward' ? 'add_reward' : 'add_penalty',
        target_id: user_id,
        details: `${type === 'reward' ? '奖励' : '处罚'} ${user_name} ¥${amount}，原因: ${reason || '无'}`,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: (type === 'reward' ? '奖励' : '处罚') + '添加成功' }
  } catch (err) {
    return { code: -1, msg: '添加失败' }
  }
}

// 修改奖惩 - 已发薪期间走冲正
async function updateAdjustment(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }

  const { adjustment_id, amount, reason, date, period_key, order_id, edit_reason } = event
  if (!adjustment_id) return { code: -1, msg: '缺少奖惩ID' }
  if (!edit_reason) return { code: -1, msg: '请填写修改原因' }

  try {
    const adjRes = await db.collection('SalaryAdjustments').doc(adjustment_id).get()
    if (!adjRes.data) return { code: -1, msg: '奖惩记录不存在' }
    const adj = adjRes.data

    // 检查发薪锁定
    const paidRes = await db.collection('SalaryPayments').where({
      user_id: adj.user_id,
      month: adj.month,
      paid: true
    }).get()
    const isLocked = paidRes.data.length > 0

    if (isLocked) {
      // 已发薪 → 冲正方式：添加反向调整 + 新调整
      const reverseAmount = adj.amount
      const reverseType = adj.type
      // 添加反向冲正
      await db.collection('SalaryAdjustments').add({
        data: {
          user_id: adj.user_id,
          user_name: adj.user_name,
          type: reverseType === 'reward' ? 'penalty' : 'reward',
          amount: reverseAmount,
          reason: `【冲正】原记录: ${adj.reason}，冲正原因: ${edit_reason}`,
          month: adj.month,
          is_reversal: true,
          original_id: adjustment_id,
          operator_id: caller._id,
          operator_name: caller.name,
          created_at: db.serverDate()
        }
      })
      // 如果有新金额，添加新调整
      if (amount !== undefined && parseFloat(amount) > 0) {
        const currentMonth = adj.month
        await db.collection('SalaryAdjustments').add({
          data: {
            user_id: adj.user_id,
            user_name: adj.user_name,
            type: adj.type,
            amount: parseFloat(amount),
            reason: reason || adj.reason,
            month: currentMonth,
            is_correction: true,
            original_id: adjustment_id,
            operator_id: caller._id,
            operator_name: caller.name,
            created_at: db.serverDate()
          }
        })
      }
      // 审计
      await db.collection('audit_logs').add({
        data: {
          action: 'adjustment_reversal',
          operator_id: caller._id,
          operator_name: caller.name,
          target_id: adjustment_id,
          target_user_id: adj.user_id,
          details: `已发薪冲正：原${adj.type === 'reward' ? '奖励' : '处罚'} ¥${adj.amount}，新金额: ¥${amount || 0}，原因: ${edit_reason}`,
          created_at: db.serverDate()
        }
      })
      return { code: 0, msg: '已通过冲正方式修改（已发薪期间）' }
    }

    // 未发薪 → 直接修改
    const oldSnapshot = { amount: adj.amount, reason: adj.reason, date: adj.date }
    const updateData = { updated_at: db.serverDate() }

    if (amount !== undefined) updateData.amount = parseFloat(amount)
    if (reason !== undefined) updateData.reason = reason
    if (date !== undefined) updateData.date = date
    if (period_key !== undefined) updateData.month = period_key
    if (order_id !== undefined) updateData.order_id = order_id

    await db.collection('SalaryAdjustments').doc(adjustment_id).update({ data: updateData })

    // 审计
    await db.collection('audit_logs').add({
      data: {
        action: 'adjustment_update',
        operator_id: caller._id,
        operator_name: caller.name,
        target_id: adjustment_id,
        target_user_id: adj.user_id,
        old_values: oldSnapshot,
        new_values: { amount: updateData.amount, reason: updateData.reason, date: updateData.date },
        edit_reason: edit_reason,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '奖惩修改成功' }
  } catch (err) {
    return { code: -1, msg: '修改失败: ' + err.message }
  }
}

// 删除奖惩 - 已发薪走冲正
async function deleteAdjustment(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }

  const { adjustment_id, delete_reason } = event
  if (!adjustment_id) return { code: -1, msg: '缺少奖惩ID' }
  if (!delete_reason) return { code: -1, msg: '请填写删除原因' }

  try {
    const adjRes = await db.collection('SalaryAdjustments').doc(adjustment_id).get()
    if (!adjRes.data) return { code: -1, msg: '奖惩记录不存在' }
    const adj = adjRes.data

    const paidRes = await db.collection('SalaryPayments').where({
      user_id: adj.user_id, month: adj.month, paid: true
    }).get()
    const isLocked = paidRes.data.length > 0

    if (isLocked) {
      // 冲正
      await db.collection('SalaryAdjustments').add({
        data: {
          user_id: adj.user_id,
          user_name: adj.user_name,
          type: adj.type === 'reward' ? 'penalty' : 'reward',
          amount: adj.amount,
          reason: `【冲正删除】原记录: ${adj.reason}，删除原因: ${delete_reason}`,
          month: adj.month,
          is_reversal: true,
          original_id: adjustment_id,
          operator_id: caller._id,
          operator_name: caller.name,
          created_at: db.serverDate()
        }
      })
    } else {
      await db.collection('SalaryAdjustments').doc(adjustment_id).remove()
    }

    // 审计
    await db.collection('audit_logs').add({
      data: {
        action: 'adjustment_delete',
        operator_id: caller._id,
        operator_name: caller.name,
        target_id: adjustment_id,
        target_user_id: adj.user_id,
        old_values: { type: adj.type, amount: adj.amount, reason: adj.reason },
        delete_reason: delete_reason,
        is_reversal: isLocked,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: isLocked ? '已通过冲正方式删除' : '奖惩删除成功' }
  } catch (err) {
    return { code: -1, msg: '删除失败: ' + err.message }
  }
}

// 获取奖惩记录
async function getAdjustments(event, wxContext) {
  const { user_id, month } = event
  const currentMonth = month || bjTime.getBeijingMonth()

  // Auth check
  const caller = await getCallerUser(wxContext)
  if (!caller) return { code: -1, msg: '登录已失效' }
  if (String(caller._id) !== String(user_id) && caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  try {
    const res = await db.collection('SalaryAdjustments').where({
      user_id,
      month: currentMonth
    }).orderBy('created_at', 'desc').get()

    return { code: 0, data: res.data }
  } catch (err) {
    return { code: -1, msg: '获取记录失败' }
  }
}

// Boss首页仪表盘数据
async function getDashboard(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const todayStr = bjTime.getBeijingToday()
  const monthRange = bjTime.getBeijingMonthRange(bjTime.getBeijingMonth())
  const monthStart = monthRange.startDate
  const monthEnd = monthRange.endDate

  try {
    const [employeeCount, todayAttendance, activeOrders, pendingQC, monthLogs] = await Promise.all([
      db.collection('Users').where({
        role: _.in(['employee', 'qc']),
        status: 'active'
      }).count(),
      db.collection('Attendances').where({
        date: todayStr
      }).count(),
      db.collection('Orders').where({
        status: 'active'
      }).count(),
      db.collection('WorkLogs').where({
        status: 'pending'
      }).count(),
      fetchAllByWhere('WorkLogs', {
        date: _.gte(monthStart).and(_.lt(monthEnd))
      }, {
        field: { quantity: true, passed_qty: true, snapshot_price: true }
      })
    ])

    let monthlySalary = 0
    monthLogs.forEach(log => {
      monthlySalary += Math.round((log.quantity || 0) * (log.snapshot_price || 0) * 100) / 100
    })

    return {
      code: 0,
      data: {
        employee_count: employeeCount.total,
        today_attendance: todayAttendance.total,
        active_orders: activeOrders.total,
        pending_qc: pendingQC.total,
        monthly_salary: Math.round(monthlySalary * 100) / 100
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取数据失败' }
  }
}

// 获取所有有数据的月份
async function getAvailableMonths(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  try {
    const monthSet = {}

    // 从 WorkLogs 取月份
    const logs = await fetchAllByWhere('WorkLogs', {}, {
      field: { date: true },
      pageSize: 100
    })
    logs.forEach(l => {
      if (l.date && l.date.length >= 7) monthSet[l.date.substring(0, 7)] = true
    })

    // 从 SalaryAdjustments 取月份
    const adjs = await fetchAllByWhere('SalaryAdjustments', {}, {
      field: { month: true },
      pageSize: 100
    })
    adjs.forEach(a => {
      if (a.month) monthSet[a.month] = true
    })

    // 从 SalaryPayments 取月份
    const pays = await fetchAllByWhere('SalaryPayments', {}, {
      field: { month: true },
      pageSize: 100
    })
    pays.forEach(p => {
      if (p.month) monthSet[p.month] = true
    })

    // 确保当前月份一定在列表中
    const curMonth = bjTime.getBeijingMonth()
    monthSet[curMonth] = true

    const months = Object.keys(monthSet).sort().reverse()
    return { code: 0, data: months }
  } catch (err) {
    return { code: -1, msg: '获取月份列表失败' }
  }
}

// 标记/取消标记员工已发工资
async function markPaid(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { user_id, user_name, month, paid } = event
  if (!user_id || !month) {
    return { code: -1, msg: '参数不完整' }
  }

  const currentMonth = month || bjTime.getBeijingMonth()

  try {
    // 用 user_id + month 作为唯一标识
    const existing = await db.collection('SalaryPayments').where({
      user_id,
      month: currentMonth
    }).get()

    if (paid) {
      // 标记已发
      if (existing.data.length > 0) {
        await db.collection('SalaryPayments').doc(existing.data[0]._id).update({
          data: {
            paid: true,
            paid_at: db.serverDate(),
            operator_id: caller._id,
            operator_name: caller.name
          }
        })
      } else {
        await db.collection('SalaryPayments').add({
          data: {
            user_id,
            user_name: user_name || '',
            month: currentMonth,
            paid: true,
            paid_at: db.serverDate(),
            operator_id: caller._id,
            operator_name: caller.name,
            created_at: db.serverDate()
          }
        })
      }
    } else {
      // 取消标记
      if (existing.data.length > 0) {
        await db.collection('SalaryPayments').doc(existing.data[0]._id).update({
          data: {
            paid: false,
            paid_at: null,
            operator_id: caller._id,
            operator_name: caller.name
          }
        })
      }
    }

    return { code: 0, msg: paid ? '已标记为已发工资' : '已取消发放标记' }
  } catch (err) {
    return { code: -1, msg: '操作失败: ' + err.message }
  }
}

// 获取某月所有员工的发放状态
async function getPaidStatus(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { month } = event
  const currentMonth = month || bjTime.getBeijingMonth()

  try {
    const paidRecords = await fetchAllByWhere('SalaryPayments', {
      month: currentMonth,
      paid: true
    })

    // 返回一个 { user_id: true } 的map
    const paidMap = {}
    paidRecords.forEach(r => {
      paidMap[r.user_id] = {
        paid: true,
        paid_at: r.paid_at,
        operator_name: r.operator_name
      }
    })

    return { code: 0, data: paidMap }
  } catch (err) {
    return { code: -1, msg: '获取发放状态失败' }
  }
}
