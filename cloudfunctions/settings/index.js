// 云函数 - settings (工厂设置)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function getCallerUser(wxContext) {
  var res = await db.collection('Users').where({
    openid: wxContext.OPENID, status: 'active'
  }).get()
  return res.data.length > 0 ? res.data[0] : null
}

exports.main = async function(event, context) {
  var wxContext = cloud.getWXContext()
  var action = event.action
  switch (action) {
    case 'getAll': return await getAll()
    case 'save': return await save(event, wxContext)
    default: return { code: -1, msg: '未知操作' }
  }
}

async function getAll() {
  try {
    var res = await db.collection('factory_settings').doc('main').get()
    var data = res.data
    // 兼容：如果存在旧的 qrcode_expire_hours，转换为天
    if (data.qrcode_expire_hours && !data.qrcode_expire_days) {
      data.qrcode_expire_days = Math.round(data.qrcode_expire_hours / 24) || 1
    }
    if (!data.qrcode_expire_days) data.qrcode_expire_days = 1
    if (data.face_recognition_enabled === undefined) data.face_recognition_enabled = false
    if (data.allow_home_checkin === undefined) data.allow_home_checkin = false
    return { code: 0, data: data }
  } catch (err) {
    return {
      code: 0,
      data: {
        factory_latitude: 39.9042,
        factory_longitude: 116.4074,
        geofence_radius: 100,
        quality_threshold: 95,
        export_email: 'hanyifan424@gmail.com',
        qrcode_expire_days: 1,
        face_recognition_enabled: false,
        allow_home_checkin: false,
        smtp_host: '',
        smtp_port: '465',
        smtp_user: '',
        smtp_pass: ''
      }
    }
  }
}

async function save(event, wxContext) {
  var caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足，仅管理员可修改设置' }
  }

  var existing = {}
  try {
    var ex = await db.collection('factory_settings').doc('main').get()
    existing = ex.data || {}
  } catch (e) {}

  var settingsData = {
    factory_latitude: parseFloat(event.factory_latitude) || 39.9042,
    factory_longitude: parseFloat(event.factory_longitude) || 116.4074,
    geofence_radius: parseInt(event.geofence_radius) || 100,
    quality_threshold: parseInt(event.quality_threshold) || 95,
    export_email: event.export_email || 'hanyifan424@gmail.com',
    qrcode_expire_days: parseInt(event.qrcode_expire_days) || 1,
    face_recognition_enabled: !!event.face_recognition_enabled,
    allow_home_checkin: !!event.allow_home_checkin,
    smtp_host: event.smtp_host || '',
    smtp_port: event.smtp_port || '465',
    smtp_user: event.smtp_user || '',
    smtp_pass: event.smtp_pass || '',
    review_mode_enabled: existing.review_mode_enabled !== false,
    review_mode_note: existing.review_mode_note || '审核模式可快速登录只读账号并体验核心流程',
    review_user_phone: existing.review_user_phone || '',
    review_user_name: existing.review_user_name || '',
    updated_at: db.serverDate()
  }

  try {
    await db.collection('factory_settings').doc('main').set({ data: settingsData })

    await db.collection('audit_logs').add({
      data: {
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
