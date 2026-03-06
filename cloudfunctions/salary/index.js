// 云函数 - salary (工资管理 + 员工隐私脱敏)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function getCallerUser(wxContext) {
  const res = await db.collection('Users').where({
    openid: wxContext.OPENID, status: 'active'
  }).get()
  return res.data.length > 0 ? res.data[0] : null
}

function getMonthRange(monthStr) {
  const now = new Date()
  let startDate, endDate
  if (monthStr) {
    startDate = monthStr + '-01'
    const parts = monthStr.split('-')
    const m = parseInt(parts[1])
    endDate = m >= 12
      ? (parseInt(parts[0]) + 1) + '-01-01'
      : parts[0] + '-' + String(m + 1).padStart(2, '0') + '-01'
  } else {
    const y = now.getFullYear(), m = now.getMonth() + 1
    startDate = y + '-' + String(m).padStart(2, '0') + '-01'
    const nm = m + 1
    endDate = nm > 12 ? (y + 1) + '-01-01' : y + '-' + String(nm).padStart(2, '0') + '-01'
  }
  return { startDate, endDate }
}

function getCurrentMonth(month) {
  if (month) return month
  const now = new Date()
  return now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0')
}

// 计算某用户某月的完整薪资数据
async function calcUserSalary(userId, month) {
  const { startDate, endDate } = getMonthRange(month)
  const currentMonth = getCurrentMonth(month)

  const logRes = await db.collection('WorkLogs').where({
    user_id: userId, date: _.gte(startDate).and(_.lt(endDate))
  }).get()

  let totalPieceRate = 0, totalQuantity = 0, totalPassed = 0
  logRes.data.forEach(function(log) {
    totalQuantity += log.quantity || 0
    totalPassed += log.passed_qty || 0
    totalPieceRate += Math.round((log.quantity || 0) * (log.snapshot_price || 0) * 100) / 100
  })

  const adjRes = await db.collection('SalaryAdjustments').where({
    user_id: userId, month: currentMonth
  }).orderBy('created_at', 'desc').get()

  var totalReward = 0, totalPenalty = 0
  adjRes.data.forEach(function(adj) {
    if (adj.type === 'reward') totalReward += adj.amount
    else totalPenalty += adj.amount
  })

  const attRes = await db.collection('Attendances').where({
    user_id: userId, date: _.gte(startDate).and(_.lt(endDate))
  }).get()

  var totalHours = 0, attendDays = 0
  attRes.data.forEach(function(r) {
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
    adjustments: adjRes.data,
    logs: logRes.data
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  switch (action) {
    case 'getUserMonthlySalary': return await getUserMonthlySalary(event, wxContext)
    case 'getUserMonthlySalaryByBoss': return await getUserMonthlySalaryByBoss(event, wxContext)
    case 'getAllMonthlySalary': return await getAllMonthlySalary(event, wxContext)
    case 'addAdjustment': return await addAdjustment(event, wxContext)
    case 'updateAdjustment': return await updateAdjustment(event, wxContext)
    case 'deleteAdjustment': return await deleteAdjustment(event, wxContext)
    case 'getAdjustments': return await getAdjustments(event)
    case 'getDashboard': return await getDashboard(event, wxContext)
    case 'markPaid': return await markPaid(event, wxContext)
    case 'getPaidStatus': return await getPaidStatus(event, wxContext)
    default: return { code: -1, msg: '未知操作' }
  }
}

// 员工查看自己的月工资 - 已发薪记录脱敏
async function getUserMonthlySalary(event, wxContext) {
  const { user_id, month } = event
  const currentMonth = getCurrentMonth(month)

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

    // 未发薪 - 返回完整数据
    data.is_paid = false
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
  const currentMonth = month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

  try {
    // 获取所有员工
    const usersRes = await db.collection('Users').where({
      role: _.in(['employee', 'qc']),
      status: 'active'
    }).get()

    const salaryList = []
    let totalExpenditure = 0

    for (const user of usersRes.data) {
      // 计件收入（按报工数量计算，不受质检影响）
      const logRes = await db.collection('WorkLogs').where({
        user_id: user._id,
        date: _.gte(startDate).and(_.lt(endDate))
      }).get()

      let pieceRate = 0
      logRes.data.forEach(log => { pieceRate += Math.round((log.quantity || 0) * (log.snapshot_price || 0) * 100) / 100 })

      // 奖惩
      const adjRes = await db.collection('SalaryAdjustments').where({
        user_id: user._id,
        month: currentMonth
      }).get()

      let reward = 0, penalty = 0
      adjRes.data.forEach(adj => {
        if (adj.type === 'reward') reward += adj.amount
        else penalty += adj.amount
      })

      // 出勤
      const attRes = await db.collection('Attendances').where({
        user_id: user._id,
        date: _.gte(startDate).and(_.lt(endDate))
      }).get()

      let totalHours = 0
      let attendDays = 0
      attRes.data.forEach(r => {
        if (r.clock_in_time) attendDays++
        totalHours += r.hours || 0
      })

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

  const currentMonth = month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

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
async function getAdjustments(event) {
  const { user_id, month } = event
  const currentMonth = month || `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, '0')}`

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

  const now = new Date()
  const todayStr = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const nm = now.getMonth() + 2
  const monthEnd = nm > 12
    ? `${now.getFullYear() + 1}-01-01`
    : `${now.getFullYear()}-${String(nm).padStart(2, '0')}-01`

  try {
    // 员工总数
    const employeeCount = await db.collection('Users').where({
      role: _.in(['employee', 'qc']),
      status: 'active'
    }).count()

    // 今日出勤
    const todayAttendance = await db.collection('Attendances').where({
      date: todayStr
    }).count()

    // 活跃订单
    const activeOrders = await db.collection('Orders').where({
      status: 'active'
    }).count()

    // 待质检
    const pendingQC = await db.collection('WorkLogs').where({
      status: 'pending'
    }).count()

    // 本月工资总额
    const monthLogs = await db.collection('WorkLogs').where({
      date: _.gte(monthStart).and(_.lt(monthEnd)),
      status: 'inspected'
    }).get()

    let monthlySalary = 0
    monthLogs.data.forEach(log => { monthlySalary += log.amount || 0 })

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

  const now = new Date()
  const currentMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

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
  const now = new Date()
  const currentMonth = month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`

  try {
    const res = await db.collection('SalaryPayments').where({
      month: currentMonth,
      paid: true
    }).get()

    // 返回一个 { user_id: true } 的map
    const paidMap = {}
    res.data.forEach(r => {
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
