// 云函数 - order (订单和工序管理)
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

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  // 写操作需要boss权限
  if (['create', 'updateStatus', 'addProcess', 'updateProcessPrice', 'updateProcess', 'deleteProcess', 'assignProcess'].includes(action)) {
    const caller = await getCallerUser(wxContext)
    if (!caller || caller.role !== 'boss') {
      return { code: -1, msg: '权限不足，仅管理员可操作' }
    }
  }

  switch (action) {
    case 'list': return await listOrders()
    case 'getDetail': return await getOrderDetail(event)
    case 'create': return await createOrder(event)
    case 'updateStatus': return await updateOrderStatus(event)
    case 'addProcess': return await addProcess(event)
    case 'updateProcessPrice': return await updateProcessPrice(event, wxContext)
    case 'updateProcess': return await updateProcess(event, wxContext)
    case 'deleteProcess': return await deleteProcess(event)
    case 'assignProcess': return await assignProcess(event)
    case 'getAssignedProcesses': return await getAssignedProcesses(event)
    default: return { code: -1, msg: '未知操作' }
  }
}

async function listOrders() {
  try {
    const res = await db.collection('Orders')
      .orderBy('created_at', 'desc')
      .limit(100)
      .get()

    // 获取每个订单的工序数量
    const orders = []
    for (const order of res.data) {
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
    const processRes = await db.collection('Processes')
      .where({ order_id })
      .orderBy('created_at', 'asc')
      .get()

    // 为每个工序获取分配的员工名称
    const processes = []
    for (const p of processRes.data) {
      let assignedNames = '未分配'
      if (p.assigned_user_ids && p.assigned_user_ids.length > 0) {
        const userRes = await db.collection('Users')
          .where({ _id: _.in(p.assigned_user_ids) })
          .field({ name: true })
          .get()
        assignedNames = userRes.data.map(u => u.name).join('、')
      }
      processes.push({ ...p, assigned_names: assignedNames })
    }

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

async function addProcess(event) {
  const { order_id, process_name, current_price, note } = event
  if (!order_id || !process_name || !current_price) {
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
    await db.collection('Processes').doc(process_id).update({
      data: {
        current_price: parseFloat(new_price),
        updated_at: db.serverDate()
      }
    })

    // 记录改价日志
    const caller = await getCallerUser(wxContext)
    await db.collection('audit_logs').add({
      data: {
        operator_id: caller._id,
        operator_name: caller.name,
        action: 'update_process_price',
        target_id: process_id,
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

    const caller = await getCallerUser(wxContext)
    await db.collection('audit_logs').add({
      data: {
        operator_id: caller._id,
        operator_name: caller.name,
        action: 'process_update',
        target_id: process_id,
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

    const hasPrice = changes.some(c => c.startsWith('单价'))
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
    const processRes = await db.collection('Processes').where({
      assigned_user_ids: user_id,
      status: 'active'
    }).get()

    // 关联订单名
    const processes = []
    for (const p of processRes.data) {
      let orderName = ''
      try {
        const orderRes = await db.collection('Orders').doc(p.order_id).get()
        if (orderRes.data && orderRes.data.status === 'active') {
          orderName = orderRes.data.order_name
          processes.push({
            _id: p._id,
            order_id: p.order_id,
            order_name: orderName,
            process_name: p.process_name,
            current_price: p.current_price
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
