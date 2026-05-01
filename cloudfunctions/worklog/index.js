// 云函数 - worklog (报工管理) — 已统一为北京时间
const cloud = require('wx-server-sdk')
const bjTime = require('./beijing-time')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const MAX_TX_RETRIES = 3

async function getCallerUser(wxContext) {
  const res = await db.collection('Users').where({
    openid: wxContext.OPENID,
    status: 'active'
  }).orderBy('last_login', 'desc').limit(20).get()
  return res.data.length > 0 ? res.data[0] : null
}

async function getCallerUserByEvent(event, wxContext) {
  const authUserId = event && event.auth_user_id
  const authSessionToken = event && event.auth_session_token

  if (authUserId && authSessionToken) {
    try {
      const exactRes = await db.collection('Users').where({
        _id: authUserId,
        session_token: authSessionToken,
        status: 'active'
      }).limit(1).get()
      if (exactRes.data.length > 0) {
        const user = exactRes.data[0]
        if (user.org_id) {
          try {
            const orgRes = await db.collection('Organizations').doc(user.org_id).get()
            if (!orgRes.data || orgRes.data.status !== 'active') return null
          } catch (e) {
            return null
          }
        }
        return user
      }
    } catch (err) {}
  }

  const fallbackUser = await getCallerUser(wxContext)
  if (!fallbackUser) return null
  if (!authUserId) return fallbackUser
  if (String(fallbackUser._id) === String(authUserId)) return fallbackUser

  try {
    const matchedRes = await db.collection('Users').where({
      openid: wxContext.OPENID,
      status: 'active'
    }).orderBy('last_login', 'desc').limit(20).get()
    const matched = matchedRes.data.find(item => String(item._id) === String(authUserId))
    return matched || fallbackUser
  } catch (err) {
    return fallbackUser
  }
}

function getOrgId(user) {
  return user && user.org_id ? user.org_id : ''
}

function ensureSameOrg(doc, caller) {
  return !!(doc && caller && getOrgId(caller) && doc.org_id === getOrgId(caller))
}

async function ensureWritableEntitlement(caller) {
  const orgId = getOrgId(caller)
  if (!orgId || caller.platform_role === 'platform_admin') return { ok: true }

  try {
    const orgRes = await db.collection('Organizations').doc(orgId).get()
    const org = orgRes.data
    if (!org || org.status !== 'active') return { ok: false, msg: '工厂已停用，请联系平台管理员' }
    const billingStatus = org.billing_status || 'not_enabled'
    if (billingStatus === 'not_enabled') return { ok: true }
    if (billingStatus === 'disabled' || billingStatus === 'expired') {
      return { ok: false, msg: '工厂服务已到期，请联系老板处理' }
    }

    const now = Date.now()
    const endTs = toTimestamp(org.current_period_end || org.trial_end)
    const graceTs = toTimestamp(org.grace_until)
    if (endTs && now > endTs && (!graceTs || now > graceTs)) {
      return { ok: false, msg: '工厂服务已到期，请联系老板处理' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: '服务状态校验失败，请稍后重试' }
  }
}

// 检查某用户某月是否已发薪锁定
async function isPeriodLocked(userId, dateStr, orgId) {
  const month = dateStr.substring(0, 7) // YYYY-MM
  const paidRes = await db.collection('SalaryPayments').where({
    org_id: orgId,
    user_id: userId,
    month: month,
    paid: true
  }).get()
  return paidRes.data.length > 0
}

async function getPeriodPaidRecord(userId, dateStr, orgId) {
  const month = dateStr.substring(0, 7)
  const paidRes = await db.collection('SalaryPayments').where({
    org_id: orgId,
    user_id: userId,
    month,
    paid: true
  }).orderBy('paid_at', 'desc').limit(1).get()
  return (paidRes.data && paidRes.data[0]) || null
}

function toTimestamp(input) {
  if (!input) return 0
  if (input instanceof Date) return input.getTime()
  if (typeof input === 'number') return input
  if (typeof input === 'string') {
    const t = new Date(input).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (input.$date) {
    const t = new Date(input.$date).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (input.seconds) {
    return toInt(input.seconds) * 1000 + Math.floor((toInt(input.nanoseconds) || 0) / 1000000)
  }
  return 0
}

function getSortableTime(doc, fields) {
  const candidates = fields || ['created_at', 'updated_at', 'date']
  for (const field of candidates) {
    const ts = toTimestamp(doc && doc[field])
    if (ts) return ts
  }
  return 0
}

function sortDocsByFields(list, fields, direction) {
  const multiplier = direction === 'asc' ? 1 : -1
  return (list || []).slice().sort((a, b) => {
    const diff = getSortableTime(a, fields) - getSortableTime(b, fields)
    if (diff !== 0) return diff * multiplier
    return String(a._id || '').localeCompare(String(b._id || '')) * multiplier
  })
}

async function fetchAllDocs(collectionName, where, pageSize = 100) {
  const all = []
  let batchLen = 0
  do {
    const res = await db.collection(collectionName)
      .where(where)
      .skip(all.length)
      .limit(pageSize)
      .get()
    batchLen = (res.data || []).length
    all.push(...(res.data || []))
  } while (batchLen === pageSize)
  return all
}

function formatTwoDigits(num) {
  return String(num).padStart(2, '0')
}

function formatWorkLogTime(log) {
  if (!log) return ''

  var ts = toTimestamp(log.created_at)
  if (ts > 0) {
    return bjTime.formatBeijingDateTime(ts)
  }

  if (log.date) {
    return log.date + ' --:--'
  }

  return ''
}

function toInt(val) {
  const num = parseInt(val, 10)
  return Number.isNaN(num) ? 0 : num
}

function getOrderTotalQuantity(orderDoc) {
  if (!orderDoc) return 0
  return toInt(orderDoc.total_quantity || orderDoc.order_total_quantity || 0)
}

function getWorkLogQuantity(logDoc) {
  if (!logDoc) return 0
  return toInt(logDoc.quantity || logDoc.report_quantity || 0)
}

function normalizeSnapshotPrice(value) {
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

async function sumProcessReportedQuantity(orderId, processId, excludeLogId = null, dbInstance = db, orgId = '') {
  if (!orderId || !processId) return 0

  let total = 0
  let logs = []
  let batchLen = 0

  do {
    const res = await dbInstance.collection('WorkLogs').where({
      org_id: orgId,
      order_id: orderId,
      process_id: processId
    }).skip(logs.length).limit(100).get()

    batchLen = res.data.length
    logs = logs.concat(res.data)
  } while (batchLen === 100)

  logs.forEach((item) => {
    if (excludeLogId && item._id === excludeLogId) return
    total += getWorkLogQuantity(item)
  })

  return total
}

async function getProcessQuotaSnapshot(orderId, processId, excludeLogId = null, orgId = '') {
  if (!orderId || !processId) {
    return { ok: false, msg: '缺少订单或工序信息' }
  }

  try {
    const orderRes = await db.collection('Orders').doc(orderId).get()
    if (!orderRes.data || orderRes.data.org_id !== orgId) {
      return { ok: false, msg: '订单不存在' }
    }

    const orderTotal = getOrderTotalQuantity(orderRes.data)
    if (orderTotal <= 0) {
      return { ok: false, msg: '订单总量配置无效' }
    }

    const processRes = await db.collection('Processes').doc(processId).get()
    if (!processRes.data || processRes.data.org_id !== orgId || processRes.data.order_id !== orderId) {
      return { ok: false, msg: '工序不存在' }
    }

    const currentTotal = await sumProcessReportedQuantity(orderId, processId, excludeLogId, db, orgId)
    const remaining = Math.max(orderTotal - currentTotal, 0)

    return {
      ok: true,
      data: {
        order_total_quantity: orderTotal,
        current_total: currentTotal,
        remaining_quantity: remaining
      }
    }
  } catch (err) {
    return { ok: false, msg: '获取工序报工额度失败' }
  }
}

async function submitWorkLogWithQuotaGuard(payload) {
  const {
    user_id,
    user_name,
    process_id,
    process_name,
    order_id,
    order_name,
    quantity,
    snapshot_price,
    date,
    org_id,
    note
  } = payload

  let retry = 0
  while (retry < MAX_TX_RETRIES) {
    const transaction = await db.startTransaction()
    try {
      const orderRes = await transaction.collection('Orders').doc(order_id).get()
      if (!orderRes.data || orderRes.data.org_id !== org_id) {
        await transaction.rollback()
        return { code: -1, msg: '订单不存在' }
      }

      const orderTotal = getOrderTotalQuantity(orderRes.data)
      if (orderTotal <= 0) {
        await transaction.rollback()
        return { code: -1, msg: '订单总量配置无效' }
      }

      if (orderRes.data.status === 'completed') {
        await transaction.rollback()
        return { code: -1, msg: '该订单已完成，员工不可再报工' }
      }

      const currentTotal = await sumProcessReportedQuantity(order_id, process_id, null, transaction, org_id)
      const newTotal = currentTotal + quantity
      if (newTotal > orderTotal) {
        await transaction.rollback()
        const remaining = Math.max(orderTotal - currentTotal, 0)
        return {
          code: -1,
          msg: '报工失败：该工序累计报工数量不能超过订单总数量',
          data: {
            order_total_quantity: orderTotal,
            current_total: currentTotal,
            remaining_quantity: remaining
          }
        }
      }

      await transaction.collection('Orders').doc(order_id).update({
        data: {
          report_lock_version: _.inc(1),
          updated_at: db.serverDate()
        }
      })

      await transaction.collection('WorkLogs').add({
        data: {
          org_id,
          user_id,
          user_name: user_name || '',
          process_id,
          process_name,
          order_id,
          order_name,
          quantity,
          snapshot_price,
          amount: Math.round(quantity * snapshot_price * 100) / 100,
          status: 'pending',
          qc_status: 'pending',
          passed_qty: 0,
          inspected_by: null,
          inspected_at: null,
          date,
          note: note || '',
          period_key: date ? date.substring(0, 7) : '',
          created_at: db.serverDate()
        }
      })

      await transaction.commit()
      return {
        code: 0,
        msg: '报工提交成功',
        data: {
          amount: Math.round(quantity * snapshot_price * 100) / 100,
          snapshot_price
        }
      }
    } catch (err) {
      try { await transaction.rollback() } catch (e) {}

      // 并发写冲突时自动重试，避免并发下超额
      if (String(err.message || '').indexOf('conflict') >= 0 || String(err.errMsg || '').indexOf('conflict') >= 0) {
        retry += 1
        continue
      }

      return { code: -1, msg: '提交失败: ' + err.message }
    }
  }

  return { code: -1, msg: '提交失败：并发冲突，请重试' }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  switch (action) {
    case 'submit': return await submitWorkLog(event, wxContext)
    case 'getProcessQuota': return await getProcessQuota(event, wxContext)
    case 'getTodayEarnings': return await getTodayEarnings(event, wxContext)
    case 'getUserLogs': return await getUserLogs(event, wxContext)
    case 'getMonthLogs': return await getMonthLogs(event, wxContext)
    case 'getPeriodLogs': return await getPeriodLogs(event, wxContext)
    case 'getManageLogs': return await getManageLogs(event, wxContext)
    case 'getOrderProgress': return await getOrderProgress(event, wxContext)
    case 'getPendingLogs': return await getPendingLogs(event, wxContext)
    case 'getInspectedLogs': return await getInspectedLogs(event, wxContext)
    case 'getLogDetail': return await getLogDetail(event, wxContext)
    case 'inspect': return await inspect(event, wxContext)
    case 'updateWorkLog': return await updateWorkLog(event, wxContext)
    case 'deleteWorkLog': return await deleteWorkLog(event, wxContext)
    case 'cancelOwnWorkLog': return await cancelOwnWorkLog(event, wxContext)
    default: return { code: -1, msg: '未知操作' }
  }
}

// 员工撤销自己的报工（防误报）
async function cancelOwnWorkLog(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) {
    return { code: -1, msg: '登录状态失效，请重新登录后再试' }
  }

  const { log_id, reason } = event
  if (!log_id) return { code: -1, msg: '缺少报工记录ID' }

  try {
    const logRes = await db.collection('WorkLogs').doc(log_id).get()
    const log = logRes.data
    if (!log) return { code: -1, msg: '报工记录不存在' }
    if (!ensureSameOrg(log, caller)) return { code: -1, msg: '无权撤销其他工厂报工记录' }

    // 只允许撤销本人提交的记录，角色不做额外限制，避免账号角色标记差异导致误拦截
    if (String(log.user_id) !== String(caller._id)) {
      return { code: -1, msg: '只能撤销自己的报工记录' }
    }

    const todayStr = bjTime.getBeijingToday()
    if (log.date !== todayStr) {
      return { code: -1, msg: '仅支持撤销当日报工记录' }
    }

    // 已完成订单不可撤销
    try {
      const orderRes = await db.collection('Orders').doc(log.order_id).get()
      if (!ensureSameOrg(orderRes.data, caller)) {
        return { code: -1, msg: '订单状态校验失败' }
      }
      if (orderRes.data && orderRes.data.status === 'completed') {
        return { code: -1, msg: '该订单已完成，员工不可撤销相关报工' }
      }
    } catch (e) {
      return { code: -1, msg: '订单状态校验失败' }
    }

    // 发薪锁定遵循时间顺序：报工时间晚于发薪时间时允许撤销
    const paidRecord = await getPeriodPaidRecord(log.user_id, log.date, getOrgId(caller))
    if (paidRecord) {
      const paidAtTs = toTimestamp(paidRecord.paid_at)
      const logCreatedTs = toTimestamp(log.created_at)
      if (paidAtTs > 0 && logCreatedTs > 0 && logCreatedTs <= paidAtTs) {
        return { code: -1, msg: '该报工发生在发薪之前，已锁定，无法撤销' }
      }
    }

    await db.collection('WorkLogs').doc(log_id).remove()

    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        action: 'worklog_self_cancel',
        worklog_id: log_id,
        target_user_id: log.user_id,
        target_user_name: log.user_name,
        operator_id: caller._id,
        operator_name: caller.name,
        operator_role: caller.role,
        details: `${log.user_name || '员工'} 撤销当日报工 ${log.quantity || 0} 件`,
        reason: reason || '员工误报撤销',
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '报工记录已撤销' }
  } catch (err) {
    return { code: -1, msg: '撤销失败: ' + err.message }
  }
}

async function getProcessQuota(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) {
    return { code: -1, msg: '登录状态失效，请重新登录后再试' }
  }
  const { order_id, process_id, exclude_log_id } = event
  const quota = await getProcessQuotaSnapshot(order_id, process_id, exclude_log_id || null, getOrgId(caller))
  if (!quota.ok) {
    return { code: -1, msg: quota.msg }
  }
  return { code: 0, data: quota.data }
}

function getMonthRange(month) {
  var r = bjTime.getBeijingMonthRange(month)
  return { start: r.startDate, end: r.endDate }
}

function getYearRange(yearValue) {
  var r = bjTime.getBeijingYearRange(yearValue)
  return { start: r.startDate, end: r.endDate }
}

async function fetchLogsByDateRange(startDate, endDate, orgId) {
  const allLogs = await fetchAllDocs('WorkLogs', {
      org_id: orgId,
      date: _.gte(startDate).and(_.lt(endDate))
    })
  return sortDocsByFields(allLogs, ['created_at', 'date'], 'desc')
}

// 老板报工管理：按日/按月/按订单查询所有员工报工
async function getManageLogs(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { view_type, date, month, order_id, process_id } = event
  const where = { org_id: getOrgId(caller) }

  if (view_type === 'day') {
    if (!date) return { code: -1, msg: '请选择日期' }
    where.date = date
  } else if (view_type === 'month') {
    if (!month) return { code: -1, msg: '请选择月份' }
    const range = getMonthRange(month)
    where.date = _.gte(range.start).and(_.lt(range.end))
  } else if (view_type === 'order') {
    if (!order_id) return { code: -1, msg: '请选择订单' }
    const orderRes = await db.collection('Orders').doc(order_id).get()
    if (!ensureSameOrg(orderRes.data, caller)) return { code: -1, msg: '无权查看该订单报工' }
    where.order_id = order_id
    if (process_id) {
      const processRes = await db.collection('Processes').doc(process_id).get()
      if (!ensureSameOrg(processRes.data, caller) || processRes.data.order_id !== order_id) {
        return { code: -1, msg: '无权查看该工序报工' }
      }
      where.process_id = process_id
    }
    if (month) {
      const range = getMonthRange(month)
      where.date = _.gte(range.start).and(_.lt(range.end))
    }
  } else if (view_type === 'process') {
    if (!order_id || !process_id) return { code: -1, msg: '请选择订单和工序' }
    const orderRes = await db.collection('Orders').doc(order_id).get()
    if (!ensureSameOrg(orderRes.data, caller)) return { code: -1, msg: '无权查看该订单报工' }
    const processRes = await db.collection('Processes').doc(process_id).get()
    if (!ensureSameOrg(processRes.data, caller) || processRes.data.order_id !== order_id) {
      return { code: -1, msg: '无权查看该工序报工' }
    }
    where.order_id = order_id
    where.process_id = process_id
  } else {
    const defaultMonth = bjTime.getBeijingMonth()
    const range = getMonthRange(defaultMonth)
    where.date = _.gte(range.start).and(_.lt(range.end))
  }

  try {
    const allLogs = sortDocsByFields(
      await fetchAllDocs('WorkLogs', where),
      ['created_at', 'date'],
      'desc'
    )

    return { code: 0, data: allLogs }
  } catch (err) {
    return { code: -1, msg: '获取报工记录失败: ' + err.message }
  }
}

async function getOrderProgress(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { order_id } = event
  if (!order_id) return { code: -1, msg: '请选择订单' }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    const order = orderRes.data
    if (!order) return { code: -1, msg: '订单不存在' }
    if (!ensureSameOrg(order, caller)) return { code: -1, msg: '无权查看该订单进度' }

    // 获取所有工序
    let allProcesses = []
    let batchLen = 0
    do {
      const res = await db.collection('Processes').where({ org_id: getOrgId(caller), order_id })
        .skip(allProcesses.length).limit(100).get()
      batchLen = res.data.length
      allProcesses = allProcesses.concat(res.data)
    } while (batchLen === 100)

    // 获取该订单所有报工
    let allLogs = []
    batchLen = 0
    do {
      const res = await db.collection('WorkLogs').where({ org_id: getOrgId(caller), order_id })
        .skip(allLogs.length).limit(100).get()
      batchLen = res.data.length
      allLogs = allLogs.concat(res.data)
    } while (batchLen === 100)

    // 按工序聚合
    const totalQty = order.total_quantity || 0
    const processes = allProcesses.map(proc => {
      const logs = allLogs.filter(l => l.process_id === proc._id)
      const totalReported = logs.reduce((s, l) => s + (Number(l.quantity) || 0), 0)
      const employeeIds = [...new Set(logs.map(l => l.user_id))]
      const progressPercent = totalQty > 0 ? Math.min(100, Math.round(totalReported / totalQty * 100)) : 0
      return {
        _id: proc._id,
        process_name: proc.process_name,
        current_price: proc.current_price,
        assigned_count: (proc.assigned_user_ids || []).length,
        total_reported: totalReported,
        employee_count: employeeIds.length,
        progress_percent: progressPercent
      }
    })

    // 整体进度：取各工序中报工最多的那个工序的数量，而非所有工序累加
    const overallReported = processes.length > 0
      ? Math.max(...processes.map(p => p.total_reported))
      : 0
    const overallPercent = totalQty > 0 ? Math.min(100, Math.round(overallReported / totalQty * 100)) : 0

    return {
      code: 0,
      data: {
        order_name: order.order_name,
        total_quantity: totalQty,
        overall_reported: overallReported,
        overall_percent: overallPercent,
        processes
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取进度失败: ' + err.message }
  }
}

// 员工提交报工 - 快照单价
async function submitWorkLog(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) {
    return { code: -1, msg: '登录状态失效，请重新登录后再试' }
  }

  const entitlement = await ensureWritableEntitlement(caller)
  if (!entitlement.ok) return { code: -1, msg: entitlement.msg }

  const { user_id, process_id, order_id, quantity, note } = event
  let { user_name } = event
  if (!user_id || !process_id || !quantity || quantity <= 0) {
    return { code: -1, msg: '参数不完整' }
  }

  // 只允许本人报工或老板代报
  if (String(caller._id) !== String(user_id) && caller.role !== 'boss') {
    return { code: -1, msg: '无权为他人提交报工' }
  }
  if (caller.role === 'boss') {
    const targetUserRes = await db.collection('Users').doc(user_id).get()
    if (!ensureSameOrg(targetUserRes.data, caller)) {
      return { code: -1, msg: '无权为其他工厂员工提交报工' }
    }
    user_name = targetUserRes.data.name || user_name || ''
  }

  try {
    // 获取工序当前单价（快照）
    const processRes = await db.collection('Processes').doc(process_id).get()
    if (!processRes.data) {
      return { code: -1, msg: '工序不存在' }
    }

    const process = processRes.data
    if (!ensureSameOrg(process, caller)) {
      return { code: -1, msg: '工序不存在' }
    }
    if (process.order_id !== order_id) {
      return { code: -1, msg: '工序与订单不匹配' }
    }
    const snapshotPrice = normalizeSnapshotPrice(process.current_price)

    // 工价未设置时禁止报工
    if (!snapshotPrice) {
      return { code: -1, msg: '该工序尚未设置工价，请联系管理员设置后再报工' }
    }

    // 获取订单名
    let orderName = ''
    try {
      const orderRes = await db.collection('Orders').doc(order_id).get()
      if (!ensureSameOrg(orderRes.data, caller)) return { code: -1, msg: '订单不存在' }
      orderName = orderRes.data ? orderRes.data.order_name : ''
    } catch (e) {}

    const dateStr = bjTime.getBeijingToday()

    return await submitWorkLogWithQuotaGuard({
      user_id,
      user_name,
      process_id,
      process_name: process.process_name,
      order_id,
      order_name: orderName,
      quantity: toInt(quantity),
      snapshot_price: snapshotPrice,
      date: dateStr,
      note: note || '',
      org_id: getOrgId(caller)
    })
  } catch (err) {
    return { code: -1, msg: '提交失败: ' + err.message }
  }
}

// 获取今日收入
async function getTodayEarnings(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) {
    return { code: -1, msg: '登录状态失效，请重新登录后再试' }
  }

  const { user_id } = event

  if (String(caller._id) !== String(user_id) && caller.role !== 'boss') {
    return { code: -1, msg: '无权查看他人收入' }
  }

  const dateStr = bjTime.getBeijingToday()

  try {
    const res = await db.collection('WorkLogs').where({
      org_id: getOrgId(caller),
      user_id,
      date: dateStr
    }).get()

    // 批量查询相关订单的 price_hidden 状态
    const orderIds = [...new Set(res.data.map(r => r.order_id).filter(Boolean))]
    const orderHiddenMap = {}
    if (orderIds.length > 0) {
      for (let i = 0; i < orderIds.length; i += 100) {
        const batch = orderIds.slice(i, i + 100)
        const orderRes = await db.collection('Orders').where({
          org_id: getOrgId(caller),
          _id: _.in(batch)
        }).field({ _id: true, price_hidden: true }).get()
        orderRes.data.forEach(o => {
          orderHiddenMap[o._id] = o.price_hidden === true
        })
      }
    }

    let totalAmount = 0
    let totalQuantity = 0
    res.data.forEach(r => {
      totalQuantity += r.quantity || 0
      if (!orderHiddenMap[r.order_id]) {
        totalAmount += r.amount || 0
      }
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
async function getUserLogs(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) {
    return { code: -1, msg: '登录状态失效，请重新登录后再试' }
  }

  const { user_id, month } = event

  if (String(caller._id) !== String(user_id) && caller.role !== 'boss') {
    return { code: -1, msg: '无权查看他人报工记录' }
  }

  let startDate, endDate, currentMonth

  if (month) {
    var range = getMonthRange(month)
    startDate = range.start
    endDate = range.end
    currentMonth = month
  } else {
    currentMonth = bjTime.getBeijingMonth()
    var defRange = getMonthRange(currentMonth)
    startDate = defRange.start
    endDate = defRange.end
  }

  try {
    const allLogs = sortDocsByFields(await fetchAllDocs('WorkLogs', {
      org_id: getOrgId(caller),
      user_id,
      date: _.gte(startDate).and(_.lt(endDate))
    }), ['created_at', 'date'], 'desc')

    // 检查该月发薪锁定状态
    const paidRes = await db.collection('SalaryPayments').where({
      org_id: getOrgId(caller),
      user_id: user_id,
      month: currentMonth,
      paid: true
    }).get()
    const isPaidLocked = paidRes.data.length > 0

    // 批量查询相关订单的 price_hidden 状态
    const orderIds = [...new Set(allLogs.map(log => log.order_id).filter(Boolean))]
    const orderHiddenMap = {}
    for (let i = 0; i < orderIds.length; i += 100) {
      const batch = orderIds.slice(i, i + 100)
      const orderRes = await db.collection('Orders').where({
        org_id: getOrgId(caller),
        _id: _.in(batch)
      }).field({ _id: true, price_hidden: true }).get()
      orderRes.data.forEach(o => {
        orderHiddenMap[o._id] = o.price_hidden === true
      })
    }

    const todayStr = bjTime.getBeijingToday()

    const data = allLogs.map(log => {
      const priceHidden = orderHiddenMap[log.order_id] === true || isPaidLocked
      return {
        ...log,
        report_time_text: formatWorkLogTime(log),
        is_locked: isPaidLocked,
        is_today: log.date === todayStr,
        lock_reason: isPaidLocked ? '该月工资已发放' : '',
        price_hidden: priceHidden
      }
    })

    return { code: 0, data: data }
  } catch (err) {
    return { code: -1, msg: '获取记录失败' }
  }
}

// 获取某月所有报工记录（老板专用）
async function getPeriodLogs(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const dimension = event.dimension === 'year' ? 'year' : 'month'
  const range = dimension === 'year'
    ? getYearRange(event.year)
    : getMonthRange(event.month || bjTime.getBeijingMonth())

  try {
    const logs = await fetchLogsByDateRange(range.start, range.end, getOrgId(caller))
    return { code: 0, data: logs }
  } catch (err) {
    return { code: -1, msg: '获取报工记录失败: ' + err.message }
  }
}

async function getMonthLogs(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { month } = event
  let startDate, endDate

  if (month) {
    var range = getMonthRange(month)
    startDate = range.start
    endDate = range.end
  } else {
    var defRange = getMonthRange(bjTime.getBeijingMonth())
    startDate = defRange.start
    endDate = defRange.end
  }

  try {
    // 云数据库单次最多100条，需要分页获取
    const logs = await fetchLogsByDateRange(startDate, endDate, getOrgId(caller))
    return { code: 0, data: logs }
  } catch (err) {
    return { code: -1, msg: '获取月报工记录失败: ' + err.message }
  }
}

// QC获取待检列表
async function getPendingLogs(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || (caller.role !== 'qc' && caller.role !== 'boss')) {
    return { code: -1, msg: '权限不足' }
  }

  try {
    const data = sortDocsByFields(await fetchAllDocs('WorkLogs', {
      org_id: getOrgId(caller),
      status: 'pending'
    }), ['created_at', 'date'], 'desc').slice(0, 100)

    return { code: 0, data }
  } catch (err) {
    return { code: -1, msg: '获取待检列表失败' }
  }
}

// QC获取已检列表
async function getInspectedLogs(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || (caller.role !== 'qc' && caller.role !== 'boss')) {
    return { code: -1, msg: '权限不足' }
  }

  try {
    const data = sortDocsByFields(await fetchAllDocs('WorkLogs', {
      org_id: getOrgId(caller),
      status: 'inspected'
    }), ['inspected_at', 'created_at', 'date'], 'desc').slice(0, 100)

    return { code: 0, data }
  } catch (err) {
    return { code: -1, msg: '获取已检列表失败' }
  }
}

// 获取报工详情
async function getLogDetail(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) {
    return { code: -1, msg: '登录状态失效，请重新登录后再试' }
  }

  const { log_id } = event
  try {
    const res = await db.collection('WorkLogs').doc(log_id).get()
    if (res.data && !ensureSameOrg(res.data, caller)) {
      return { code: -1, msg: '无权查看该报工详情' }
    }

    // 只允许本人或老板查看
    if (res.data && String(caller._id) !== String(res.data.user_id) && caller.role !== 'boss' && caller.role !== 'qc') {
      return { code: -1, msg: '无权查看该报工详情' }
    }

    return { code: 0, data: res.data }
  } catch (err) {
    return { code: -1, msg: '获取详情失败' }
  }
}

// 老板删除报工记录
async function deleteWorkLog(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足，仅管理员可删除' }
  }

  const { log_id, reason } = event
  if (!log_id) {
    return { code: -1, msg: '缺少报工记录ID' }
  }

  try {
    const logRes = await db.collection('WorkLogs').doc(log_id).get()
    const log = logRes.data
    if (!log) return { code: -1, msg: '报工记录不存在' }
    if (!ensureSameOrg(log, caller)) return { code: -1, msg: '无权删除其他工厂报工记录' }

    await db.collection('WorkLogs').doc(log_id).remove()

    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        action: 'worklog_delete',
        worklog_id: log_id,
        target_user_id: log.user_id,
        target_user_name: log.user_name,
        operator_id: caller._id,
        operator_name: caller.name,
        operator_role: caller.role,
        details: `${log.user_name || '未知员工'} ${log.date || ''} 删除报工 ${log.quantity || 0} 件`,
        reason: reason || '老板在报工管理页面删除',
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '报工记录已删除' }
  } catch (err) {
    return { code: -1, msg: '删除失败: ' + err.message }
  }
}

// QC质检
async function inspect(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
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
    if (!ensureSameOrg(log, caller)) return { code: -1, msg: '无权质检其他工厂报工' }
    if (log.status === 'inspected') {
      return { code: -1, msg: '已质检，请勿重复操作' }
    }

    const passedQty = parseInt(passed_qty)
    if (passedQty < 0 || passedQty > log.quantity) {
      return { code: -1, msg: '合格数量无效' }
    }

    await db.collection('WorkLogs').doc(log_id).update({
      data: {
        passed_qty: passedQty,
        status: 'inspected',
        qc_status: 'inspected',
        inspected_by: caller._id,
        inspected_by_name: caller.name,
        inspected_at: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: '质检完成',
      data: {
        passed_qty: passedQty,
        salary_affected: false
      }
    }
  } catch (err) {
    return { code: -1, msg: '质检失败: ' + err.message }
  }
}

// 修改报工记录（含权限校验 + 发薪锁定 + 审计留痕）
async function updateWorkLog(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) return { code: -1, msg: '未登录或用户不存在' }

  const { log_id, quantity, note, reason, process_id, order_id } = event
  if (!log_id) return { code: -1, msg: '缺少报工记录ID' }
  if (!reason) return { code: -1, msg: '请填写修改原因' }

  try {
    const logRes = await db.collection('WorkLogs').doc(log_id).get()
    if (!logRes.data) return { code: -1, msg: '报工记录不存在' }
    const log = logRes.data
    if (!ensureSameOrg(log, caller)) return { code: -1, msg: '无权修改其他工厂报工记录' }

    // 权限校验
    if (caller.role === 'employee') {
      // 员工只能改自己的
      if (String(log.user_id) !== String(caller._id)) {
        return { code: -1, msg: '无权修改他人报工记录' }
      }
      // 员工只能改当天的（北京时间）
      const todayStr = bjTime.getBeijingToday()
      if (log.date !== todayStr) {
        return { code: -1, msg: '只能修改当日的报工记录' }
      }
    } else if (caller.role !== 'boss') {
      return { code: -1, msg: '无权修改报工记录' }
    }

    // 发薪锁定检查
    const locked = await isPeriodLocked(log.user_id, log.date, getOrgId(caller))
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
      if (!ensureSameOrg(processRes.data, caller)) return { code: -1, msg: '目标工序不存在' }
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
        if (!ensureSameOrg(orderRes.data, caller)) return { code: -1, msg: '目标订单不存在' }
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

    const targetOrderId = updateData.order_id || log.order_id
    const targetProcessId = updateData.process_id || log.process_id
    const targetQty = updateData.quantity || log.quantity

    const shouldCheckQuota = (
      updateData.quantity !== undefined ||
      updateData.order_id !== undefined ||
      updateData.process_id !== undefined
    )

    if (shouldCheckQuota) {
      const quotaSnapshot = await getProcessQuotaSnapshot(targetOrderId, targetProcessId, log._id, getOrgId(caller))
      if (!quotaSnapshot.ok) {
        return { code: -1, msg: quotaSnapshot.msg }
      }

      const afterUpdateTotal = quotaSnapshot.data.current_total + toInt(targetQty)
      if (afterUpdateTotal > quotaSnapshot.data.order_total_quantity) {
        return { code: -1, msg: '报工失败：该工序累计报工数量不能超过订单总数量' }
      }
    }

    if (auditChanges.length === 0) {
      return { code: 0, msg: '未检测到修改' }
    }

    if (shouldCheckQuota) {
      let retry = 0
      let txSuccess = false
      while (retry < MAX_TX_RETRIES && !txSuccess) {
        const transaction = await db.startTransaction()
        try {
          const orderRes = await transaction.collection('Orders').doc(targetOrderId).get()
          if (!orderRes.data || orderRes.data.org_id !== getOrgId(caller)) {
            await transaction.rollback()
            return { code: -1, msg: '订单不存在' }
          }

          const orderTotal = getOrderTotalQuantity(orderRes.data)
          if (orderTotal <= 0) {
            await transaction.rollback()
            return { code: -1, msg: '订单总量配置无效' }
          }

          const currentTotal = await sumProcessReportedQuantity(targetOrderId, targetProcessId, log._id, transaction, getOrgId(caller))
          const newTotal = currentTotal + toInt(targetQty)
          if (newTotal > orderTotal) {
            await transaction.rollback()
            return { code: -1, msg: '报工失败：该工序累计报工数量不能超过订单总数量' }
          }

          await transaction.collection('Orders').doc(targetOrderId).update({
            data: {
              report_lock_version: _.inc(1),
              updated_at: db.serverDate()
            }
          })
          await transaction.collection('WorkLogs').doc(log_id).update({ data: updateData })
          await transaction.commit()
          txSuccess = true
        } catch (err) {
          try { await transaction.rollback() } catch (e) {}
          if (String(err.message || '').indexOf('conflict') >= 0 || String(err.errMsg || '').indexOf('conflict') >= 0) {
            retry += 1
            continue
          }
          return { code: -1, msg: '修改失败: ' + err.message }
        }
      }

      if (!txSuccess) {
        return { code: -1, msg: '修改失败：并发冲突，请重试' }
      }
    } else {
      await db.collection('WorkLogs').doc(log_id).update({ data: updateData })
    }

    // 写入审计日志 WorkLogAudit
    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
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
