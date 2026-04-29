// 云函数 - init (数据库初始化)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const crypto = require('crypto')
const { migrateLocationData } = require('./migrate-location')
const { migrateTimezoneData } = require('./migrate-timezone')

const DEFAULT_HOME_ORG_ID = 'org_home'
const DEFAULT_HOME_FACTORY_CODE = 'HOME001'
const DEFAULT_PLATFORM_ORG_ID = 'org_platform'
const DEFAULT_PLATFORM_FACTORY_CODE = 'PLATFORM'

// 需要创建的集合列表
const COLLECTIONS = [
  'Organizations',
  'Users',
  'Orders',
  'Processes',
  'ProcessAssignments',
  'WorkLogs',
  'WorkLogAudit',
  'WorkLogEditAudit',
  'Attendances',
  'SalaryAdjustments',
  'SalaryPayments',
  'factory_settings',
  'audit_logs',
  'PlatformOperationLogs',
  'qr_codes',
  'export_history',
  'UsageDaily',
  'privacy_consents',
  'sign_location_logs'
]

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()

  // 鉴权：只有 boss 角色或首次初始化（无用户时）才能执行
  const usersCount = await db.collection('Users').count()
  if (usersCount.total > 0) {
    const callerRes = await db.collection('Users').where({
      openid: wxContext.OPENID, status: 'active', role: 'boss'
    }).limit(1).get()
    if (!callerRes.data || callerRes.data.length === 0) {
      return { code: -1, msg: '权限不足，仅管理员可执行初始化' }
    }
  }

  // 支持 migration 动作
  if (event.action === 'migrate_v2') {
    return await migrateV2()
  }
  if (event.action === 'migrate_multi_tenant') {
    return await migrateMultiTenant()
  }
  if (event.action === 'migrate_missing_org_batch') {
    return await migrateMissingOrgBatch(event)
  }
  if (event.action === 'migrate_location') {
    return await migrateLocationData()
  }
  if (event.action === 'migrate_timezone') {
    return await migrateTimezoneData(db, event)
  }

  const results = []

  // 1. 创建所有集合
  for (const name of COLLECTIONS) {
    try {
      await db.createCollection(name)
      results.push({ collection: name, status: '创建成功' })
    } catch (err) {
      if (err.errCode === -502005 || err.message.includes('already exists')) {
        results.push({ collection: name, status: '已存在' })
      } else {
        results.push({ collection: name, status: '失败: ' + err.message })
      }
    }
  }

  // 2. 创建默认工厂，历史单厂数据归属 HOME001
  try {
    const org = await ensureHomeOrganization()
    results.push({ item: '默认工厂', status: `已就绪（${org.factory_code} / ${org.org_name}）` })
    const platformOrg = await ensurePlatformOrganization()
    results.push({ item: '平台组织', status: `已就绪（${platformOrg.factory_code} / ${platformOrg.org_name}）` })
  } catch (err) {
    results.push({ item: '默认工厂', status: '失败: ' + err.message })
  }

  // 3. 初始化工厂设置（仅在不存在时创建，不覆盖已有设置）
  try {
    let existingSettings = null
    try {
      const existRes = await db.collection('factory_settings').doc(DEFAULT_HOME_ORG_ID).get()
      existingSettings = existRes.data
    } catch (e) {}

    if (!existingSettings) {
      await db.collection('factory_settings').doc(DEFAULT_HOME_ORG_ID).set({
        data: {
          org_id: DEFAULT_HOME_ORG_ID,
          factory_latitude: 39.9042,
          factory_longitude: 116.4074,
          geofence_radius: 100,
          coordinate_system: 'gcj02',
          location_source: 'default_placeholder',
          location_confirmed: false,
          quality_threshold: 95,
          export_email: '',
          qrcode_expire_days: 1,
          review_mode_enabled: false,
          review_mode_note: '',
          smtp_host: '',
          smtp_port: '465',
          smtp_user: '',
          smtp_pass: '',
          updated_at: db.serverDate()
        }
      })
      results.push({ item: '工厂设置', status: '初始化成功' })
    } else {
      results.push({ item: '工厂设置', status: '已存在，跳过' })
    }
  } catch (err) {
    results.push({ item: '工厂设置', status: '失败: ' + err.message })
  }

  // 4. 创建默认管理员账号（如果不存在）
  try {
    const adminPhone = event.admin_phone || ''
    const adminName = event.admin_name || '管理员'
    if (!adminPhone) {
      results.push({ item: '默认管理员', status: '跳过（未提供 admin_phone 参数）' })
    } else {
      const existing = await db.collection('Users').where({ org_id: DEFAULT_HOME_ORG_ID, phone: adminPhone }).get()
      if (!existing.data || existing.data.length === 0) {
        const salt = crypto.randomBytes(16).toString('hex')
        const password_hash = crypto.createHash('sha256').update(adminPhone + salt).digest('hex')

        await db.collection('Users').add({
          data: {
            org_id: DEFAULT_HOME_ORG_ID,
            name: adminName,
            phone: adminPhone,
            role: 'boss',
            platform_role: null,
            password_hash: password_hash,
            salt: salt,
            status: 'active',
            password_changed: false,
            must_change_password: true,
            openid: '',
            monthly_hours: 0,
            created_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        })
        results.push({ item: '默认管理员', status: `创建成功（姓名: ${adminName}，手机: ${adminPhone}）` })
      } else {
        results.push({ item: '默认管理员', status: `已存在（姓名: ${existing.data[0].name}，手机: ${adminPhone}）` })
      }
    }
  } catch (err) {
    results.push({ item: '默认管理员', status: '失败: ' + err.message })
  }

  // 可选：创建平台管理员账号（登录工厂码 PLATFORM）
  try {
    const platformAdminPhone = event.platform_admin_phone || ''
    const platformAdminName = event.platform_admin_name || '平台管理员'
    if (!platformAdminPhone) {
      results.push({ item: '平台管理员', status: '跳过（未提供 platform_admin_phone 参数）' })
    } else {
      const existing = await db.collection('Users').where({
        org_id: DEFAULT_PLATFORM_ORG_ID,
        phone: platformAdminPhone
      }).limit(1).get()
      if (!existing.data || existing.data.length === 0) {
        const salt = crypto.randomBytes(16).toString('hex')
        const password_hash = crypto.createHash('sha256').update(platformAdminPhone + salt).digest('hex')

        await db.collection('Users').add({
          data: {
            org_id: DEFAULT_PLATFORM_ORG_ID,
            name: platformAdminName,
            phone: platformAdminPhone,
            role: 'boss',
            platform_role: 'platform_admin',
            password_hash,
            salt,
            status: 'active',
            password_changed: false,
            must_change_password: true,
            openid: '',
            session_token: '',
            monthly_hours: 0,
            created_at: db.serverDate(),
            updated_at: db.serverDate()
          }
        })
        results.push({ item: '平台管理员', status: `创建成功（姓名: ${platformAdminName}，手机: ${platformAdminPhone}）` })
      } else {
        results.push({ item: '平台管理员', status: `已存在（姓名: ${existing.data[0].name}，手机: ${platformAdminPhone}）` })
      }
    }
  } catch (err) {
    results.push({ item: '平台管理员', status: '失败: ' + err.message })
  }

  // 5. 历史数据补 org_id / period_key
  try {
    const migrateResult = await migrateMultiTenant()
    results.push({ item: '多工厂迁移', status: migrateResult.msg, details: migrateResult.data })
  } catch (err) {
    results.push({ item: '多工厂迁移', status: '失败: ' + err.message })
  }

  // 6. 记录初始化日志
  try {
    await db.collection('audit_logs').add({
      data: {
        org_id: DEFAULT_HOME_ORG_ID,
        operator_id: 'system',
        operator_name: '系统',
        action: 'database_init',
        details: '数据库初始化完成',
        results: results,
        created_at: db.serverDate()
      }
    })
  } catch (err) {
    // ignore
  }

  return {
    code: 0,
    msg: '数据库初始化完成',
    data: results
  }
}

async function ensureHomeOrganization() {
  try {
    const existing = await db.collection('Organizations').doc(DEFAULT_HOME_ORG_ID).get()
    if (existing.data) {
      const updateData = {}
      if (!existing.data.factory_code) updateData.factory_code = DEFAULT_HOME_FACTORY_CODE
      if (!existing.data.org_name) updateData.org_name = '自家工厂'
      if (!existing.data.status) updateData.status = 'active'
      if (!existing.data.billing_status) updateData.billing_status = 'not_enabled'
      if (Object.keys(updateData).length > 0) {
        updateData.updated_at = db.serverDate()
        await db.collection('Organizations').doc(DEFAULT_HOME_ORG_ID).update({ data: updateData })
      }
      return Object.assign({}, existing.data, updateData)
    }
  } catch (e) {}

  await db.collection('Organizations').doc(DEFAULT_HOME_ORG_ID).set({
    data: {
      org_name: '自家工厂',
      factory_code: DEFAULT_HOME_FACTORY_CODE,
      contact_name: '',
      contact_phone: '',
      status: 'active',
      billing_status: 'not_enabled',
      created_by: 'system',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return {
    _id: DEFAULT_HOME_ORG_ID,
    org_name: '自家工厂',
    factory_code: DEFAULT_HOME_FACTORY_CODE,
    status: 'active'
  }
}

async function ensurePlatformOrganization() {
  try {
    const existing = await db.collection('Organizations').doc(DEFAULT_PLATFORM_ORG_ID).get()
    if (existing.data) {
      return existing.data
    }
  } catch (e) {}

  await db.collection('Organizations').doc(DEFAULT_PLATFORM_ORG_ID).set({
    data: {
      org_name: '平台管理',
      factory_code: DEFAULT_PLATFORM_FACTORY_CODE,
      contact_name: '',
      contact_phone: '',
      status: 'active',
      billing_status: 'not_enabled',
      created_by: 'system',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return {
    _id: DEFAULT_PLATFORM_ORG_ID,
    org_name: '平台管理',
    factory_code: DEFAULT_PLATFORM_FACTORY_CODE,
    status: 'active'
  }
}

async function fetchAllDocs(collectionName) {
  const all = []
  let batchLen = 0
  do {
    const res = await db.collection(collectionName).skip(all.length).limit(100).get()
    batchLen = (res.data || []).length
    all.push(...(res.data || []))
  } while (batchLen === 100)
  return all
}

async function getDocById(collectionName, id) {
  if (!id) return null
  try {
    const res = await db.collection(collectionName).doc(id).get()
    return res.data || null
  } catch (err) {
    return null
  }
}

function missingOrgId(value) {
  return value === undefined || value === null || value === ''
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
    return Number(input.seconds) * 1000
  }
  return 0
}

function toPeriodKey(input) {
  const ts = toTimestamp(input)
  if (!ts) return ''
  const d = new Date(ts + 8 * 60 * 60 * 1000)
  return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0')
}

function toDateKey(input) {
  const ts = toTimestamp(input)
  if (!ts) return ''
  const d = new Date(ts + 8 * 60 * 60 * 1000)
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0')
}

function getDeriveExtra(collectionName) {
  if (collectionName === 'WorkLogs') {
    return (doc) => ({ period_key: doc.period_key || toPeriodKey(doc.created_at || doc.date) })
  }
  if (collectionName === 'Attendances') {
    return (doc) => ({
      period_key: doc.period_key || toPeriodKey(doc.clock_in_time || doc.created_at || doc.date),
      date_key: doc.date_key || doc.date || toDateKey(doc.clock_in_time || doc.created_at)
    })
  }
  if (collectionName === 'SalaryAdjustments') {
    return (doc) => ({ period_key: doc.period_key || doc.month || toPeriodKey(doc.date || doc.created_at) })
  }
  if (collectionName === 'SalaryPayments') {
    return (doc) => ({ period_key: doc.period_key || doc.month || toPeriodKey(doc.paid_at || doc.created_at) })
  }
  return null
}

async function buildTenantLookups() {
  const [orders, users, processes] = await Promise.all([
    fetchAllDocs('Orders'),
    fetchAllDocs('Users'),
    fetchAllDocs('Processes')
  ])

  const orderOrgMap = {}
  orders.forEach((doc) => {
    if (doc && doc._id) orderOrgMap[doc._id] = doc.org_id || DEFAULT_HOME_ORG_ID
  })

  const userOrgMap = {}
  users.forEach((doc) => {
    if (doc && doc._id) userOrgMap[doc._id] = doc.org_id || DEFAULT_HOME_ORG_ID
  })

  const processOrgMap = {}
  processes.forEach((doc) => {
    if (!doc || !doc._id) return
    processOrgMap[doc._id] = doc.org_id || orderOrgMap[doc.order_id] || DEFAULT_HOME_ORG_ID
  })

  return { orderOrgMap, userOrgMap, processOrgMap }
}

function deriveLegacyOrgId(collectionName, doc, lookups) {
  if (!doc) return DEFAULT_HOME_ORG_ID
  if (!missingOrgId(doc.org_id)) return doc.org_id

  if (doc.order_id && lookups.orderOrgMap[doc.order_id]) return lookups.orderOrgMap[doc.order_id]
  if (doc.user_id && lookups.userOrgMap[doc.user_id]) return lookups.userOrgMap[doc.user_id]
  if (doc.employee_id && lookups.userOrgMap[doc.employee_id]) return lookups.userOrgMap[doc.employee_id]
  if (doc.process_id && lookups.processOrgMap[doc.process_id]) return lookups.processOrgMap[doc.process_id]

  if (collectionName === 'Users' && doc.platform_role === 'platform_admin') return DEFAULT_PLATFORM_ORG_ID
  return DEFAULT_HOME_ORG_ID
}

async function deriveLegacyOrgIdLive(collectionName, doc) {
  if (!doc) return DEFAULT_HOME_ORG_ID
  if (!missingOrgId(doc.org_id)) return doc.org_id

  if (doc.order_id) {
    const order = await getDocById('Orders', doc.order_id)
    if (order && !missingOrgId(order.org_id)) return order.org_id
  }

  const userId = doc.user_id || doc.employee_id
  if (userId) {
    const user = await getDocById('Users', userId)
    if (user && !missingOrgId(user.org_id)) return user.org_id
  }

  if (doc.process_id) {
    const process = await getDocById('Processes', doc.process_id)
    if (process) {
      if (!missingOrgId(process.org_id)) return process.org_id
      if (process.order_id) {
        const order = await getDocById('Orders', process.order_id)
        if (order && !missingOrgId(order.org_id)) return order.org_id
      }
    }
  }

  if (collectionName === 'Users' && doc.platform_role === 'platform_admin') return DEFAULT_PLATFORM_ORG_ID
  return DEFAULT_HOME_ORG_ID
}

async function migrateCollectionOrgId(collectionName, deriveExtra, lookups) {
  const docs = await fetchAllDocs(collectionName)
  let updated = 0
  let orgUpdated = 0
  for (const doc of docs) {
    const data = {}
    if (missingOrgId(doc.org_id)) {
      data.org_id = deriveLegacyOrgId(collectionName, doc, lookups)
      orgUpdated++
    }
    const extra = deriveExtra ? deriveExtra(doc) : null
    if (extra) {
      Object.keys(extra).forEach((key) => {
        if (missingOrgId(doc[key])) {
          data[key] = extra[key]
        }
      })
    }
    if (Object.keys(data).length > 0) {
      data.updated_at = db.serverDate()
      await db.collection(collectionName).doc(doc._id).update({ data })
      updated++
    }
  }
  return { collection: collectionName, total: docs.length, updated, org_updated: orgUpdated }
}

function getMigratableCollections() {
  return [
    'Users',
    'Orders',
    'Processes',
    'ProcessAssignments',
    'WorkLogs',
    'WorkLogAudit',
    'WorkLogEditAudit',
    'Attendances',
    'SalaryAdjustments',
    'SalaryPayments',
    'qr_codes',
    'audit_logs',
    'export_history',
    'sign_location_logs'
  ]
}

async function countMissingOrgDocs(collectionName) {
  const missingField = await db.collection(collectionName).where({ org_id: _.exists(false) }).count()
  const blankField = await db.collection(collectionName).where({ org_id: '' }).count()
  const nullField = await db.collection(collectionName).where({ org_id: null }).count()
  return (missingField.total || 0) + (blankField.total || 0) + (nullField.total || 0)
}

async function fetchMissingOrgDocs(collectionName, batchSize) {
  const queries = [
    { org_id: _.exists(false) },
    { org_id: '' },
    { org_id: null }
  ]

  for (const where of queries) {
    const res = await db.collection(collectionName).where(where).limit(batchSize).get()
    if (res.data && res.data.length > 0) return res.data
  }
  return []
}

async function migrateMissingOrgBatch(event) {
  await ensureHomeOrganization()

  const collectionName = String(event.collection || '')
  const collections = getMigratableCollections()
  if (!collections.includes(collectionName)) {
    return { code: -1, msg: '不支持的集合: ' + collectionName }
  }

  const batchSize = Math.max(1, Math.min(parseInt(event.batch_size || 20, 10) || 20, 30))
  const docs = await fetchMissingOrgDocs(collectionName, batchSize)
  const deriveExtra = getDeriveExtra(collectionName)
  let updated = 0
  let orgUpdated = 0

  for (const doc of docs) {
    const data = {}
    if (missingOrgId(doc.org_id)) {
      data.org_id = await deriveLegacyOrgIdLive(collectionName, doc)
      orgUpdated++
    }

    const extra = deriveExtra ? deriveExtra(doc) : null
    if (extra) {
      Object.keys(extra).forEach((key) => {
        if (missingOrgId(doc[key])) data[key] = extra[key]
      })
    }

    if (Object.keys(data).length > 0) {
      data.updated_at = db.serverDate()
      await db.collection(collectionName).doc(doc._id).update({ data })
      updated++
    }
  }

  const remaining = await countMissingOrgDocs(collectionName)
  return {
    code: 0,
    msg: `${collectionName} 批量迁移完成，本批更新 ${updated} 条，剩余 ${remaining} 条`,
    data: {
      collection: collectionName,
      selected: docs.length,
      updated,
      org_updated: orgUpdated,
      remaining,
      has_more: remaining > 0
    }
  }
}

async function migrateMultiTenant() {
  await ensureHomeOrganization()

  const results = []
  const lookups = await buildTenantLookups()
  const collections = [
    'Users',
    'Orders',
    'Processes',
    'ProcessAssignments',
    'WorkLogs',
    'WorkLogAudit',
    'WorkLogEditAudit',
    'Attendances',
    'SalaryAdjustments',
    'SalaryPayments',
    'qr_codes',
    'audit_logs',
    'export_history',
    'sign_location_logs'
  ]

  for (const name of collections) {
    try {
      const deriveExtra = getDeriveExtra(name)
      results.push(await migrateCollectionOrgId(name, deriveExtra, lookups))
    } catch (err) {
      results.push({ collection: name, status: '失败: ' + err.message })
    }
  }

  try {
    const mainSettings = await db.collection('factory_settings').doc('main').get()
    if (mainSettings.data) {
      const data = Object.assign({}, mainSettings.data, {
        org_id: DEFAULT_HOME_ORG_ID,
        updated_at: db.serverDate()
      })
      delete data._id
      await db.collection('factory_settings').doc(DEFAULT_HOME_ORG_ID).set({ data })
    }
  } catch (e) {}

  try {
    await db.collection('audit_logs').add({
      data: {
        org_id: DEFAULT_HOME_ORG_ID,
        operator_id: 'system',
        operator_name: '系统',
        action: 'migrate_multi_tenant',
        details: '历史数据补充 org_id / period_key',
        results,
        created_at: db.serverDate()
      }
    })
  } catch (e) {}

  return { code: 0, msg: '多工厂基础迁移完成', data: results }
}

// V2 迁移：为所有已有用户添加密码管理字段、更新设置字段
async function migrateV2() {
  const _ = db.command
  const results = []

  try {
    const tenantResult = await migrateMultiTenant()
    results.push({ step: '多工厂基础迁移', status: tenantResult.msg, details: tenantResult.data })
  } catch (err) {
    results.push({ step: '多工厂基础迁移', status: '失败: ' + err.message })
  }

  // 1. 为所有用户添加 password_changed / must_change_password / session_token 字段
  try {
    const allUsers = []
    let batchLen = 0
    do {
      var usersRes = await db.collection('Users').skip(allUsers.length).limit(200).get()
      batchLen = usersRes.data.length
      allUsers.push(...usersRes.data)
    } while (batchLen === 200)

    var updatedCount = 0
    for (var i = 0; i < allUsers.length; i++) {
      var user = allUsers[i]
      var updateData = {}
      var needUpdate = false

      if (user.password_changed === undefined) {
        updateData.password_changed = true // 旧用户视为已改过密码
        needUpdate = true
      }
      if (user.must_change_password === undefined) {
        updateData.must_change_password = false
        needUpdate = true
      }
      if (user.session_token === undefined) {
        updateData.session_token = ''
        needUpdate = true
      }

      if (needUpdate) {
        await db.collection('Users').doc(user._id).update({ data: updateData })
        updatedCount++
      }
    }
    results.push({ step: '用户字段迁移', status: '更新 ' + updatedCount + '/' + allUsers.length + ' 条' })
  } catch (err) {
    results.push({ step: '用户字段迁移', status: '失败: ' + err.message })
  }

  // 2. 工厂设置：qrcode_expire_hours → qrcode_expire_days
  try {
    var settingsRes = await db.collection('factory_settings').doc('main').get()
    var settings = settingsRes.data
    var settingsUpdate = {}
    var needSettingsUpdate = false

    if (settings.qrcode_expire_hours !== undefined && settings.qrcode_expire_days === undefined) {
      settingsUpdate.qrcode_expire_days = Math.round(settings.qrcode_expire_hours / 24) || 1
      needSettingsUpdate = true
    }
    if (settings.allow_home_checkin === undefined) {
      settingsUpdate.allow_home_checkin = false
      needSettingsUpdate = true
    }
    if (settings.face_recognition_enabled === undefined) {
      settingsUpdate.face_recognition_enabled = false
      needSettingsUpdate = true
    }
    if (settings.review_mode_enabled === undefined) {
      settingsUpdate.review_mode_enabled = true
      needSettingsUpdate = true
    }
    if (settings.review_mode_note === undefined) {
      settingsUpdate.review_mode_note = '审核模式可快速登录只读账号并体验核心流程'
      needSettingsUpdate = true
    }

    if (needSettingsUpdate) {
      await db.collection('factory_settings').doc('main').update({ data: settingsUpdate })
      results.push({ step: '设置迁移', status: '更新成功' })
    } else {
      results.push({ step: '设置迁移', status: '无需更新' })
    }
  } catch (err) {
    results.push({ step: '设置迁移', status: '失败: ' + err.message })
  }

  // 3. 审计日志
  try {
    await db.collection('audit_logs').add({
      data: {
        operator_id: 'system',
        operator_name: '系统',
        action: 'migrate_v2',
        details: 'V2版本数据库迁移',
        results: results,
        created_at: db.serverDate()
      }
    })
  } catch (err) {
    // ignore
  }

  return { code: 0, msg: 'V2迁移完成', data: results }
}
