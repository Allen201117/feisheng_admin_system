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

const authGuard = require('./auth-guard')

// 统一鉴权（见 auth-guard.js）：必须携带有效 token，工厂 status=active，失败一律拒绝。
async function getCallerUserByEvent(event, wxContext) {
  return await authGuard.getCallerUserByEvent(db, event)
}

async function getBossUserByEvent(event) {
  const caller = await getCallerUserByEvent(event)
  if (!caller || caller.role !== 'boss') return null
  return caller
}

function getOrgId(user) {
  return user && user.org_id ? user.org_id : ''
}

function isSameOrg(caller, doc) {
  return !!(caller && doc && getOrgId(caller) && doc.org_id === getOrgId(caller))
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

function getDefaultPlanLimit(planId) {
  if (planId === 'trial') return 10
  return 0
}

async function getEmployeeLimit(org) {
  if (!org || org.billing_status === 'not_enabled' || org.billing_status === 'permanent') return 0

  try {
    if (org.plan_id) {
      const planRes = await db.collection('Plans').where({
        plan_id: org.plan_id,
        status: 'active'
      }).limit(1).get()
      const plan = planRes.data && planRes.data[0]
      if (plan) return Number(plan.employee_limit || 0)
    }
  } catch (err) {}

  return getDefaultPlanLimit(org.plan_id)
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

async function ensureEmployeeLimit(caller, role) {
  if (!['employee', 'qc'].includes(role)) return { ok: true }

  const orgId = getOrgId(caller)
  if (!orgId) return { ok: true }

  try {
    const orgRes = await db.collection('Organizations').doc(orgId).get()
    const org = orgRes.data
    const limit = await getEmployeeLimit(org)
    if (!limit) return { ok: true }

    const countRes = await db.collection('Users').where({
      org_id: orgId,
      status: 'active',
      role: _.in(['employee', 'qc'])
    }).count()
    if ((countRes.total || 0) >= limit) {
      return { ok: false, msg: `当前套餐最多支持${limit}名员工，请升级标准版后再添加` }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: '员工数量校验失败，请稍后重试' }
  }
}

exports.main = async (event, context) => {
  const { action } = event

  if (['create', 'update', 'updateStatus', 'resetPassword', 'updateJoinDate'].includes(action)) {
    const boss = await getBossUserByEvent(event)
    if (!boss) return { code: -1, msg: '权限不足，仅管理员可操作' }
    event._boss = boss
  }

  if (action === 'create') {
    const entitlement = await ensureWritableEntitlement(event._boss)
    if (!entitlement.ok) return { code: -1, msg: entitlement.msg }
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

async function createUser(event) {
  const { name, phone, role, password } = event
  const boss = event._boss
  if (!name || !phone) return { code: -1, msg: '姓名和手机号不能为空' }
  if (!['boss', 'qc', 'employee'].includes(role)) return { code: -1, msg: '无效的角色' }

  const existing = await db.collection('Users').where({ org_id: getOrgId(boss), name, phone }).count()
  if (existing.total > 0) return { code: -1, msg: '该手机号已注册' }

  const limitResult = await ensureEmployeeLimit(boss, role)
  if (!limitResult.ok) return { code: -1, msg: limitResult.msg }

  const salt = generateSalt()
  const pwd = password || phone
  const password_hash = hashPassword(pwd, salt)

  try {
    await db.collection('Users').add({
      data: {
        org_id: getOrgId(boss),
        name, phone, role, password_hash, salt,
        platform_role: null,
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

async function listUsers(event) {
  const caller = await getCallerUserByEvent(event)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足，仅管理员可查看员工列表' }
  }

  try {
    const allUsers = []
    let batchLen = 0
    do {
      const res = await db.collection('Users')
        .where({ org_id: getOrgId(caller) })
        .orderBy('created_at', 'desc').skip(allUsers.length).limit(100).get()
      batchLen = res.data.length
      allUsers.push(...res.data)
    } while (batchLen === 100)
    return { code: 0, data: allUsers }
  } catch (err) {
    return { code: -1, msg: '获取用户列表失败' }
  }
}

async function listEmployees(event) {
  const caller = await getCallerUserByEvent(event)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足，仅管理员可查看员工列表' }
  }

  try {
    const allUsers = []
    let batchLen = 0
    do {
      const res = await db.collection('Users')
        .where({ org_id: getOrgId(caller), status: 'active', role: _.in(['employee', 'qc']) })
        .orderBy('name', 'asc').skip(allUsers.length).limit(100).get()
      batchLen = res.data.length
      allUsers.push(...res.data)
    } while (batchLen === 100)
    return { code: 0, data: allUsers.map(u => ({ _id: u._id, name: u.name, role: u.role, join_date: u.join_date || '' })) }
  } catch (err) {
    return { code: -1, msg: '获取员工列表失败' }
  }
}

async function getUser(event) {
  const caller = await getCallerUserByEvent(event)
  if (!caller) {
    return { code: -1, msg: '登录已失效，请重新登录' }
  }

  const targetUserId = event.user_id
  if (!targetUserId) {
    return { code: -1, msg: '缺少用户ID' }
  }

  if (caller.role !== 'boss' && String(caller._id) !== String(targetUserId)) {
    return { code: -1, msg: '无权查看其他员工信息' }
  }

  try {
    const res = await db.collection('Users').doc(targetUserId).get()
    const user = res.data
    if (!isSameOrg(caller, user)) {
      return { code: -1, msg: '无权查看其他工厂员工信息' }
    }
    return { code: 0, data: { _id: user._id, name: user.name, phone: user.phone, role: user.role, status: user.status, join_date: user.join_date || '' } }
  } catch (err) {
    return { code: -1, msg: '获取用户信息失败' }
  }
}

async function updateUser(event) {
  const { user_id, name, phone, role, password } = event
  if (!user_id) return { code: -1, msg: '缺少用户ID' }
  const boss = event._boss

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
    const userRes = await db.collection('Users').doc(user_id).get()
    if (!isSameOrg(boss, userRes.data)) {
      return { code: -1, msg: '无权修改其他工厂员工' }
    }
    await db.collection('Users').doc(user_id).update({ data: updateData })
    return { code: 0, msg: '更新成功' }
  } catch (err) {
    return { code: -1, msg: '更新失败' }
  }
}

async function updateStatus(event) {
  const { user_id, status } = event
  const boss = event._boss
  if (!user_id || !['active', 'disabled'].includes(status)) return { code: -1, msg: '参数无效' }

  try {
    const userRes = await db.collection('Users').doc(user_id).get()
    if (!isSameOrg(boss, userRes.data)) {
      return { code: -1, msg: '无权操作其他工厂员工' }
    }
    await db.collection('Users').doc(user_id).update({
      data: { status, updated_at: db.serverDate() }
    })
    await db.collection('audit_logs').add({
      data: {
        action: status === 'active' ? 'enable_user' : 'disable_user',
        org_id: getOrgId(boss),
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
    if (!isSameOrg(boss, user)) return { code: -1, msg: '无权重置其他工厂员工密码' }

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
        org_id: getOrgId(boss),
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
    if (!isSameOrg(boss, userRes.data)) return { code: -1, msg: '无权操作其他工厂员工' }

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
        org_id: getOrgId(boss),
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
