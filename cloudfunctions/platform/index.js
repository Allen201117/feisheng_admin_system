// 云函数 - platform（平台管理员管理工厂）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const crypto = require('crypto')
// 订阅状态 / 列表三分类 / 到期文字 / 工厂码与手机号校验的唯一真源（common/org-billing.logic.js 的副本）
const orgBilling = require('./org-billing.logic')
const PERMANENT_HOME_ORG_ID = 'org_home'
const PERMANENT_HOME_FACTORY_CODE = 'A001'
const RECENT_BILLING_ORDER_LIMIT = 20

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function normalizeFactoryCode(value) {
  return orgBilling.normalizeFactoryCode(value)
}

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex')
}

function generateSalt() {
  return crypto.randomBytes(16).toString('hex')
}

// 与 login 云函数 isStrongPassword 同口径（不填则默认手机号，首次登录强制改密）
function isAcceptableInitialPassword(pwd) {
  return pwd.length >= 8 && /[a-zA-Z]/.test(pwd) && /[0-9]/.test(pwd)
}

const authGuard = require('./auth-guard')

// 统一鉴权（见 auth-guard.js）：与业务云函数同口径，含调用者自身工厂 status=active 校验，
// 平台组织 org_platform 被停用时平台管理员同样失效（修复历史上 platform 鉴权更弱的问题）。
async function getCaller(event) {
  return await authGuard.getCallerUserByEvent(db, event)
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
  } catch (err) {
    // 审计日志失败不阻断已完成的业务写入，但必须留痕
    console.error('[platform] 平台操作日志写入失败', actionType, targetOrgId, err)
  }
}

async function ensurePermanentHomeFactory() {
  async function applyPermanent(org) {
    const subscriptionId = `sub_${org._id}_permanent`
    const now = new Date()
    if (
      org.billing_status === 'permanent' &&
      org.plan_id === 'standard_year' &&
      org.subscription_id === subscriptionId &&
      !org.current_period_end
    ) return

    try {
      await db.collection('Subscriptions').doc(subscriptionId).set({
        data: {
          org_id: org._id,
          plan_id: 'standard_year',
          plan_name: '标准版年付',
          status: 'permanent',
          start_at: org.current_period_start || now,
          end_at: '',
          grace_until: '',
          source: 'owner_factory_grant',
          opened_by: 'system',
          opened_by_name: '系统',
          remark: '飞盛自家工厂 A001 永久免费',
          created_at: org.current_period_start || db.serverDate(),
          updated_at: db.serverDate()
        }
      })
    } catch (err) {
      // 与 billing 同口径：订阅记录写失败就不标 permanent，避免两边状态不一致
      console.error('[platform] 永久订阅记录写入失败，中止 permanent 标记', org._id, err)
      return
    }

    await db.collection('Organizations').doc(org._id).update({
      data: {
        billing_status: 'permanent',
        plan_id: 'standard_year',
        subscription_id: subscriptionId,
        trial_end: '',
        current_period_start: org.current_period_start || now,
        current_period_end: '',
        grace_until: '',
        billing_owner_user_id: '',
        billing_updated_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })
  }

  try {
    const home = await getOrganizationOrNull(PERMANENT_HOME_ORG_ID)
    if (home && home.status === 'active') {
      if (home.factory_code === PERMANENT_HOME_FACTORY_CODE || home.org_name === '飞盛') {
        await applyPermanent(home)
        return
      }
    }
  } catch (err) {
    console.error('[platform] ensurePermanentHomeFactory 按 doc 处理失败', err)
  }

  try {
    const codeRes = await db.collection('Organizations')
      .where({ factory_code: PERMANENT_HOME_FACTORY_CODE, status: 'active' })
      .limit(1)
      .get()
    if (codeRes.data && codeRes.data.length) await applyPermanent(codeRes.data[0])
  } catch (err) {
    console.error('[platform] ensurePermanentHomeFactory 按工厂码处理失败', err)
  }
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

function toOrgView(org) {
  return orgBilling.buildOrgView(org, Date.now())
}

function toAdminView(item) {
  return {
    _id: item._id,
    org_id: item.org_id,
    name: item.name,
    phone: item.phone,
    status: item.status,
    must_change_password: !!item.must_change_password
  }
}

// 不存在的 doc().get() 会抛错，统一转成 null，真正的查询故障照常抛出
async function getOrganizationOrNull(orgId) {
  const res = await db.collection('Organizations').where({ _id: orgId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

function isCollectionNotExistError(err) {
  const text = String((err && (err.message || err.errMsg)) || '')
  return !!(err && (err.errCode === -502005 || text.includes('DATABASE_COLLECTION_NOT_EXIST') || text.includes('collection not exist')))
}

// BillingOrders 由 billing 首次开通时建；新环境还没开通过任何工厂时集合不存在，按「没有记录」处理
async function listRecentBillingOrders(orgId) {
  try {
    return await db.collection('BillingOrders')
      .where({ org_id: orgId })
      .orderBy('created_at', 'desc')
      .limit(RECENT_BILLING_ORDER_LIMIT)
      .get()
  } catch (err) {
    if (isCollectionNotExistError(err)) return { data: [] }
    throw err
  }
}

async function listAllBosses(orgId) {
  const list = []
  let batchLen = 0
  do {
    const res = await db.collection('Users')
      .where({ org_id: orgId, role: 'boss' })
      .orderBy('created_at', 'desc')
      .skip(list.length)
      .limit(100)
      .get()
    batchLen = (res.data || []).length
    list.push(...(res.data || []))
  } while (batchLen === 100)
  return list
}

exports.main = async (event, context) => {
  const action = event.action
  switch (action) {
    case 'listOrganizations': return await listOrganizations(event)
    case 'getOrganizationDetail': return await getOrganizationDetail(event)
    case 'createOrganization': return await createOrganization(event)
    case 'updateOrganization': return await updateOrganization(event)
    case 'disableOrganization': return await updateOrganizationStatus(event, 'disabled')
    case 'enableOrganization': return await updateOrganizationStatus(event, 'active')
    case 'listFactoryAdmins': return await listFactoryAdmins(event)
    case 'createFactoryAdmin': return await createFactoryAdmin(event)
    case 'resetFactoryAdminPassword': return await resetFactoryAdminPassword(event)
    case 'setFactoryAdminStatus': return await setFactoryAdminStatus(event)
    default: return { code: -1, msg: '未知操作' }
  }
}

// 旧版前端在用：只返回在用的老板账号
async function listFactoryAdmins(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  if (!orgId) return { code: -1, msg: '缺少工厂ID' }

  try {
    const admins = (await listAllBosses(orgId)).filter(item => item.status === 'active')
    return { code: 0, data: admins.map(toAdminView) }
  } catch (err) {
    console.error('[platform] 获取工厂管理员失败', orgId, err)
    return { code: -1, msg: '获取工厂管理员失败' }
  }
}

async function listOrganizations(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  try {
    await ensurePermanentHomeFactory()

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

    // 平台组织自身不是工厂，不在列表里出现（它不能开通订阅、也不允许停用）
    const factories = list.filter(org => !orgBilling.isPlatformOrg(org))
    // data 仍是工厂数组（旧版前端直接用），新增字段只追加；summary 给新版总览用
    return {
      code: 0,
      data: factories.map(toOrgView),
      summary: orgBilling.summarizeOrgBuckets(factories)
    }
  } catch (err) {
    console.error('[platform] 获取工厂列表失败', err)
    return { code: -1, msg: '获取工厂列表失败' }
  }
}

// 工厂详情一次取齐：工厂视图 + 全部老板账号 + 最近开通记录 + 在用员工数（替代前端分两次调用）
async function getOrganizationDetail(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  if (!orgId) return { code: -1, msg: '缺少工厂ID' }

  try {
    const org = await getOrganizationOrNull(orgId)
    if (!org || orgBilling.isPlatformOrg(org)) return { code: -1, msg: '工厂不存在' }

    const [bosses, ordersRes, employeeCountRes] = await Promise.all([
      listAllBosses(orgId),
      listRecentBillingOrders(orgId),
      // 与 user.ensureEmployeeLimit 同口径：在用的 employee + qc
      db.collection('Users')
        .where({ org_id: orgId, status: 'active', role: _.in(['employee', 'qc']) })
        .count()
    ])

    const admins = bosses
      .map(toAdminView)
      .sort((a, b) => (a.status === 'active' ? 0 : 1) - (b.status === 'active' ? 0 : 1))

    return {
      code: 0,
      data: {
        organization: toOrgView(org),
        admins,
        active_admin_count: admins.filter(item => item.status === 'active').length,
        billing_orders: (ordersRes.data || []).map(item => orgBilling.decorateBillingOrder(item)),
        employee_count: employeeCountRes.total || 0
      }
    }
  } catch (err) {
    console.error('[platform] 获取工厂详情失败', orgId, err)
    return { code: -1, msg: '获取工厂详情失败，请下拉刷新重试' }
  }
}

function readOrgForm(event) {
  return {
    orgName: normalizeText(event.org_name),
    rawFactoryCode: event.factory_code,
    contactName: normalizeText(event.contact_name),
    contactPhone: normalizeText(event.contact_phone)
  }
}

function validateOrgBasics(form) {
  if (!form.orgName) return '请填写工厂名称'
  if (form.orgName.length > 30) return '工厂名称最多 30 个字'
  if (form.contactName.length > 20) return '联系人最多 20 个字'
  if (form.contactPhone.length > 20) return '联系电话最多 20 位'
  return ''
}

async function findFactoryCodeConflict(factoryCode, selfId) {
  const existing = await db.collection('Organizations').where({ factory_code: factoryCode }).limit(2).get()
  return (existing.data || []).find(item => item._id !== selfId) || null
}

async function createOrganization(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const form = readOrgForm(event)
  const basicError = validateOrgBasics(form)
  if (basicError) return { code: -1, msg: basicError }
  const codeCheck = orgBilling.validateFactoryCode(form.rawFactoryCode)
  if (!codeCheck.ok) return { code: -1, msg: codeCheck.msg }
  const factoryCode = codeCheck.code

  try {
    if (await findFactoryCodeConflict(factoryCode, '')) {
      return { code: -1, msg: '工厂码 ' + factoryCode + ' 已被其他工厂使用' }
    }

    const orgData = {
      org_name: form.orgName,
      factory_code: factoryCode,
      contact_name: form.contactName,
      contact_phone: form.contactPhone,
      status: 'active',
      billing_status: 'not_enabled',
      created_by: auth.caller._id,
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
    const addRes = await db.collection('Organizations').add({ data: orgData })

    await db.collection('factory_settings').doc(addRes._id).set({
      data: defaultFactorySettings(addRes._id)
    })

    await writePlatformLog(auth.caller, 'create_organization', addRes._id, `${factoryCode}/${form.orgName}`)
    const created = await getOrganizationOrNull(addRes._id)
    return {
      code: 0,
      msg: '工厂创建成功',
      data: { org_id: addRes._id, organization: created ? toOrgView(created) : null }
    }
  } catch (err) {
    console.error('[platform] 创建工厂失败', factoryCode, err)
    return { code: -1, msg: '创建工厂失败: ' + err.message }
  }
}

async function updateOrganization(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  if (!orgId) return { code: -1, msg: '缺少工厂ID' }
  const form = readOrgForm(event)
  const basicError = validateOrgBasics(form)
  if (basicError) return { code: -1, msg: basicError }
  const factoryCode = normalizeFactoryCode(form.rawFactoryCode)
  if (!factoryCode) return { code: -1, msg: '请填写工厂码' }

  try {
    const org = await getOrganizationOrNull(orgId)
    if (!org || orgBilling.isPlatformOrg(org)) return { code: -1, msg: '工厂不存在' }

    // 不区分大小写比较：只是大小写不同不算改码（登录本来就把输入转大写匹配）
    const codeChanged = factoryCode !== normalizeFactoryCode(org.factory_code)
    if (codeChanged && orgId === PERMANENT_HOME_ORG_ID) {
      // 永久免费按工厂码 A001 认；自家工厂改码后别的工厂拿到 A001 就会被误判成永久免费
      return { code: -1, msg: '自家工厂的工厂码不能改' }
    }
    if (codeChanged) {
      // 只校验新码格式：存量工厂码可能不符合新规则，不改码时不应被拦
      const codeCheck = orgBilling.validateFactoryCode(factoryCode)
      if (!codeCheck.ok) return { code: -1, msg: codeCheck.msg }
    }
    // 存量小写码保存时统一转大写（登录把输入转大写后精确匹配，小写码本来就登不进去）
    if (factoryCode !== org.factory_code && await findFactoryCodeConflict(factoryCode, orgId)) {
      return { code: -1, msg: '工厂码 ' + factoryCode + ' 已被其他工厂使用' }
    }

    const updateData = {
      org_name: form.orgName,
      factory_code: factoryCode,
      contact_name: form.contactName,
      contact_phone: form.contactPhone,
      updated_at: db.serverDate()
    }

    await db.collection('Organizations').doc(orgId).update({ data: updateData })
    await writePlatformLog(auth.caller, 'update_organization', orgId, `${org.factory_code}/${org.org_name} -> ${factoryCode}/${form.orgName}`)

    return {
      code: 0,
      msg: codeChanged ? '已保存，工厂码已改为 ' + factoryCode : '工厂资料已保存',
      data: Object.assign(toOrgView(Object.assign({}, org, updateData, { updated_at: new Date() })), {
        factory_code_changed: codeChanged
      })
    }
  } catch (err) {
    console.error('[platform] 保存工厂资料失败', orgId, err)
    return { code: -1, msg: '保存工厂信息失败: ' + err.message }
  }
}

async function updateOrganizationStatus(event, status) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  if (!orgId) return { code: -1, msg: '缺少工厂ID' }

  // 平台组织与永久工厂禁止停用：org_platform 被停用会冻结所有平台管理员（鉴权统一后同口径校验工厂状态）
  if (status !== 'active' && (orgId === 'org_platform' || orgId === PERMANENT_HOME_ORG_ID)) {
    return { code: -1, msg: '该组织为平台/永久工厂，不可停用' }
  }

  try {
    const org = await getOrganizationOrNull(orgId)
    if (!org) return { code: -1, msg: '工厂不存在' }

    await db.collection('Organizations').doc(orgId).update({
      data: {
        status,
        updated_at: db.serverDate()
      }
    })
    await writePlatformLog(auth.caller, status === 'active' ? 'enable_organization' : 'disable_organization', orgId, status)
    return {
      code: 0,
      msg: status === 'active' ? '工厂已启用' : '工厂已停用',
      data: toOrgView(Object.assign({}, org, { status }))
    }
  } catch (err) {
    console.error('[platform] 更新工厂状态失败', orgId, status, err)
    return { code: -1, msg: '更新工厂状态失败' }
  }
}

async function createFactoryAdmin(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  const name = normalizeText(event.name)
  const customPassword = normalizeText(event.password)

  if (!orgId) return { code: -1, msg: '缺少工厂ID' }
  if (!name) return { code: -1, msg: '请填写姓名' }
  if (name.length > 20) return { code: -1, msg: '姓名最多 20 个字' }
  const phoneCheck = orgBilling.validateMobile(event.phone)
  if (!phoneCheck.ok) return { code: -1, msg: phoneCheck.msg }
  const phone = phoneCheck.phone
  if (customPassword && !isAcceptableInitialPassword(customPassword)) {
    return { code: -1, msg: '初始密码至少 8 位，要同时有字母和数字；不填就默认是手机号' }
  }
  const password = customPassword || phone

  try {
    const org = await getOrganizationOrNull(orgId)
    if (!org || org.status !== 'active' || orgBilling.isPlatformOrg(org)) {
      return { code: -1, msg: '工厂不存在或已停用' }
    }

    // 登录按「工厂码 + 姓名 + 手机号」定位账号，三者相同就是同一个人
    const existing = await db.collection('Users').where({
      org_id: orgId,
      name,
      phone
    }).limit(1).get()
    const dup = existing.data && existing.data[0]
    if (dup) {
      if (dup.role === 'boss' && dup.status !== 'active') {
        return { code: -1, msg: '这个老板账号已存在但被停用了，在列表里点「恢复」即可' }
      }
      return { code: -1, msg: '该工厂下已有同名同手机号的账号' }
    }

    const salt = generateSalt()
    const addRes = await db.collection('Users').add({
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
    return {
      code: 0,
      msg: customPassword ? '老板账号已创建' : '老板账号已创建，初始密码是手机号',
      data: { user_id: addRes._id }
    }
  } catch (err) {
    console.error('[platform] 创建工厂管理员失败', orgId, err)
    return { code: -1, msg: '创建工厂管理员失败' }
  }
}

async function getBossOrError(userId) {
  const res = await db.collection('Users').where({ _id: userId }).limit(1).get()
  const user = res.data && res.data[0]
  if (!user || user.role !== 'boss' || user.platform_role === 'platform_admin') return null
  return user
}

async function resetFactoryAdminPassword(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const userId = normalizeText(event.user_id)
  if (!userId) return { code: -1, msg: '缺少用户ID' }

  try {
    const user = await getBossOrError(userId)
    if (!user) return { code: -1, msg: '工厂管理员不存在' }

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
    console.error('[platform] 重置密码失败', userId, err)
    return { code: -1, msg: '重置密码失败' }
  }
}

// 停用 / 恢复老板账号。停用即清 session_token 踢下线；工厂最后一个在用的老板不能停（否则这家厂没人能管）。
async function setFactoryAdminStatus(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const userId = normalizeText(event.user_id)
  const status = normalizeText(event.status)
  if (!userId) return { code: -1, msg: '缺少用户ID' }
  if (!['active', 'disabled'].includes(status)) return { code: -1, msg: '状态参数无效' }

  try {
    const user = await getBossOrError(userId)
    if (!user) return { code: -1, msg: '工厂管理员不存在' }
    if (user.status === status) {
      return { code: 0, msg: status === 'active' ? '账号已经是在用状态' : '账号已经停用' }
    }

    if (status === 'disabled') {
      const others = await db.collection('Users')
        .where({ org_id: user.org_id, role: 'boss', status: 'active', _id: _.neq(userId) })
        .count()
      if (!others.total) {
        // 提示走 showToast，控制在 24 字内免得被截断
        return { code: -1, msg: '这是最后一个在用的老板账号，先添加新老板再停用' }
      }
    }

    const data = { status, updated_at: db.serverDate() }
    if (status === 'disabled') data.session_token = ''
    await db.collection('Users').doc(userId).update({ data })

    await writePlatformLog(
      auth.caller,
      status === 'active' ? 'enable_factory_admin' : 'disable_factory_admin',
      user.org_id || '',
      `${user.name}/${user.phone}`
    )
    return { code: 0, msg: status === 'active' ? '账号已恢复' : '账号已停用，对方已被退出登录' }
  } catch (err) {
    console.error('[platform] 更新老板账号状态失败', userId, status, err)
    return { code: -1, msg: '操作失败，请重试' }
  }
}
