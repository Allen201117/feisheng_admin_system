// 云函数 - init (数据库初始化)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const crypto = require('crypto')
const { migrateLocationData } = require('./migrate-location')
const { migrateTimezoneData } = require('./migrate-timezone')

// 需要创建的集合列表
const COLLECTIONS = [
  'Users',
  'Orders',
  'Processes',
  'WorkLogs',
  'Attendances',
  'SalaryAdjustments',
  'SalaryPayments',
  'factory_settings',
  'audit_logs',
  'qr_codes',
  'export_history',
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

  // 2. 初始化工厂设置（仅在不存在时创建，不覆盖已有设置）
  try {
    let existingSettings = null
    try {
      const existRes = await db.collection('factory_settings').doc('main').get()
      existingSettings = existRes.data
    } catch (e) {}

    if (!existingSettings) {
      await db.collection('factory_settings').doc('main').set({
        data: {
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

  // 3. 创建默认管理员账号（如果不存在）
  try {
    const adminPhone = event.admin_phone || ''
    const adminName = event.admin_name || '管理员'
    if (!adminPhone) {
      results.push({ item: '默认管理员', status: '跳过（未提供 admin_phone 参数）' })
    } else {
      const existing = await db.collection('Users').where({ phone: adminPhone }).get()
      if (!existing.data || existing.data.length === 0) {
        const salt = crypto.randomBytes(16).toString('hex')
        const password_hash = crypto.createHash('sha256').update(adminPhone + salt).digest('hex')

        await db.collection('Users').add({
          data: {
            name: adminName,
            phone: adminPhone,
            role: 'boss',
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

  // 4. 记录初始化日志
  try {
    await db.collection('audit_logs').add({
      data: {
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

// V2 迁移：为所有已有用户添加密码管理字段、更新设置字段
async function migrateV2() {
  const _ = db.command
  const results = []

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
