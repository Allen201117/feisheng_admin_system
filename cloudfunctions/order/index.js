// 云函数 - order (订单和工序管理)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const { buildPaidMonthSet, selectRepriceableWorklogs } = require('./reprice-worklogs')
const {
  collectAssignedUserIds,
  buildUserNameMap,
  attachAssignedNamesToProcesses,
  findInvalidAssignedUserIdProcesses
} = require('./detail.logic')
const { copyProcessDocsInChunks } = require('./copy-order.logic')
const {
  normalizeOrderQuantity,
  shouldCheckProcessQuantityLimit,
  buildExceededProcessQuantities
} = require('./update-order.logic')
const {
  collectClearableWorklogIds,
  findPaidWorklogConflicts,
  buildClearOrderWorklogsDetails
} = require('./clear-worklogs.logic')

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
    } catch (err) {}
  }

  return await getCallerUser(wxContext)
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
      return { ok: false, msg: '工厂服务已到期，请联系平台管理员开通' }
    }

    const now = Date.now()
    const endTs = toTimestamp(org.current_period_end || org.trial_end)
    const graceTs = toTimestamp(org.grace_until)
    if (endTs && now > endTs && (!graceTs || now > graceTs)) {
      return { ok: false, msg: '工厂服务已到期，请联系平台管理员开通' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: '服务状态校验失败，请稍后重试' }
  }
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
    return Number(input.seconds) * 1000 + Math.floor((Number(input.nanoseconds) || 0) / 1000000)
  }
  return 0
}

function getSortableTime(doc) {
  return toTimestamp(doc.created_at || doc.updated_at || doc.start_date || doc.date || doc.clock_in_time)
}

function sortDocsByTime(list, direction) {
  const multiplier = direction === 'asc' ? 1 : -1
  return (list || []).slice().sort((a, b) => {
    const diff = getSortableTime(a) - getSortableTime(b)
    if (diff !== 0) return diff * multiplier
    return String(a._id || '').localeCompare(String(b._id || '')) * multiplier
  })
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) {
    return { code: -1, msg: '登录已失效，请重新登录' }
  }

  // 写操作需要boss权限
  if (['list', 'getDetail', 'getPriceChangeLogs', 'create', 'updateOrder', 'copyOrder', 'updateStatus', 'deleteOrder', 'addProcess', 'updateProcessPrice', 'updateProcess', 'deleteProcess', 'assignProcess', 'batchAssignProcesses', 'togglePriceHidden', 'clearOrderPrices', 'clearOrderWorklogs'].includes(action)) {
    if (!caller || caller.role !== 'boss') {
      return { code: -1, msg: '权限不足，仅管理员可操作' }
    }
  }

  if (['create', 'copyOrder', 'addProcess'].includes(action)) {
    const entitlement = await ensureWritableEntitlement(caller)
    if (!entitlement.ok) return { code: -1, msg: entitlement.msg }
  }

  switch (action) {
    case 'list': return await listOrders(caller)
    case 'getDetail': return await getOrderDetail(event, caller)
    case 'create': return await createOrder(event, caller)
    case 'updateOrder': return await updateOrder(event, caller)
    case 'copyOrder': return await copyOrder(event, caller)
    case 'updateStatus': return await updateOrderStatus(event, caller)
    case 'deleteOrder': return await deleteOrder(event, caller)
    case 'addProcess': return await addProcess(event, caller)
    case 'updateProcessPrice': return await updateProcessPrice(event, caller)
    case 'updateProcess': return await updateProcess(event, caller)
    case 'deleteProcess': return await deleteProcess(event, caller)
    case 'assignProcess': return await assignProcess(event, caller)
    case 'batchAssignProcesses': return await batchAssignProcesses(event, caller)
    case 'getAssignedProcesses': return await getAssignedProcesses(event, caller)
    case 'togglePriceHidden': return await togglePriceHidden(event, caller)
    case 'clearOrderPrices': return await clearOrderPrices(event, caller)
    case 'clearOrderWorklogs': return await clearOrderWorklogs(event, caller)
    case 'getPriceChangeLogs': return await getPriceChangeLogs(event, caller)
    default: return { code: -1, msg: '未知操作' }
  }
}

async function listOrders(caller) {
  try {
    const allOrderData = sortDocsByTime(
      await fetchAllDocs('Orders', { org_id: getOrgId(caller) }),
      'desc'
    )

    // 获取每个订单的工序数量
    const orders = []
    for (const order of allOrderData) {
      const processCount = await db.collection('Processes')
        .where({ org_id: getOrgId(caller), order_id: order._id })
        .count()
      orders.push({
        ...order,
        process_count: processCount.total
      })
    }

    return { code: 0, data: orders }
  } catch (err) {
    return { code: -1, msg: '获取订单列表失败' }
  }
}

async function getOrderDetail(event, caller) {
  const { order_id } = event
  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    if (!ensureSameOrg(orderRes.data, caller)) {
      return { code: -1, msg: '无权访问该订单' }
    }
    const allProcessData = sortDocsByTime(
      await fetchAllDocs('Processes', { org_id: getOrgId(caller), order_id }),
      'asc'
    )

    const invalidAssigned = findInvalidAssignedUserIdProcesses(allProcessData)
    if (invalidAssigned.length > 0) {
      console.warn('[order.getDetail] invalid assigned_user_ids ignored:', invalidAssigned)
    }

    const assignedUserIds = collectAssignedUserIds(allProcessData)
    const users = []
    for (const chunk of chunkArray(assignedUserIds, 50)) {
      const userRes = await db.collection('Users')
        .where({ org_id: getOrgId(caller), _id: _.in(chunk) })
        .field({ _id: true, name: true })
        .get()
      users.push(...(userRes.data || []))
    }

    const userNameMap = buildUserNameMap(users)
    const processes = attachAssignedNamesToProcesses(allProcessData, userNameMap)

    return {
      code: 0,
      data: {
        order: orderRes.data,
        processes
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取订单详情失败' }
  }
}

async function createOrder(event, caller) {
  const { order_name, start_date, end_date, total_quantity } = event
  if (!order_name || !start_date || !total_quantity) {
    return { code: -1, msg: '请填写完整的订单信息' }
  }

  try {
    await db.collection('Orders').add({
      data: {
        org_id: getOrgId(caller),
        order_name,
        start_date,
        end_date: end_date || '',
        total_quantity: parseInt(total_quantity),
        status: 'active',
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
    return { code: 0, msg: '订单创建成功' }
  } catch (err) {
    return { code: -1, msg: '创建失败' }
  }
}

async function updateOrder(event, caller) {
  const { order_id, order_name, start_date, end_date, total_quantity } = event
  if (!order_id) return { code: -1, msg: '参数不完整' }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    const order = orderRes.data
    if (!order) return { code: -1, msg: '订单不存在' }
    if (!ensureSameOrg(order, caller)) return { code: -1, msg: '无权修改该订单' }
    if (order.status !== 'active') return { code: -1, msg: '仅进行中的订单可编辑' }

    const oldQty = normalizeOrderQuantity(order)
    const newQty = parseInt(total_quantity, 10)
    if (!newQty || newQty <= 0) return { code: -1, msg: '总数量必须大于0' }

    // 检查各工序已报工数量是否超出新总量
    if (shouldCheckProcessQuantityLimit(oldQty, newQty)) {
      const [processes, worklogs] = await Promise.all([
        fetchAllDocs('Processes', { org_id: getOrgId(caller), order_id }, { field: { _id: true, process_name: true } }),
        fetchAllDocs('WorkLogs', { org_id: getOrgId(caller), order_id }, { field: { process_id: true, quantity: true } })
      ])
      const exceeded = buildExceededProcessQuantities({
        processes,
        worklogs,
        nextTotalQuantity: newQty
      })
      if (exceeded.length > 0) {
        const detail = exceeded.map(e => `"${e.process_name}"已报工${e.current_sum}件`).join('；')
        return { code: -1, msg: `修改失败：${detail}，超出新总数量${newQty}件` }
      }
    }

    const updateData = { updated_at: db.serverDate() }
    if (order_name) updateData.order_name = order_name
    if (start_date !== undefined) updateData.start_date = start_date
    if (end_date !== undefined) updateData.end_date = end_date
    updateData.total_quantity = newQty

    await db.collection('Orders').doc(order_id).update({ data: updateData })

    // 审计日志
    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        operator_id: caller ? caller._id : '',
        operator_name: caller ? caller.name : '',
        action: 'update_order',
        target_id: order_id,
        details: `修改订单"${order.order_name}"：总数量 ${oldQty} → ${newQty}` +
          (order_name && order_name !== order.order_name ? `，名称 → ${order_name}` : ''),
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '订单已更新' }
  } catch (err) {
    return { code: -1, msg: '更新失败：' + (err.message || JSON.stringify(err)) }
  }
}

async function copyOrder(event, caller) {
  const { source_order_id, new_total_quantity } = event
  if (!source_order_id) return { code: -1, msg: '参数不完整' }

  try {
    const orderRes = await db.collection('Orders').doc(source_order_id).get()
    const source = orderRes.data
    if (!source) return { code: -1, msg: '源订单不存在' }
    if (!ensureSameOrg(source, caller)) return { code: -1, msg: '无权复制该订单' }

    const qty = parseInt(new_total_quantity) || source.total_quantity

    // 创建新订单
    const newOrderRes = await db.collection('Orders').add({
      data: {
        org_id: getOrgId(caller),
        order_name: source.order_name + ' (副本)',
        start_date: source.start_date,
        end_date: source.end_date || '',
        total_quantity: qty,
        status: 'active',
        price_hidden: source.price_hidden || false,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
    const newOrderId = newOrderRes._id

    // 复制所有工序及分配
    const processes = await fetchAllDocs('Processes', { org_id: getOrgId(caller), order_id: source_order_id })
    const copyResult = await copyProcessDocsInChunks(processes, {
      orgId: getOrgId(caller),
      newOrderId,
      serverDate: () => db.serverDate(),
      chunkSize: 10,
      addProcess: (data) => db.collection('Processes').add({ data })
    })

    // 审计日志
    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        operator_id: caller ? caller._id : '',
        operator_name: caller ? caller.name : '',
        action: 'copy_order',
        target_id: newOrderId,
        details: `复制订单"${source.order_name}"，共${copyResult.copiedCount}道工序，新总数量${qty}件`,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '订单复制成功', data: { new_order_id: newOrderId } }
  } catch (err) {
    return { code: -1, msg: '复制失败：' + (err.message || JSON.stringify(err)) }
  }
}

async function updateOrderStatus(event, caller) {
  const { order_id, status } = event
  if (!['active', 'completed', 'cancelled'].includes(status)) {
    return { code: -1, msg: '无效的状态' }
  }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    if (!ensureSameOrg(orderRes.data, caller)) return { code: -1, msg: '无权修改该订单' }
    await db.collection('Orders').doc(order_id).update({
      data: { status, updated_at: db.serverDate() }
    })
    return { code: 0, msg: '状态更新成功' }
  } catch (err) {
    return { code: -1, msg: '更新失败' }
  }
}

async function fetchAllDocs(collectionName, where, options = {}) {
  const field = options.field || null
  const pageSize = options.pageSize || 100

  let all = []
  let batchLen = 0

  do {
    let query = db.collection(collectionName).where(where)
    if (field) query = query.field(field)
    const res = await query.skip(all.length).limit(pageSize).get()
    batchLen = (res.data || []).length
    all = all.concat(res.data || [])
  } while (batchLen === pageSize)

  return all
}

function chunkArray(list, size = 50) {
  const chunks = []
  for (let i = 0; i < list.length; i += size) {
    chunks.push(list.slice(i, i + size))
  }
  return chunks
}

async function removeDocsByIds(collectionName, ids) {
  if (!ids || ids.length === 0) return 0

  let removed = 0
  for (const chunk of chunkArray(ids, 50)) {
    const res = await db.collection(collectionName).where({
      _id: _.in(chunk)
    }).remove()
    removed += res.stats ? (res.stats.removed || 0) : 0
  }

  return removed
}

async function fetchDocsByIds(collectionName, fieldName, ids) {
  if (!ids || ids.length === 0) return []

  let all = []
  for (const chunk of chunkArray(ids, 50)) {
    const res = await fetchAllDocs(collectionName, {
      [fieldName]: _.in(chunk)
    }, {
      field: { _id: true }
    })
    all = all.concat(res)
  }

  return all
}

async function syncZeroPriceWorklogsForProcess(processId, newPrice, orgId) {
  const normalizedPrice = Number(newPrice)
  if (!processId || !Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
    return { updatedCount: 0 }
  }

  const worklogs = await fetchAllDocs('WorkLogs', {
    org_id: orgId,
    process_id: processId
  }, {
    field: { _id: true, user_id: true, date: true, quantity: true, snapshot_price: true }
  })

  if (worklogs.length === 0) {
    return { updatedCount: 0 }
  }

  const userIds = Array.from(new Set(worklogs.map(log => log.user_id).filter(Boolean)))
  const payments = userIds.length > 0
    ? await fetchAllDocs('SalaryPayments', {
      org_id: orgId,
      user_id: _.in(userIds),
      paid: true
    }, {
      field: { user_id: true, month: true, paid: true }
    })
    : []

  const paidMonthSet = buildPaidMonthSet(payments)
  const targetLogs = selectRepriceableWorklogs(worklogs, paidMonthSet)

  let updatedCount = 0
  for (const log of targetLogs) {
    const quantity = parseInt(log.quantity || 0, 10) || 0
    await db.collection('WorkLogs').doc(log._id).update({
      data: {
        snapshot_price: normalizedPrice,
        amount: Math.round(quantity * normalizedPrice * 100) / 100,
        updated_at: db.serverDate()
      }
    })
    updatedCount += 1
  }

  return { updatedCount }
}

async function deleteOrder(event, caller) {
  const { order_id } = event
  if (!order_id) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    const order = orderRes.data
    if (!order) {
      return { code: -1, msg: '订单不存在' }
    }
    if (!ensureSameOrg(order, caller)) return { code: -1, msg: '无权删除该订单' }

    const [processes, worklogs, adjustments] = await Promise.all([
      fetchAllDocs('Processes', { org_id: getOrgId(caller), order_id }, { field: { _id: true, process_name: true } }),
      fetchAllDocs('WorkLogs', { org_id: getOrgId(caller), order_id }, { field: { _id: true } }),
      fetchAllDocs('SalaryAdjustments', { org_id: getOrgId(caller), order_id }, { field: { _id: true } })
    ])

    const processIds = processes.map(item => item._id)
    const worklogIds = worklogs.map(item => item._id)
    const adjustmentIds = adjustments.map(item => item._id)

    const removedProcessCount = await removeDocsByIds('Processes', processIds)
    const removedWorklogCount = await removeDocsByIds('WorkLogs', worklogIds)
    const removedAdjustmentCount = await removeDocsByIds('SalaryAdjustments', adjustmentIds)

    await db.collection('Orders').doc(order_id).remove()

    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        operator_id: caller ? caller._id : '',
        operator_name: caller ? caller.name : '',
        action: 'delete_order',
        target_id: order_id,
        details: `删除订单 ${order.order_name || order_id}，同步删除工序 ${removedProcessCount} 条、报工 ${removedWorklogCount} 条、奖惩 ${removedAdjustmentCount} 条（审计日志已保留）`,
        created_at: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: '订单及相关数据已删除',
      data: {
        processCount: removedProcessCount,
        worklogCount: removedWorklogCount,
        adjustmentCount: removedAdjustmentCount
      }
    }
  } catch (err) {
    return { code: -1, msg: '删除订单失败: ' + err.message }
  }
}

async function addProcess(event, caller) {
  const { order_id, process_name, current_price, note } = event
  if (!order_id || !process_name || (current_price === undefined || current_price === null || current_price === '')) {
    return { code: -1, msg: '请填写完整的工序信息' }
  }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    if (!ensureSameOrg(orderRes.data, caller)) return { code: -1, msg: '无权向该订单添加工序' }
    await db.collection('Processes').add({
      data: {
        org_id: getOrgId(caller),
        order_id,
        process_name,
        current_price: parseFloat(current_price),
        note: note || '',
        assigned_user_ids: [],
        status: 'active',
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
    return { code: 0, msg: '工序添加成功' }
  } catch (err) {
    return { code: -1, msg: '添加失败' }
  }
}

async function updateProcessPrice(event, caller) {
  const { process_id, new_price, old_price } = event
  if (!process_id || new_price === undefined) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    // 获取工序信息以记录 order_id 和 process_name
    const processRes = await db.collection('Processes').doc(process_id).get()
    const processData = processRes.data || {}
    if (!ensureSameOrg(processData, caller)) return { code: -1, msg: '无权修改该工序' }

    const parsedPrice = parseFloat(new_price)

    await db.collection('Processes').doc(process_id).update({
      data: {
        current_price: parsedPrice,
        updated_at: db.serverDate()
      }
    })

    const syncResult = await syncZeroPriceWorklogsForProcess(process_id, parsedPrice, getOrgId(caller))

    // 记录改价日志
    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        operator_id: caller._id,
        operator_name: caller.name,
        action: 'update_process_price',
        target_id: process_id,
        order_id: processData.order_id || '',
        process_name: processData.process_name || '',
        old_price: old_price !== undefined ? old_price : null,
        new_price: parsedPrice,
        details: `单价从 ¥${old_price} 修改为 ¥${new_price}`,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '单价更新成功（不影响历史报工）' }
  } catch (err) {
    return { code: -1, msg: '更新失败' }
  }
}

async function updateProcess(event, caller) {
  const { process_id, process_name, note, current_price } = event
  if (!process_id) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    const oldRes = await db.collection('Processes').doc(process_id).get()
    const oldProcess = oldRes.data
    if (!ensureSameOrg(oldProcess, caller)) return { code: -1, msg: '无权修改该工序' }

    const updateData = { updated_at: db.serverDate() }
    const changes = []

    if (process_name !== undefined && process_name !== oldProcess.process_name) {
      updateData.process_name = process_name
      changes.push(`名称: "${oldProcess.process_name}" → "${process_name}"`)
    }
    if (note !== undefined && note !== (oldProcess.note || '')) {
      updateData.note = note
      changes.push(`备注: "${oldProcess.note || ''}" → "${note}"`)
    }
    if (current_price !== undefined && parseFloat(current_price) !== oldProcess.current_price) {
      updateData.current_price = parseFloat(current_price)
      changes.push(`单价: ¥${oldProcess.current_price} → ¥${current_price}`)
    }

    if (changes.length === 0) {
      return { code: 0, msg: '没有变更' }
    }

    await db.collection('Processes').doc(process_id).update({ data: updateData })

    let syncResult = { updatedCount: 0 }
    if (current_price !== undefined && parseFloat(current_price) !== oldProcess.current_price) {
      syncResult = await syncZeroPriceWorklogsForProcess(process_id, parseFloat(current_price), getOrgId(caller))
    }

    const hasPrice = changes.some(c => c.startsWith('单价'))
    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        operator_id: caller._id,
        operator_name: caller.name,
        action: 'process_update',
        target_id: process_id,
        order_id: oldProcess.order_id || '',
        process_name: process_name !== undefined ? process_name : oldProcess.process_name,
        old_price: hasPrice ? oldProcess.current_price : undefined,
        new_price: hasPrice ? parseFloat(current_price) : undefined,
        old_values: {
          process_name: oldProcess.process_name,
          note: oldProcess.note || '',
          current_price: oldProcess.current_price
        },
        new_values: {
          process_name: process_name !== undefined ? process_name : oldProcess.process_name,
          note: note !== undefined ? note : (oldProcess.note || ''),
          current_price: current_price !== undefined ? parseFloat(current_price) : oldProcess.current_price
        },
        details: changes.join('；'),
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: hasPrice ? '工序已更新（单价变更不影响历史报工）' : '工序已更新' }
  } catch (err) {
    return { code: -1, msg: '更新失败' }
  }
}

async function deleteProcess(event, caller) {
  const { process_id } = event
  try {
    const processRes = await db.collection('Processes').doc(process_id).get()
    if (!ensureSameOrg(processRes.data, caller)) return { code: -1, msg: '无权删除该工序' }
    // 检查是否有关联的报工记录
    const logCount = await db.collection('WorkLogs')
      .where({ org_id: getOrgId(caller), process_id })
      .count()
    if (logCount.total > 0) {
      return { code: -1, msg: '该工序已有报工记录，无法删除' }
    }

    await db.collection('Processes').doc(process_id).remove()
    return { code: 0, msg: '删除成功' }
  } catch (err) {
    return { code: -1, msg: '删除失败' }
  }
}

async function assignProcess(event, caller) {
  const { process_id, user_ids } = event
  try {
    // 获取旧分配
    const oldProcess = await db.collection('Processes').doc(process_id).get()
    if (!ensureSameOrg(oldProcess.data, caller)) return { code: -1, msg: '无权分配该工序' }
    const oldIds = oldProcess.data ? (oldProcess.data.assigned_user_ids || []) : []
    const nextUserIds = Array.isArray(user_ids) ? user_ids : []
    if (nextUserIds.length > 0) {
      const users = await fetchAllDocs('Users', { org_id: getOrgId(caller), _id: _.in(nextUserIds) }, { field: { _id: true } })
      if (users.length !== nextUserIds.length) {
        return { code: -1, msg: '不能分配其他工厂员工' }
      }
    }

    await db.collection('Processes').doc(process_id).update({
      data: {
        assigned_user_ids: nextUserIds,
        updated_at: db.serverDate()
      }
    })

    // 审计日志
    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        action: 'process_assign',
        target_id: process_id,
        details: `员工分配变更: [${oldIds.join(',')}] → [${nextUserIds.join(',')}]`,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '分配成功' }
  } catch (err) {
    return { code: -1, msg: '分配失败' }
  }
}

async function batchAssignProcesses(event, caller) {
  const rawChanges = Array.isArray(event.changes) ? event.changes : []
  if (rawChanges.length === 0) return { code: -1, msg: '没有需要保存的分配变更' }
  if (rawChanges.length > 250) return { code: -1, msg: '单次最多保存250道工序分配，请分批操作' }

  try {
    const changeMap = new Map()
    rawChanges.forEach(change => {
      if (!change || !change.process_id) return
      const nextUserIds = Array.isArray(change.user_ids)
        ? Array.from(new Set(change.user_ids.filter(Boolean).map(id => String(id))))
        : []
      changeMap.set(String(change.process_id), {
        process_id: String(change.process_id),
        user_ids: nextUserIds
      })
    })

    const changes = Array.from(changeMap.values())
    if (changes.length === 0) return { code: -1, msg: '没有有效的工序分配变更' }

    const orgId = getOrgId(caller)
    const processIds = changes.map(change => change.process_id)
    let processes = []
    for (const chunk of chunkArray(processIds, 50)) {
      const part = await fetchAllDocs('Processes', {
        org_id: orgId,
        _id: _.in(chunk)
      }, { field: { _id: true, org_id: true } })
      processes = processes.concat(part)
    }
    const foundProcessIds = new Set(processes.map(proc => String(proc._id)))
    if (processIds.some(id => !foundProcessIds.has(id))) {
      return { code: -1, msg: '存在不存在或不属于当前工厂的工序' }
    }

    const userIdSet = new Set()
    changes.forEach(change => change.user_ids.forEach(id => userIdSet.add(id)))
    const userIds = Array.from(userIdSet)
    if (userIds.length > 0) {
      let users = []
      for (const chunk of chunkArray(userIds, 50)) {
        const part = await fetchAllDocs('Users', {
          org_id: orgId,
          status: 'active',
          _id: _.in(chunk)
        }, { field: { _id: true } })
        users = users.concat(part)
      }
      const validUserIds = new Set(users.map(user => String(user._id)))
      if (userIds.some(id => !validUserIds.has(id))) {
        return { code: -1, msg: '不能分配其他工厂员工或停用员工' }
      }
    }

    let updated = 0
    for (const chunk of chunkArray(changes, 10)) {
      await Promise.all(chunk.map(async change => {
        await db.collection('Processes').doc(change.process_id).update({
          data: {
            assigned_user_ids: change.user_ids,
            updated_at: db.serverDate()
          }
        })
        updated += 1
      }))
    }

    await db.collection('audit_logs').add({
      data: {
        org_id: orgId,
        action: 'process_assign_batch',
        target_id: processIds[0],
        details: `批量保存 ${updated} 道工序分配`,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '批量分配成功', data: { updated } }
  } catch (err) {
    return { code: -1, msg: '批量分配失败' }
  }
}

async function getAssignedProcesses(event, caller) {
  const { user_id } = event
  if (String(caller._id) !== String(user_id) && caller.role !== 'boss') {
    return { code: -1, msg: '无权查看其他员工工序' }
  }
  try {
    // 查找分配给该员工的工序
    let allAssignedProcesses = []
    let assignBatchLen = 0
    do {
      const res = await db.collection('Processes').where({
        org_id: getOrgId(caller),
        assigned_user_ids: user_id,
        status: 'active'
      }).skip(allAssignedProcesses.length).limit(100).get()
      assignBatchLen = (res.data || []).length
      allAssignedProcesses = allAssignedProcesses.concat(res.data || [])
    } while (assignBatchLen === 100)

    // 关联订单名
    const processes = []
    for (const p of allAssignedProcesses) {
      let orderName = ''
      try {
        const orderRes = await db.collection('Orders').doc(p.order_id).get()
        if (ensureSameOrg(orderRes.data, caller) && orderRes.data.status === 'active') {
          orderName = orderRes.data.order_name

          // 统计该订单该工序累计报工数量（所有员工）
          let allLogs = []
          let batchLen = 0
          do {
            const logRes = await db.collection('WorkLogs').where({
              org_id: getOrgId(caller),
              order_id: p.order_id,
              process_id: p._id
            }).skip(allLogs.length).limit(100).get()
            batchLen = logRes.data.length
            allLogs = allLogs.concat(logRes.data)
          } while (batchLen === 100)

          let currentTotal = 0
          allLogs.forEach((log) => {
            currentTotal += parseInt(log.quantity || 0, 10) || 0
          })

          const orderTotal = parseInt(orderRes.data.total_quantity || orderRes.data.order_total_quantity || 0, 10) || 0

          const isPriceHidden = orderRes.data.price_hidden === true

          processes.push({
            _id: p._id,
            order_id: p.order_id,
            order_name: orderName,
            process_name: p.process_name,
            current_price: isPriceHidden ? 0 : (p.current_price == null ? 0 : p.current_price),
            price_hidden: isPriceHidden,
            order_total_quantity: orderTotal,
            current_total: currentTotal,
            remaining_quantity: Math.max(orderTotal - currentTotal, 0)
          })
        }
      } catch (e) {
        // 订单不存在则跳过
      }
    }

    return { code: 0, data: processes }
  } catch (err) {
    return { code: -1, msg: '获取工序失败' }
  }
}

async function togglePriceHidden(event, caller) {
  const { order_id, price_hidden } = event
  if (!order_id || typeof price_hidden !== 'boolean') {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    if (!ensureSameOrg(orderRes.data, caller)) return { code: -1, msg: '无权操作该订单' }
    await db.collection('Orders').doc(order_id).update({
      data: {
        price_hidden: price_hidden,
        updated_at: db.serverDate()
      }
    })

    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        operator_id: caller ? caller._id : '',
        operator_name: caller ? caller.name : '',
        action: 'toggle_price_hidden',
        target_id: order_id,
        details: price_hidden ? '开启工价隐藏' : '关闭工价隐藏',
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: price_hidden ? '已开启工价隐藏' : '已关闭工价隐藏' }
  } catch (err) {
    return { code: -1, msg: '操作失败' }
  }
}

// 一键清空订单所有工序工价
async function clearOrderPrices(event, caller) {
  const { order_id } = event
  if (!order_id) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    if (!ensureSameOrg(orderRes.data, caller)) return { code: -1, msg: '无权操作该订单' }
    let allProcesses = []
    let clearBatchLen = 0
    do {
      const res = await db.collection('Processes')
        .where({ org_id: getOrgId(caller), order_id })
        .skip(allProcesses.length)
        .limit(100)
        .get()
      clearBatchLen = (res.data || []).length
      allProcesses = allProcesses.concat(res.data || [])
    } while (clearBatchLen === 100)

    if (allProcesses.length === 0) {
      return { code: -1, msg: '该订单没有工序' }
    }

    const processesToClear = allProcesses.filter((p) => p.current_price !== null && p.current_price !== undefined)

    if (processesToClear.length === 0) {
      return { code: 0, msg: '所有工序工价已经是空的' }
    }

    const chunkSize = 10
    for (let i = 0; i < processesToClear.length; i += chunkSize) {
      const chunk = processesToClear.slice(i, i + chunkSize)
      await Promise.all(chunk.map(async (p) => {
        const oldPrice = p.current_price
        await db.collection('Processes').doc(p._id).update({
          data: {
            current_price: null,
            updated_at: db.serverDate()
          }
        })

        await db.collection('audit_logs').add({
          data: {
            org_id: getOrgId(caller),
            operator_id: caller ? caller._id : '',
            operator_name: caller ? caller.name : '',
            action: 'clear_price',
            target_id: p._id,
            order_id: order_id,
            process_name: p.process_name,
            old_price: oldPrice,
            new_price: null,
            details: `一键清空工价: ${p.process_name} ¥${oldPrice} → 未设置`,
            created_at: db.serverDate()
          }
        })
      }))
    }

    return { code: 0, msg: `已清空 ${processesToClear.length} 个工序的工价` }
  } catch (err) {
    return { code: -1, msg: '清空工价失败: ' + err.message }
  }
}

// 一键清空订单关联报工
async function clearOrderWorklogs(event, caller) {
  const { order_id } = event
  if (!order_id) return { code: -1, msg: '参数不完整' }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    const order = orderRes.data
    if (!ensureSameOrg(order, caller)) return { code: -1, msg: '无权操作该订单' }

    const worklogs = await fetchAllDocs('WorkLogs', {
      org_id: getOrgId(caller),
      order_id
    }, {
      field: { _id: true, user_id: true, user_name: true, date: true }
    })

    const worklogIds = collectClearableWorklogIds(worklogs)
    if (worklogIds.length === 0) {
      return { code: 0, msg: '该订单暂无报工记录', data: { removedCount: 0 } }
    }

    const userIds = Array.from(new Set(worklogs.map(log => log.user_id).filter(Boolean)))
    const payments = userIds.length > 0
      ? await fetchAllDocs('SalaryPayments', {
        org_id: getOrgId(caller),
        user_id: _.in(userIds),
        paid: true
      }, {
        field: { user_id: true, month: true, paid: true }
      })
      : []

    const paidMonthSet = buildPaidMonthSet(payments)
    const conflicts = findPaidWorklogConflicts({ worklogs, paidMonthSet })
    if (conflicts.length > 0) {
      const preview = conflicts.slice(0, 3)
        .map(item => `${item.user_name || item.user_id} ${item.month}`)
        .join('、')
      const suffix = conflicts.length > 3 ? `等 ${conflicts.length} 个已发薪员工月份` : ''
      return {
        code: -1,
        msg: `存在已发薪月份报工，不能清空：${preview}${suffix}。请先取消对应月份发薪标记。`,
        data: { lockedCount: conflicts.length }
      }
    }

    const removedCount = await removeDocsByIds('WorkLogs', worklogIds)
    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        operator_id: caller ? caller._id : '',
        operator_name: caller ? caller.name : '',
        action: 'clear_order_worklogs',
        target_id: order_id,
        details: buildClearOrderWorklogsDetails({
          orderName: order.order_name,
          removedCount
        }),
        created_at: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: `已删除 ${removedCount} 条报工记录`,
      data: { removedCount }
    }
  } catch (err) {
    return { code: -1, msg: '清空报工失败: ' + err.message }
  }
}

// 获取订单工价变更日志
async function getPriceChangeLogs(event, caller) {
  const { order_id } = event
  if (!order_id) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    if (!ensureSameOrg(orderRes.data, caller)) return { code: -1, msg: '无权访问该订单' }
    // 先获取该订单的所有工序 ID
    let allProcData = []
    let procIdBatchLen = 0
    do {
      const res = await db.collection('Processes')
        .where({ org_id: getOrgId(caller), order_id })
        .field({ _id: true })
        .skip(allProcData.length)
        .limit(100)
        .get()
      procIdBatchLen = (res.data || []).length
      allProcData = allProcData.concat(res.data || [])
    } while (procIdBatchLen === 100)
    const processIds = allProcData.map(p => p._id)

    // 查询该订单相关的工价变更日志
    const priceActions = ['update_process_price', 'process_update', 'clear_price']
    let allLogs = []

    // 按 target_id (process_id) 查询
    if (processIds.length > 0) {
      let batchLen = 0
      do {
        const res = await db.collection('audit_logs')
          .where({
            org_id: getOrgId(caller),
            target_id: _.in(processIds),
            action: _.in(priceActions)
          })
          .orderBy('created_at', 'desc')
          .skip(allLogs.length)
          .limit(100)
          .get()
        batchLen = res.data.length
        allLogs = allLogs.concat(res.data)
      } while (batchLen === 100)
    }

    // 也查询 order_id 字段直接关联的（如 clear_price）
    let orderLogs = []
    let batchLen2 = 0
    do {
      const res = await db.collection('audit_logs')
        .where({
          org_id: getOrgId(caller),
          order_id: order_id,
          action: _.in(priceActions)
        })
        .orderBy('created_at', 'desc')
        .skip(orderLogs.length)
        .limit(100)
        .get()
      batchLen2 = res.data.length
      orderLogs = orderLogs.concat(res.data)
    } while (batchLen2 === 100)

    // 合并去重
    const logMap = {}
    allLogs.concat(orderLogs).forEach(l => { logMap[l._id] = l })
    const merged = Object.values(logMap)
    merged.sort((a, b) => {
      const ta = a.created_at ? new Date(a.created_at).getTime() : 0
      const tb = b.created_at ? new Date(b.created_at).getTime() : 0
      return tb - ta
    })

    return { code: 0, data: merged }
  } catch (err) {
    return { code: -1, msg: '获取变更日志失败' }
  }
}
