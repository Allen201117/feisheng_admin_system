// 云函数 - worklog (报工管理)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function getCallerUser(wxContext) {
  const res = await db.collection('Users').where({
    openid: wxContext.OPENID,
    status: 'active'
  }).get()
  return res.data.length > 0 ? res.data[0] : null
}

// 检查某用户某月是否已发薪锁定
async function isPeriodLocked(userId, dateStr) {
  const month = dateStr.substring(0, 7) // YYYY-MM
  const paidRes = await db.collection('SalaryPayments').where({
    user_id: userId,
    month: month,
    paid: true
  }).get()
  return paidRes.data.length > 0
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  switch (action) {
    case 'submit': return await submitWorkLog(event)
    case 'getTodayEarnings': return await getTodayEarnings(event)
    case 'getUserLogs': return await getUserLogs(event)
    case 'getMonthLogs': return await getMonthLogs(event, wxContext)
    case 'getPendingLogs': return await getPendingLogs(event, wxContext)
    case 'getInspectedLogs': return await getInspectedLogs(event, wxContext)
    case 'getLogDetail': return await getLogDetail(event)
    case 'inspect': return await inspect(event, wxContext)
    case 'updateWorkLog': return await updateWorkLog(event, wxContext)
    default: return { code: -1, msg: '未知操作' }
  }
}

// 员工提交报工 - 快照单价
async function submitWorkLog(event) {
  const { user_id, user_name, process_id, order_id, quantity } = event
  if (!user_id || !process_id || !quantity || quantity <= 0) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    // 获取工序当前单价（快照）
    const processRes = await db.collection('Processes').doc(process_id).get()
    if (!processRes.data) {
      return { code: -1, msg: '工序不存在' }
    }

    const process = processRes.data
    const snapshotPrice = process.current_price

    // 获取订单名
    let orderName = ''
    try {
      const orderRes = await db.collection('Orders').doc(order_id).get()
      orderName = orderRes.data ? orderRes.data.order_name : ''
    } catch (e) {}

    const today = new Date()
    const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    await db.collection('WorkLogs').add({
      data: {
        user_id,
        user_name: user_name || '',
        process_id,
        process_name: process.process_name,
        order_id,
        order_name: orderName,
        quantity: parseInt(quantity),
        snapshot_price: snapshotPrice,
        amount: Math.round(parseInt(quantity) * snapshotPrice * 100) / 100,
        status: 'pending',
        passed_qty: 0,
        inspected_by: null,
        inspected_at: null,
        date: dateStr,
        created_at: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: '报工提交成功',
      data: {
        amount: Math.round(parseInt(quantity) * snapshotPrice * 100) / 100,
        snapshot_price: snapshotPrice
      }
    }
  } catch (err) {
    return { code: -1, msg: '提交失败: ' + err.message }
  }
}

// 获取今日收入
async function getTodayEarnings(event) {
  const { user_id } = event
  const today = new Date()
  const dateStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

  try {
    const res = await db.collection('WorkLogs').where({
      user_id,
      date: dateStr
    }).get()

    let totalAmount = 0
    let totalQuantity = 0
    res.data.forEach(r => {
      totalAmount += r.amount || 0
      totalQuantity += r.quantity || 0
    })

    return {
      code: 0,
      data: {
        earnings: Math.round(totalAmount * 100) / 100,
        quantity: totalQuantity,
        logs: res.data
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取收入失败' }
  }
}

// 获取用户报工记录
async function getUserLogs(event) {
  const { user_id, month } = event
  const now = new Date()
  let startDate, endDate, currentMonth

  if (month) {
    startDate = month + '-01'
    currentMonth = month
    const parts = month.split('-')
    const m = parseInt(parts[1])
    endDate = m >= 12
      ? `${parseInt(parts[0]) + 1}-01-01`
      : `${parts[0]}-${String(m + 1).padStart(2, '0')}-01`
  } else {
    currentMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const m = now.getMonth() + 2
    endDate = m > 12
      ? `${now.getFullYear() + 1}-01-01`
      : `${now.getFullYear()}-${String(m).padStart(2, '0')}-01`
  }

  try {
    const res = await db.collection('WorkLogs').where({
      user_id,
      date: _.gte(startDate).and(_.lt(endDate))
    }).orderBy('created_at', 'desc').limit(200).get()

    // 检查该月发薪锁定状态
    const paidRes = await db.collection('SalaryPayments').where({
      user_id: user_id,
      month: currentMonth,
      paid: true
    }).get()
    const isPaidLocked = paidRes.data.length > 0

    const today = new Date()
    const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`

    const data = res.data.map(log => ({
      ...log,
      is_locked: isPaidLocked,
      is_today: log.date === todayStr,
      lock_reason: isPaidLocked ? '该月工资已发放' : ''
    }))

    return { code: 0, data: data }
  } catch (err) {
    return { code: -1, msg: '获取记录失败' }
  }
}

// 获取某月所有报工记录（老板专用）
async function getMonthLogs(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { month } = event
  const now = new Date()
  let startDate, endDate

  if (month) {
    startDate = month + '-01'
    const parts = month.split('-')
    const m = parseInt(parts[1])
    endDate = m >= 12
      ? `${parseInt(parts[0]) + 1}-01-01`
      : `${parts[0]}-${String(m + 1).padStart(2, '0')}-01`
  } else {
    startDate = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
    const m = now.getMonth() + 2
    endDate = m > 12
      ? `${now.getFullYear() + 1}-01-01`
      : `${now.getFullYear()}-${String(m).padStart(2, '0')}-01`
  }

  try {
    // 云数据库单次最多100条，需要分页获取
    let allLogs = []
    let lastLen = 0
    do {
      const res = await db.collection('WorkLogs').where({
        date: _.gte(startDate).and(_.lt(endDate))
      }).orderBy('created_at', 'desc').skip(allLogs.length).limit(100).get()
      lastLen = res.data.length
      allLogs = allLogs.concat(res.data)
    } while (lastLen === 100)

    return { code: 0, data: allLogs }
  } catch (err) {
    return { code: -1, msg: '获取月报工记录失败: ' + err.message }
  }
}

// QC获取待检列表
async function getPendingLogs(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || (caller.role !== 'qc' && caller.role !== 'boss')) {
    return { code: -1, msg: '权限不足' }
  }

  try {
    const res = await db.collection('WorkLogs').where({
      status: 'pending'
    }).orderBy('created_at', 'desc').limit(100).get()

    return { code: 0, data: res.data }
  } catch (err) {
    return { code: -1, msg: '获取待检列表失败' }
  }
}

// QC获取已检列表
async function getInspectedLogs(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || (caller.role !== 'qc' && caller.role !== 'boss')) {
    return { code: -1, msg: '权限不足' }
  }

  try {
    const res = await db.collection('WorkLogs').where({
      status: 'inspected'
    }).orderBy('inspected_at', 'desc').limit(100).get()

    return { code: 0, data: res.data }
  } catch (err) {
    return { code: -1, msg: '获取已检列表失败' }
  }
}

// 获取报工详情
async function getLogDetail(event) {
  const { log_id } = event
  try {
    const res = await db.collection('WorkLogs').doc(log_id).get()
    return { code: 0, data: res.data }
  } catch (err) {
    return { code: -1, msg: '获取详情失败' }
  }
}

// QC质检
async function inspect(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || (caller.role !== 'qc' && caller.role !== 'boss')) {
    return { code: -1, msg: '权限不足，仅质检员可操作' }
  }

  const { log_id, passed_qty } = event
  if (!log_id || passed_qty === undefined) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    const logRes = await db.collection('WorkLogs').doc(log_id).get()
    if (!logRes.data) {
      return { code: -1, msg: '报工记录不存在' }
    }

    const log = logRes.data
    if (log.status === 'inspected') {
      return { code: -1, msg: '已质检，请勿重复操作' }
    }

    const passedQty = parseInt(passed_qty)
    if (passedQty < 0 || passedQty > log.quantity) {
      return { code: -1, msg: '合格数量无效' }
    }

    // 重算金额（合格数量 × 快照单价）
    const finalAmount = Math.round(passedQty * log.snapshot_price * 100) / 100

    await db.collection('WorkLogs').doc(log_id).update({
      data: {
        passed_qty: passedQty,
        amount: finalAmount,
        status: 'inspected',
        inspected_by: caller._id,
        inspected_by_name: caller.name,
        inspected_at: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: '质检完成',
      data: { passed_qty: passedQty, final_amount: finalAmount }
    }
  } catch (err) {
    return { code: -1, msg: '质检失败: ' + err.message }
  }
}

// 修改报工记录（含权限校验 + 发薪锁定 + 审计留痕）
async function updateWorkLog(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller) return { code: -1, msg: '未登录或用户不存在' }

  const { log_id, quantity, note, reason, process_id, order_id } = event
  if (!log_id) return { code: -1, msg: '缺少报工记录ID' }
  if (!reason) return { code: -1, msg: '请填写修改原因' }

  try {
    const logRes = await db.collection('WorkLogs').doc(log_id).get()
    if (!logRes.data) return { code: -1, msg: '报工记录不存在' }
    const log = logRes.data

    // 权限校验
    if (caller.role === 'employee') {
      // 员工只能改自己的
      if (log.user_id !== caller._id) {
        return { code: -1, msg: '无权修改他人报工记录' }
      }
      // 员工只能改当天的
      const today = new Date()
      const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
      if (log.date !== todayStr) {
        return { code: -1, msg: '只能修改当日的报工记录' }
      }
    } else if (caller.role !== 'boss') {
      return { code: -1, msg: '无权修改报工记录' }
    }

    // 发薪锁定检查
    const locked = await isPeriodLocked(log.user_id, log.date)
    if (locked) {
      return { code: -1, msg: '该月工资已发放，报工记录已锁定，无法修改' }
    }

    // 构建更新数据及审计记录
    const updateData = { updated_at: db.serverDate() }
    const auditChanges = []

    if (quantity !== undefined && quantity !== null && parseInt(quantity) !== log.quantity) {
      const newQty = parseInt(quantity)
      if (newQty <= 0) return { code: -1, msg: '报工数量必须大于0' }
      auditChanges.push({
        field: 'quantity',
        old_value: log.quantity,
        new_value: newQty
      })
      updateData.quantity = newQty
      updateData.amount = Math.round(newQty * (log.snapshot_price || 0) * 100) / 100
    }

    if (note !== undefined && note !== log.note) {
      auditChanges.push({
        field: 'note',
        old_value: log.note || '',
        new_value: note || ''
      })
      updateData.note = note || ''
    }

    // 管理员可更正工序/订单归属
    if (caller.role === 'boss' && process_id && process_id !== log.process_id) {
      const processRes = await db.collection('Processes').doc(process_id).get()
      if (!processRes.data) return { code: -1, msg: '目标工序不存在' }
      auditChanges.push({
        field: 'process_id',
        old_value: log.process_id,
        new_value: process_id
      })
      updateData.process_id = process_id
      updateData.process_name = processRes.data.process_name
      updateData.snapshot_price = processRes.data.current_price
      // 用新单价重算金额
      const qty = updateData.quantity || log.quantity
      updateData.amount = Math.round(qty * processRes.data.current_price * 100) / 100
    }

    if (caller.role === 'boss' && order_id && order_id !== log.order_id) {
      let orderName = ''
      try {
        const orderRes = await db.collection('Orders').doc(order_id).get()
        orderName = orderRes.data ? orderRes.data.order_name : ''
      } catch (e) {}
      auditChanges.push({
        field: 'order_id',
        old_value: log.order_id,
        new_value: order_id
      })
      updateData.order_id = order_id
      updateData.order_name = orderName
    }

    if (auditChanges.length === 0) {
      return { code: 0, msg: '未检测到修改' }
    }

    // 更新报工记录
    await db.collection('WorkLogs').doc(log_id).update({ data: updateData })

    // 写入审计日志 WorkLogAudit
    await db.collection('audit_logs').add({
      data: {
        action: 'worklog_update',
        worklog_id: log_id,
        target_user_id: log.user_id,
        target_user_name: log.user_name,
        operator_id: caller._id,
        operator_name: caller.name,
        operator_role: caller.role,
        changes: auditChanges,
        reason: reason,
        created_at: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: '报工记录修改成功',
      data: { changes: auditChanges }
    }
  } catch (err) {
    return { code: -1, msg: '修改失败: ' + err.message }
  }
}
