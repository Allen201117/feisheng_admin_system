// 云函数 - user (用户管理 + 密码重置)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const crypto = require('crypto')

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex')
}
function generateSalt() {
  return crypto.randomBytes(16).toString('hex')
}

async function getBossUser(wxContext) {
  const res = await db.collection('Users').where({
    openid: wxContext.OPENID, role: 'boss', status: 'active'
  }).get()
  return res.data.length > 0 ? res.data[0] : null
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  if (['create', 'update', 'updateStatus', 'resetPassword', 'updateJoinDate'].includes(action)) {
    const boss = await getBossUser(wxContext)
    if (!boss) return { code: -1, msg: '权限不足，仅管理员可操作' }
    event._boss = boss
  }

  switch (action) {
    case 'list': return await listUsers(event)
    case 'listEmployees': return await listEmployees(event)
    case 'get': return await getUser(event)
    case 'create': return await createUser(event)
    case 'update': return await updateUser(event)
    case 'updateStatus': return await updateStatus(event)
    case 'resetPassword': return await resetPassword(event)
    case 'updateJoinDate': return await updateJoinDate(event)
    default: return { code: -1, msg: '未知操作' }
  }
}

async function listUsers() {
  try {
    const res = await db.collection('Users')
      .orderBy('created_at', 'desc').limit(100).get()
    return { code: 0, data: res.data }
  } catch (err) {
    return { code: -1, msg: '获取用户列表失败' }
  }
}

async function listEmployees() {
  try {
    const res = await db.collection('Users')
      .where({ status: 'active', role: _.in(['employee', 'qc']) })
      .orderBy('name', 'asc').get()
    return { code: 0, data: res.data.map(u => ({ _id: u._id, name: u.name, role: u.role, join_date: u.join_date || '' })) }
  } catch (err) {
    return { code: -1, msg: '获取员工列表失败' }
  }
}

async function getUser(event) {
  try {
    const res = await db.collection('Users').doc(event.user_id).get()
    const user = res.data
    return { code: 0, data: { _id: user._id, name: user.name, phone: user.phone, role: user.role, status: user.status, join_date: user.join_date || '' } }
  } catch (err) {
    return { code: -1, msg: '获取用户信息失败' }
  }
}

async function createUser(event) {
  const { name, phone, role, password } = event
  if (!name || !phone) return { code: -1, msg: '姓名和手机号不能为空' }
  if (!['boss', 'qc', 'employee'].includes(role)) return { code: -1, msg: '无效的角色' }

  const existing = await db.collection('Users').where({ phone }).count()
  if (existing.total > 0) return { code: -1, msg: '该手机号已注册' }

  const salt = generateSalt()
  const pwd = password || phone
  const password_hash = hashPassword(pwd, salt)

  try {
    await db.collection('Users').add({
      data: {
        name, phone, role, password_hash, salt,
        status: 'active',
        password_changed: false,
        must_change_password: true,
        monthly_hours: 0,
        openid: '',
        session_token: '',
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
    return { code: 0, msg: '创建成功' }
  } catch (err) {
    return { code: -1, msg: '创建用户失败' }
  }
}

async function updateUser(event) {
  const { user_id, name, phone, role, password } = event
  if (!user_id) return { code: -1, msg: '缺少用户ID' }

  const updateData = { updated_at: db.serverDate() }
  if (name) updateData.name = name
  if (phone) updateData.phone = phone
  if (role && ['boss', 'qc', 'employee'].includes(role)) updateData.role = role
  if (password) {
    const salt = generateSalt()
    updateData.salt = salt
    updateData.password_hash = hashPassword(password, salt)
  }

  try {
    await db.collection('Users').doc(user_id).update({ data: updateData })
    return { code: 0, msg: '更新成功' }
  } catch (err) {
    return { code: -1, msg: '更新失败' }
  }
}

async function updateStatus(event) {
  const { user_id, status } = event
  if (!user_id || !['active', 'disabled'].includes(status)) return { code: -1, msg: '参数无效' }

  try {
    await db.collection('Users').doc(user_id).update({
      data: { status, updated_at: db.serverDate() }
    })
    await db.collection('audit_logs').add({
      data: {
        action: status === 'active' ? 'enable_user' : 'disable_user',
        operator_id: event._boss ? event._boss._id : '',
        operator_name: event._boss ? event._boss.name : '',
        target_id: user_id,
        details: '用户状态变更为 ' + status,
        created_at: db.serverDate()
      }
    })
    return { code: 0, msg: '操作成功' }
  } catch (err) {
    return { code: -1, msg: '操作失败' }
  }
}

// 老板重置员工密码 - 重置为手机号，强制下次改密，踢下线
async function resetPassword(event) {
  const { user_id, reason } = event
  const boss = event._boss
  if (!user_id) return { code: -1, msg: '缺少用户ID' }

  try {
    const userRes = await db.collection('Users').doc(user_id).get()
    const user = userRes.data
    if (!user) return { code: -1, msg: '用户不存在' }

    // 重置密码为手机号
    const salt = generateSalt()
    const password_hash = hashPassword(user.phone, salt)

    await db.collection('Users').doc(user_id).update({
      data: {
        password_hash, salt,
        must_change_password: true,
        password_changed: false,
        session_token: '',  // 清除token，踢下线
        updated_at: db.serverDate()
      }
    })

    // 审计日志
    await db.collection('audit_logs').add({
      data: {
        action: 'reset_password',
        operator_id: boss._id,
        operator_name: boss.name,
        target_id: user_id,
        target_name: user.name,
        details: '重置密码为默认值（手机号），原因: ' + (reason || '管理员操作'),
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '密码已重置为手机号，员工下次登录需修改密码' }
  } catch (err) {
    return { code: -1, msg: '重置密码失败' }
  }
}

// 管理员设置/修改员工入厂时间
async function updateJoinDate(event) {
  const boss = event._boss
  const { user_id, join_date } = event
  if (!boss) return { code: -1, msg: '权限不足，仅管理员可操作' }
  if (!user_id) return { code: -1, msg: '缺少用户ID' }
  if (!join_date) return { code: -1, msg: '请选择入厂时间' }

  try {
    const userRes = await db.collection('Users').doc(user_id).get()
    if (!userRes.data) return { code: -1, msg: '用户不存在' }

    const oldDate = userRes.data.join_date || ''

    await db.collection('Users').doc(user_id).update({
      data: {
        join_date: join_date,
        join_date_set_by: boss._id,
        join_date_set_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })

    // 审计日志
    await db.collection('audit_logs').add({
      data: {
        action: 'user_join_date_update',
        operator_id: boss._id,
        operator_name: boss.name,
        target_id: user_id,
        target_name: userRes.data.name,
        old_value: oldDate,
        new_value: join_date,
        details: `入厂时间: ${oldDate || '未设置'} → ${join_date}`,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '入厂时间设置成功' }
  } catch (err) {
    return { code: -1, msg: '设置失败: ' + err.message }
  }
}
