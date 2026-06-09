// 云函数 - settings (工厂设置)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const { buildStrictAuthWhere } = require('./auth.logic')
const { sanitizeSettingsRecord, normalizeCheckpoints } = require('./settings.logic')

async function getCallerUserByEvent(event) {
  const strictWhere = buildStrictAuthWhere(event)
  if (!strictWhere) return null

  try {
    const res = await db.collection('Users').where(strictWhere).limit(1).get()
    if (res.data.length === 0) return null
    const user = res.data[0]
    if (user.org_id) {
      try {
        const orgRes = await db.collection('Organizations').doc(user.org_id).get()
        if (!orgRes.data || orgRes.data.status !== 'active') return null
      } catch (e) {
        return null
      }
    }
    return user
  } catch (err) {
    return null
  }
}

function getOrgId(user) {
  return user && user.org_id ? user.org_id : ''
}

async function getBossUserByEvent(event) {
  const caller = await getCallerUserByEvent(event)
  if (!caller || caller.role !== 'boss') return null
  return caller
}

exports.main = async function(event, context) {
  var action = event.action
  switch (action) {
    case 'getAll': return await getAll(event)
    case 'getPublic': return await getPublic(event)
    case 'save': return await save(event)
    default: return { code: -1, msg: '未知操作' }
  }
}

async function getAll(event) {
  const caller = await getBossUserByEvent(event)
  if (!caller) {
    return { code: -1, msg: '权限不足，仅管理员可查看设置' }
  }

  try {
    var res = await db.collection('factory_settings').doc(getOrgId(caller)).get()
    return { code: 0, data: sanitizeSettingsRecord(res.data) }
  } catch (err) {
    return { code: -1, msg: '加载设置失败' }
  }
}

/** 公开设置接口 — 不需要boss权限，只返回非敏感字段 */
async function getPublic(event) {
  const caller = await getCallerUserByEvent(event)
  const orgId = getOrgId(caller)
  try {
    var res = await db.collection('factory_settings').doc(orgId || 'main').get()
    var data = res.data || {}
    return {
      code: 0,
      data: {
        leaderboard_visible: !!data.leaderboard_visible,
        salary_payroll_mode: data.salary_payroll_mode === 'order' ? 'order' : 'monthly'
      }
    }
  } catch (err) {
    return { code: 0, data: { leaderboard_visible: false, salary_payroll_mode: 'monthly' } }
  }
}

async function save(event) {
  var caller = await getBossUserByEvent(event)
  if (!caller) {
    return { code: -1, msg: '权限不足，仅管理员可修改设置' }
  }

  var existing = {}
  try {
    var ex = await db.collection('factory_settings').doc(getOrgId(caller)).get()
    existing = ex.data || {}
  } catch (e) {}

  function resolveCoordinate(inputValue, existingValue, label) {
    if (inputValue === undefined || inputValue === null || inputValue === '') {
      if (typeof existingValue === 'number' && Number.isFinite(existingValue)) {
        return { ok: true, value: existingValue }
      }
      return { ok: false, msg: label + '不能为空' }
    }

    var parsed = Number(inputValue)
    if (!Number.isFinite(parsed)) {
      return { ok: false, msg: label + '格式无效' }
    }

    if (label === '纬度' && (parsed < -90 || parsed > 90 || parsed === 0)) {
      return { ok: false, msg: '纬度范围无效，请重新获取工厂位置' }
    }

    if (label === '经度' && (parsed < -180 || parsed > 180 || parsed === 0)) {
      return { ok: false, msg: '经度范围无效，请重新获取工厂位置' }
    }

    return { ok: true, value: parsed }
  }

  var latitudeResult = resolveCoordinate(event.factory_latitude, existing.factory_latitude, '纬度')
  if (!latitudeResult.ok) {
    return { code: -1, msg: latitudeResult.msg }
  }

  var longitudeResult = resolveCoordinate(event.factory_longitude, existing.factory_longitude, '经度')
  if (!longitudeResult.ok) {
    return { code: -1, msg: longitudeResult.msg }
  }

  var nextFactoryLatitude = latitudeResult.value
  var nextFactoryLongitude = longitudeResult.value
  var normalizedCheckpoints = normalizeCheckpoints({
    factory_latitude: nextFactoryLatitude,
    factory_longitude: nextFactoryLongitude,
    geofence_radius: parseInt(event.geofence_radius) || 100,
    checkpoints: event.checkpoints || []
  })

  if (normalizedCheckpoints.length > 0) {
    nextFactoryLatitude = normalizedCheckpoints[0].latitude
    nextFactoryLongitude = normalizedCheckpoints[0].longitude
  }

  var settingsData = {
    org_id: getOrgId(caller),
    factory_latitude: nextFactoryLatitude,
    factory_longitude: nextFactoryLongitude,
    geofence_radius: parseInt(event.geofence_radius) || 100,
    checkpoints: normalizedCheckpoints,
    quality_threshold: parseInt(event.quality_threshold) || 95,
    export_email: event.export_email || existing.export_email || '',
    qrcode_expire_days: parseInt(event.qrcode_expire_days) || 1,
    face_recognition_enabled: !!event.face_recognition_enabled,
    allow_home_checkin: !!event.allow_home_checkin,
    leaderboard_visible: !!event.leaderboard_visible,
    salary_payroll_mode: event.salary_payroll_mode === 'order' ? 'order' : 'monthly',
    smtp_host: event.smtp_host || '',
    smtp_port: event.smtp_port || '465',
    smtp_user: event.smtp_user || '',
    smtp_pass: event.smtp_pass || '',
    // 坐标元数据
    coordinate_system: event.coordinate_system || existing.coordinate_system || 'gcj02',
    location_source: event.location_source || existing.location_source || 'unknown',
    location_confirmed: true,
    location_updated_by: caller._id,
    location_updated_by_name: caller.name,
    location_updated_at: db.serverDate(),
    // 保留旧坐标用于迁移对比（如果坐标发生变化）
    ...(existing.factory_latitude !== undefined &&
      (nextFactoryLatitude !== existing.factory_latitude ||
       nextFactoryLongitude !== existing.factory_longitude)
      ? { prev_factory_latitude: existing.factory_latitude, prev_factory_longitude: existing.factory_longitude }
      : {}),
    review_mode_enabled: existing.review_mode_enabled !== false,
    review_mode_note: existing.review_mode_note || '审核模式可快速登录只读账号并体验核心流程',
    review_user_phone: existing.review_user_phone || '',
    review_user_name: existing.review_user_name || '',
    updated_at: db.serverDate()
  }

  try {
    await db.collection('factory_settings').doc(getOrgId(caller)).set({ data: settingsData })

    await db.collection('audit_logs').add({
      data: {
        org_id: getOrgId(caller),
        operator_id: caller._id,
        operator_name: caller.name,
        action: 'update_settings',
        details: '更新工厂设置',
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '设置保存成功' }
  } catch (err) {
    return { code: -1, msg: '保存失败' }
  }
}
