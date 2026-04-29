// 云函数 - platform（平台管理员管理工厂）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const crypto = require('crypto')

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeFactoryCode(value) {
  return normalizeText(value).toUpperCase()
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex')
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex')
}

async function getCaller(event) {
  const userId = normalizeText(event && event.auth_user_id)
  const token = normalizeText(event && event.auth_session_token)
  if (!userId || !token) return null

  try {
    const res = await db.collection('Users').where({
      _id: userId,
      session_token: token,
      status: 'active'
    }).limit(1).get()
    return res.data && res.data.length ? res.data[0] : null
  } catch (err) {
    return null
  }
}

async function requirePlatformAdmin(event) {
  const caller = await getCaller(event)
  if (!caller || caller.platform_role !== 'platform_admin') {
    return { ok: false, response: { code: -1, msg: '权限不足，仅平台管理员可操作' } }
  }
  return { ok: true, caller }
}

async function writePlatformLog(caller, actionType, targetOrgId, payloadSummary) {
  try {
    await db.collection('PlatformOperationLogs').add({
      data: {
        platform_operator_id: caller._id,
        platform_operator_name: caller.name || '',
        action_type: actionType,
        target_org_id: targetOrgId || '',
        payload_summary: payloadSummary || '',
        timestamp: db.serverDate()
      }
    })
  } catch (err) {}
}

function defaultFactorySettings(orgId) {
  return {
    org_id: orgId,
    factory_latitude: 39.9042,
    factory_longitude: 116.4074,
    geofence_radius: 100,
    coordinate_system: 'gcj02',
    location_source: 'default_placeholder',
    location_confirmed: false,
    quality_threshold: 95,
    export_email: '',
    qrcode_expire_days: 1,
    face_recognition_enabled: false,
    allow_home_checkin: false,
    leaderboard_visible: false,
    smtp_host: '',
    smtp_port: '465',
    smtp_user: '',
    smtp_pass: '',
    review_mode_enabled: false,
    review_mode_note: '',
    updated_at: db.serverDate()
  }
}

exports.main = async (event, context) => {
  const action = event.action
  switch (action) {
    case 'listOrganizations': return await listOrganizations(event)
    case 'createOrganization': return await createOrganization(event)
    case 'updateOrganization': return await updateOrganization(event)
    case 'disableOrganization': return await updateOrganizationStatus(event, 'disabled')
    case 'enableOrganization': return await updateOrganizationStatus(event, 'active')
    case 'listFactoryAdmins': return await listFactoryAdmins(event)
    case 'createFactoryAdmin': return await createFactoryAdmin(event)
    case 'resetFactoryAdminPassword': return await resetFactoryAdminPassword(event)
    default: return { code: -1, msg: '未知操作' }
  }
}

async function listFactoryAdmins(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  if (!orgId) return { code: -1, msg: '缺少工厂ID' }

  try {
    const admins = []
    let batchLen = 0
    do {
      const res = await db.collection('Users')
        .where({ org_id: orgId, role: 'boss', status: 'active' })
        .orderBy('created_at', 'desc')
        .skip(admins.length)
        .limit(100)
        .get()
      batchLen = (res.data || []).length
      admins.push(...(res.data || []))
    } while (batchLen === 100)

    return {
      code: 0,
      data: admins.map((item) => ({
        _id: item._id,
        org_id: item.org_id,
        name: item.name,
        phone: item.phone,
        status: item.status
      }))
    }
  } catch (err) {
    return { code: -1, msg: '获取工厂管理员失败' }
  }
}

async function listOrganizations(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  try {
    const list = []
    let batchLen = 0
    do {
      const res = await db.collection('Organizations')
        .orderBy('created_at', 'desc')
        .skip(list.length)
        .limit(100)
        .get()
      batchLen = (res.data || []).length
      list.push(...(res.data || []))
    } while (batchLen === 100)

    return { code: 0, data: list }
  } catch (err) {
    return { code: -1, msg: '获取工厂列表失败' }
  }
}

async function createOrganization(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgName = normalizeText(event.org_name)
  const factoryCode = normalizeFactoryCode(event.factory_code)
  const contactName = normalizeText(event.contact_name)
  const contactPhone = normalizeText(event.contact_phone)

  if (!orgName || !factoryCode) {
    return { code: -1, msg: '工厂名称和工厂码不能为空' }
  }

  try {
    const existing = await db.collection('Organizations').where({ factory_code: factoryCode }).limit(1).get()
    if (existing.data && existing.data.length) {
      return { code: -1, msg: '工厂码已存在' }
    }

    const addRes = await db.collection('Organizations').add({
      data: {
        org_name: orgName,
        factory_code: factoryCode,
        contact_name: contactName,
        contact_phone: contactPhone,
        status: 'active',
        billing_status: 'not_enabled',
        created_by: auth.caller._id,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })

    await db.collection('factory_settings').doc(addRes._id).set({
      data: defaultFactorySettings(addRes._id)
    })

    await writePlatformLog(auth.caller, 'create_organization', addRes._id, `${factoryCode}/${orgName}`)
    return { code: 0, msg: '工厂创建成功', data: { org_id: addRes._id } }
  } catch (err) {
    return { code: -1, msg: '创建工厂失败: ' + err.message }
  }
}

async function updateOrganization(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  const orgName = normalizeText(event.org_name)
  const factoryCode = normalizeFactoryCode(event.factory_code)
  const contactName = normalizeText(event.contact_name)
  const contactPhone = normalizeText(event.contact_phone)

  if (!orgId) return { code: -1, msg: '缺少工厂ID' }
  if (!orgName || !factoryCode) {
    return { code: -1, msg: '工厂名称和工厂码不能为空' }
  }

  try {
    const orgRes = await db.collection('Organizations').doc(orgId).get()
    const org = orgRes.data
    if (!org) return { code: -1, msg: '工厂不存在' }

    if (factoryCode !== org.factory_code) {
      const existing = await db.collection('Organizations').where({ factory_code: factoryCode }).limit(1).get()
      const conflict = (existing.data || []).find(item => item._id !== orgId)
      if (conflict) return { code: -1, msg: '工厂码已存在' }
    }

    const updateData = {
      org_name: orgName,
      factory_code: factoryCode,
      contact_name: contactName,
      contact_phone: contactPhone,
      updated_at: db.serverDate()
    }

    await db.collection('Organizations').doc(orgId).update({ data: updateData })
    await writePlatformLog(auth.caller, 'update_organization', orgId, `${org.factory_code}/${org.org_name} -> ${factoryCode}/${orgName}`)

    return {
      code: 0,
      msg: '工厂信息已保存',
      data: Object.assign({}, org, updateData)
    }
  } catch (err) {
    return { code: -1, msg: '保存工厂信息失败: ' + err.message }
  }
}

async function updateOrganizationStatus(event, status) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  if (!orgId) return { code: -1, msg: '缺少工厂ID' }

  try {
    await db.collection('Organizations').doc(orgId).update({
      data: {
        status,
        updated_at: db.serverDate()
      }
    })
    await writePlatformLog(auth.caller, status === 'active' ? 'enable_organization' : 'disable_organization', orgId, status)
    return { code: 0, msg: status === 'active' ? '工厂已启用' : '工厂已停用' }
  } catch (err) {
    return { code: -1, msg: '更新工厂状态失败' }
  }
}

async function createFactoryAdmin(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  const name = normalizeText(event.name)
  const phone = normalizeText(event.phone)
  const password = normalizeText(event.password) || phone

  if (!orgId || !name || !phone) {
    return { code: -1, msg: '工厂、姓名和手机号不能为空' }
  }

  try {
    const orgRes = await db.collection('Organizations').doc(orgId).get()
    const org = orgRes.data
    if (!org || org.status !== 'active') {
      return { code: -1, msg: '工厂不存在或已停用' }
    }

    const existing = await db.collection('Users').where({
      org_id: orgId,
      name,
      phone
    }).limit(1).get()
    if (existing.data && existing.data.length) {
      return { code: -1, msg: '该工厂下账号已存在' }
    }

    const salt = generateSalt()
    await db.collection('Users').add({
      data: {
        org_id: orgId,
        name,
        phone,
        role: 'boss',
        platform_role: null,
        password_hash: hashPassword(password, salt),
        salt,
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

    await writePlatformLog(auth.caller, 'create_factory_admin', orgId, `${org.factory_code}/${name}/${phone}`)
    return { code: 0, msg: '工厂管理员创建成功' }
  } catch (err) {
    return { code: -1, msg: '创建工厂管理员失败' }
  }
}

async function resetFactoryAdminPassword(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const userId = normalizeText(event.user_id)
  if (!userId) return { code: -1, msg: '缺少用户ID' }

  try {
    const userRes = await db.collection('Users').doc(userId).get()
    const user = userRes.data
    if (!user || user.role !== 'boss') {
      return { code: -1, msg: '工厂管理员不存在' }
    }

    const salt = generateSalt()
    await db.collection('Users').doc(userId).update({
      data: {
        password_hash: hashPassword(user.phone, salt),
        salt,
        password_changed: false,
        must_change_password: true,
        session_token: '',
        updated_at: db.serverDate()
      }
    })

    await writePlatformLog(auth.caller, 'reset_factory_admin_password', user.org_id || '', `${user.name}/${user.phone}`)
    return { code: 0, msg: '密码已重置为手机号' }
  } catch (err) {
    return { code: -1, msg: '重置密码失败' }
  }
}
