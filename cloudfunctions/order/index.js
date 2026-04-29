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

async function getCallerUser(wxContext) {
  const res = await db.collection('Users').where({
    openid: wxContext.OPENID,
    status: 'active'
  }).get()
  return res.data.length > 0 ? res.data[0] : null
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  // 写操作需要boss权限
  if (['create', 'updateOrder', 'copyOrder', 'updateStatus', 'deleteOrder', 'addProcess', 'updateProcessPrice', 'updateProcess', 'deleteProcess', 'assignProcess', 'togglePriceHidden', 'clearOrderPrices'].includes(action)) {
    const caller = await getCallerUser(wxContext)
    if (!caller || caller.role !== 'boss') {
      return { code: -1, msg: '权限不足，仅管理员可操作' }
    }
  }

  switch (action) {
    case 'list': return await listOrders()
    case 'getDetail': return await getOrderDetail(event)
    case 'create': return await createOrder(event)
    case 'updateOrder': return await updateOrder(event, wxContext)
    case 'copyOrder': return await copyOrder(event, wxContext)
    case 'updateStatus': return await updateOrderStatus(event)
    case 'deleteOrder': return await deleteOrder(event, wxContext)
    case 'addProcess': return await addProcess(event)
    case 'updateProcessPrice': return await updateProcessPrice(event, wxContext)
    case 'updateProcess': return await updateProcess(event, wxContext)
    case 'deleteProcess': return await deleteProcess(event)
    case 'assignProcess': return await assignProcess(event)
    case 'getAssignedProcesses': return await getAssignedProcesses(event)
    case 'togglePriceHidden': return await togglePriceHidden(event, wxContext)
    case 'clearOrderPrices': return await clearOrderPrices(event, wxContext)
    case 'getPriceChangeLogs': return await getPriceChangeLogs(event)
    default: return { code: -1, msg: '未知操作' }
  }
}

async function listOrders() {
  try {
    let allOrderData = []
    let batchLen = 0
    do {
      const res = await db.collection('Orders')
        .orderBy('created_at', 'desc')
        .skip(allOrderData.length)
        .limit(100)
        .get()
      batchLen = (res.data || []).length
      allOrderData = allOrderData.concat(res.data || [])
    } while (batchLen === 100)

    // 获取每个订单的工序数量
    const orders = []
    for (const order of allOrderData) {
      const processCount = await db.collection('Processes')
        .where({ order_id: order._id })
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

async function getOrderDetail(event) {
  const { order_id } = event
  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    let allProcessData = []
    let procBatchLen = 0
    do {
      const res = await db.collection('Processes')
        .where({ order_id })
        .orderBy('created_at', 'asc')
        .skip(allProcessData.length)
        .limit(100)
        .get()
      procBatchLen = (res.data || []).length
      allProcessData = allProcessData.concat(res.data || [])
    } while (procBatchLen === 100)

    const invalidAssigned = findInvalidAssignedUserIdProcesses(allProcessData)
    if (invalidAssigned.length > 0) {
      console.warn('[order.getDetail] invalid assigned_user_ids ignored:', invalidAssigned)
    }

    const assignedUserIds = collectAssignedUserIds(allProcessData)
    const users = []
    for (const chunk of chunkArray(assignedUserIds, 50)) {
      const userRes = await db.collection('Users')
        .where({ _id: _.in(chunk) })
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

async function createOrder(event) {
  const { order_name, start_date, end_date, total_quantity } = event
  if (!order_name || !start_date || !total_quantity) {
    return { code: -1, msg: '请填写完整的订单信息' }
  }

  try {
    await db.collection('Orders').add({
      data: {
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

async function updateOrder(event, wxContext) {
  const { order_id, order_name, start_date, end_date, total_quantity } = event
  if (!order_id) return { code: -1, msg: '参数不完整' }

  try {
    const orderRes = await db.collection('Orders').doc(order_id).get()
    const order = orderRes.data
    if (!order) return { code: -1, msg: '订单不存在' }
    if (order.status !== 'active') return { code: -1, msg: '仅进行中的订单可编辑' }

    const newQty = parseInt(total_quantity)
    if (!newQty || newQty <= 0) return { code: -1, msg: '总数量必须大于0' }

    // 检查各工序已报工数量是否超出新总量
    if (newQty !== order.total_quantity) {
      const processes = await fetchAllDocs('Processes', { order_id })
      const exceeded = []
      for (const proc of processes) {
        const worklogs = await fetchAllDocs('WorkLogs', { order_id, process_id: proc._id }, { field: { quantity: true } })
        const sum = worklogs.reduce((s, w) => s + (Number(w.quantity) || 0), 0)
        if (sum > newQty) {
          exceeded.push({ process_name: proc.process_name, current_sum: sum })
        }
      }
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
    const caller = await getCallerUser(wxContext)
    await db.collection('audit_logs').add({
      data: {
        operator_id: caller ? caller._id : '',
        operator_name: caller ? caller.name : '',
        action: 'update_order',
        target_id: order_id,
        details: `修改订单"${order.order_name}"：总数量 ${order.total_quantity} → ${newQty}` +
          (order_name && order_name !== order.order_name ? `，名称 → ${order_name}` : ''),
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '订单已更新' }
  } catch (err) {
    return { code: -1, msg: '更新失败：' + (err.message || JSON.stringify(err)) }
  }
}

async function copyOrder(event, wxContext) {
  const { source_order_id, new_total_quantity } = event
  if (!source_order_id) return { code: -1, msg: '参数不完整' }

  try {
    const orderRes = await db.collection('Orders').doc(source_order_id).get()
    const source = orderRes.data
    if (!source) return { code: -1, msg: '源订单不存在' }

    const qty = parseInt(new_total_quantity) || source.total_quantity

    // 创建新订单
    const newOrderRes = await db.collection('Orders').add({
      data: {
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
    const processes = await fetchAllDocs('Processes', { order_id: source_order_id })
    for (const proc of processes) {
      await db.collection('Processes').add({
        data: {
          order_id: newOrderId,
          process_name: proc.process_name,
          current_price: proc.current_price,
          note: proc.note || '',
          assigned_user_ids: proc.assigned_user_ids || [],
          is_active: true,
          created_at: db.serverDate(),
          updated_at: db.serverDate()
        }
      })
    }

    // 审计日志
    const caller = await getCallerUser(wxContext)
    await db.collection('audit_logs').add({
      data: {
        operator_id: caller ? caller._id : '',
        operator_name: caller ? caller.name : '',
        action: 'copy_order',
        target_id: newOrderId,
        details: `复制订单"${source.order_name}"，共${processes.length}道工序，新总数量${qty}件`,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '订单复制成功', data: { new_order_id: newOrderId } }
  } catch (err) {
    return { code: -1, msg: '复制失败：' + (err.message || JSON.stringify(err)) }
  }
}

async function updateOrderStatus(event) {
  const { order_id, status } = event
  if (!['active', 'completed', 'cancelled'].includes(status)) {
    return { code: -1, msg: '无效的状态' }
  }

  try {
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

async function syncZeroPriceWorklogsForProcess(processId, newPrice) {
  const normalizedPrice = Number(newPrice)
  if (!processId || !Number.isFinite(normalizedPrice) || normalizedPrice <= 0) {
    return { updatedCount: 0 }
  }

  const worklogs = await fetchAllDocs('WorkLogs', {
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

async function deleteOrder(event, wxContext) {
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

    const [processes, worklogs, adjustments] = await Promise.all([
      fetchAllDocs('Processes', { order_id }, { field: { _id: true, process_name: true } }),
      fetchAllDocs('WorkLogs', { order_id }, { field: { _id: true } }),
      fetchAllDocs('SalaryAdjustments', { order_id }, { field: { _id: true } })
    ])

    const processIds = processes.map(item => item._id)
    const worklogIds = worklogs.map(item => item._id)
    const adjustmentIds = adjustments.map(item => item._id)

    const removedProcessCount = await removeDocsByIds('Processes', processIds)
    const removedWorklogCount = await removeDocsByIds('WorkLogs', worklogIds)
    const removedAdjustmentCount = await removeDocsByIds('SalaryAdjustments', adjustmentIds)

    await db.collection('Orders').doc(order_id).remove()

    const caller = await getCallerUser(wxContext)
    await db.collection('audit_logs').add({
      data: {
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

async function addProcess(event) {
  const { order_id, process_name, current_price, note } = event
  if (!order_id || !process_name || (current_price === undefined || current_price === null || current_price === '')) {
    return { code: -1, msg: '请填写完整的工序信息' }
  }

  try {
    await db.collection('Processes').add({
      data: {
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

async function updateProcessPrice(event, wxContext) {
  const { process_id, new_price, old_price } = event
  if (!process_id || new_price === undefined) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    // 获取工序信息以记录 order_id 和 process_name
    const processRes = await db.collection('Processes').doc(process_id).get()
    const processData = processRes.data || {}

    const parsedPrice = parseFloat(new_price)

    await db.collection('Processes').doc(process_id).update({
      data: {
        current_price: parsedPrice,
        updated_at: db.serverDate()
      }
    })

    const syncResult = await syncZeroPriceWorklogsForProcess(process_id, parsedPrice)

    // 记录改价日志
    const caller = await getCallerUser(wxContext)
    await db.collection('audit_logs').add({
      data: {
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

async function updateProcess(event, wxContext) {
  const { process_id, process_name, note, current_price } = event
  if (!process_id) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    const oldRes = await db.collection('Processes').doc(process_id).get()
    const oldProcess = oldRes.data

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
      syncResult = await syncZeroPriceWorklogsForProcess(process_id, parseFloat(current_price))
    }

    const caller = await getCallerUser(wxContext)
    const hasPrice = changes.some(c => c.startsWith('单价'))
    await db.collection('audit_logs').add({
      data: {
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

async function deleteProcess(event) {
  const { process_id } = event
  try {
    // 检查是否有关联的报工记录
    const logCount = await db.collection('WorkLogs')
      .where({ process_id })
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

async function assignProcess(event) {
  const { process_id, user_ids } = event
  try {
    // 获取旧分配
    const oldProcess = await db.collection('Processes').doc(process_id).get()
    const oldIds = oldProcess.data ? (oldProcess.data.assigned_user_ids || []) : []

    await db.collection('Processes').doc(process_id).update({
      data: {
        assigned_user_ids: user_ids || [],
        updated_at: db.serverDate()
      }
    })

    // 审计日志
    await db.collection('audit_logs').add({
      data: {
        action: 'process_assign',
        target_id: process_id,
        details: `员工分配变更: [${oldIds.join(',')}] → [${(user_ids || []).join(',')}]`,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '分配成功' }
  } catch (err) {
    return { code: -1, msg: '分配失败' }
  }
}

async function getAssignedProcesses(event) {
  const { user_id } = event
  try {
    // 查找分配给该员工的工序
    let allAssignedProcesses = []
    let assignBatchLen = 0
    do {
      const res = await db.collection('Processes').where({
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
        if (orderRes.data && orderRes.data.status === 'active') {
          orderName = orderRes.data.order_name

          // 统计该订单该工序累计报工数量（所有员工）
          let allLogs = []
          let batchLen = 0
          do {
            const logRes = await db.collection('WorkLogs').where({
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

async function togglePriceHidden(event, wxContext) {
  const { order_id, price_hidden } = event
  if (!order_id || typeof price_hidden !== 'boolean') {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    await db.collection('Orders').doc(order_id).update({
      data: {
        price_hidden: price_hidden,
        updated_at: db.serverDate()
      }
    })

    const caller = await getCallerUser(wxContext)
    await db.collection('audit_logs').add({
      data: {
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
async function clearOrderPrices(event, wxContext) {
  const { order_id } = event
  if (!order_id) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    let allProcesses = []
    let clearBatchLen = 0
    do {
      const res = await db.collection('Processes')
        .where({ order_id })
        .skip(allProcesses.length)
        .limit(100)
        .get()
      clearBatchLen = (res.data || []).length
      allProcesses = allProcesses.concat(res.data || [])
    } while (clearBatchLen === 100)

    if (allProcesses.length === 0) {
      return { code: -1, msg: '该订单没有工序' }
    }

    const caller = await getCallerUser(wxContext)
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

// 获取订单工价变更日志
async function getPriceChangeLogs(event) {
  const { order_id } = event
  if (!order_id) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    // 先获取该订单的所有工序 ID
    let allProcData = []
    let procIdBatchLen = 0
    do {
      const res = await db.collection('Processes')
        .where({ order_id })
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
