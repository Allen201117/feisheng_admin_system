// 云函数 - attendance (考勤管理) — 已重构为北京时间 + 增强定位判定
const cloud = require('wx-server-sdk')
const { comprehensiveCheckIn, buildCheckInLog } = require('./geofence-enhanced')
const { normalizeFactorySettings } = require('./factory-settings.logic')
const bjTime = require('./beijing-time')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

// 坐标合法性校验
function isValidCoordinate(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
}

// 写入签到定位诊断日志
async function writeLocationLog(data) {
  try {
    await db.collection('sign_location_logs').add({
      data: {
        ...data,
        created_at: db.serverDate()
      }
    })
  } catch (e) {
    console.error('写入定位日志失败', e)
  }
}

async function writeAudit(action, details, orgId) {
  try {
    await db.collection('audit_logs').add({
      data: {
        org_id: orgId || '',
        action,
        details,
        created_at: db.serverDate()
      }
    })
  } catch (e) {}
}

async function validateQrToken(qrId, orgId) {
  if (!qrId) return { ok: false, msg: '缺少二维码标识' }
  const qrRes = await db.collection('qr_codes').where({ org_id: orgId, token: qrId }).limit(1).get()
  if (!qrRes.data.length) return { ok: false, msg: '二维码不存在' }

  const qr = qrRes.data[0]
  if (qr.status !== 'active') return { ok: false, msg: '二维码已作废' }
  const expireAt = new Date(qr.expire_at)
  if (new Date() > expireAt) return { ok: false, msg: '二维码已过期' }

  return {
    ok: true,
    qr
  }
}

// Haversine 距离计算（米）
function getDateStr(date) {
  // 始终返回北京时间日期字符串
  if (date) return bjTime.formatBeijingDate(date)
  return bjTime.getBeijingToday()
}

function getPeriodRange(dimension, periodValue) {
  if (dimension === 'year') {
    return bjTime.getBeijingYearRange(periodValue)
  }
  var month = periodValue || bjTime.getBeijingMonth()
  return bjTime.getBeijingMonthRange(month)
}

function formatTimeStr(date) {
  return bjTime.formatBeijingTimeShort(date)
}

// 获取工厂设置
async function getFactorySettings(orgId) {
  try {
    let res = null
    try {
      res = await db.collection('factory_settings').doc(orgId).get()
    } catch (e) {}
    if (!res || !res.data) {
      res = await db.collection('factory_settings').doc('main').get()
    }
    return normalizeFactorySettings(res.data || null)
  } catch (e) {
    return { ok: false, msg: '工厂位置加载失败，请联系管理员重新检查工厂设置' }
  }
}

// 鉴权
async function getCallerUser(wxContext) {
  const res = await db.collection('Users').where({
    openid: wxContext.OPENID,
    status: 'active'
  }).get()
  return res.data.length > 0 ? res.data[0] : null
}

async function getCallerUserByEvent(event, wxContext) {
  const authUserId = event && event.auth_user_id
  const authSessionToken = event && event.auth_session_token

  if (authUserId && authSessionToken) {
    try {
      const exactRes = await db.collection('Users').where({
        _id: authUserId,
        session_token: authSessionToken,
        status: 'active'
      }).limit(1).get()
      if (exactRes.data.length > 0) {
        const user = exactRes.data[0]
        if (user.org_id) {
          try {
            const orgRes = await db.collection('Organizations').doc(user.org_id).get()
            if (!orgRes.data || orgRes.data.status !== 'active') return null
          } catch (e) {
            return null
          }
        }
        return user
      }
    } catch (err) {}
  }

  const fallbackUser = await getCallerUser(wxContext)
  if (!fallbackUser) return null
  if (!authUserId) return fallbackUser
  if (String(fallbackUser._id) === String(authUserId)) return fallbackUser

  return null
}

function getOrgId(user) {
  return user && user.org_id ? user.org_id : ''
}

function ensureSameOrg(doc, caller) {
  return !!(doc && caller && getOrgId(caller) && doc.org_id === getOrgId(caller))
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

function getSortableTime(doc, fields) {
  for (const field of fields) {
    const ts = toTimestamp(doc && doc[field])
    if (ts) return ts
  }
  return 0
}

function sortDocsByFields(list, fields, direction) {
  const multiplier = direction === 'asc' ? 1 : -1
  return (list || []).slice().sort((a, b) => {
    const diff = getSortableTime(a, fields) - getSortableTime(b, fields)
    if (diff !== 0) return diff * multiplier
    return String(a._id || '').localeCompare(String(b._id || '')) * multiplier
  })
}

async function fetchAllDocs(collectionName, where, pageSize = 100) {
  const all = []
  let batchLen = 0
  do {
    const res = await db.collection(collectionName)
      .where(where)
      .skip(all.length)
      .limit(pageSize)
      .get()
    batchLen = (res.data || []).length
    all.push(...(res.data || []))
  } while (batchLen === pageSize)
  return all
}

async function requireAttendanceActor(event, wxContext, targetUserId) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) {
    return { ok: false, response: { code: -1, msg: '登录已失效，请重新登录' } }
  }

  if (caller.role === 'boss') {
    if (targetUserId && String(targetUserId) !== String(caller._id)) {
      const targetRes = await db.collection('Users').doc(targetUserId).get()
      if (!ensureSameOrg(targetRes.data, caller)) {
        return { ok: false, response: { code: -1, msg: '无权操作其他工厂员工的考勤数据' } }
      }
    }
    return { ok: true, caller, actorUserId: targetUserId || caller._id }
  }

  const actorUserId = targetUserId || caller._id
  if (String(actorUserId) !== String(caller._id)) {
    return { ok: false, response: { code: -1, msg: '无权操作其他员工的考勤数据' } }
  }

  return { ok: true, caller, actorUserId: caller._id }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  switch (action) {
    case 'clockIn': return await clockIn(event, wxContext)
    case 'clockOut': return await clockOut(event, wxContext)
    case 'getTodayRecord': return await getTodayRecord(event)
    case 'getMonthlyHours': return await getMonthlyHours(event)
    case 'getDailyRecords': return await getDailyRecords(event, wxContext)
    case 'getPeriodRecords': return await getPeriodRecords(event, wxContext)
    case 'getAbnormalRecords': return await getAbnormalRecords(event, wxContext)
    case 'supplement': return await supplement(event, wxContext)
    case 'getUserMonthlyRecords': return await getUserMonthlyRecords(event)
    case 'checkAbnormal': return await checkAbnormalAttendances()
    default: return { code: -1, msg: '未知操作' }
  }
}

async function clockIn(event, wxContext) {
  const auth = await requireAttendanceActor(event, wxContext, event.user_id)
  if (!auth.ok) return auth.response

  const user_id = auth.actorUserId
  const orgId = getOrgId(auth.caller)
  const { latitude, longitude, source, qr_id, accuracy, location_timestamp, device_info, raw_samples } = event
  const today = getDateStr(new Date())
  const settings = await getFactorySettings(orgId)

  if (!settings.ok) {
    await writeLocationLog({
      user_id,
      org_id: orgId,
      action: 'clock_in',
      location_status: 'invalid_factory_config',
      fail_reason: settings.msg,
      accuracy: Number(accuracy) || -1,
      device_info: device_info || '',
      raw_payload: JSON.stringify(raw_samples || {})
    })
    return { code: -1, msg: settings.msg }
  }

  const lat = Number(latitude)
  const lng = Number(longitude)
  const factoryLat = Number(settings.data.factory_latitude)
  const factoryLng = Number(settings.data.factory_longitude)
  const radius = Number(settings.data.geofence_radius) || 100

  // 坐标合法性校验
  if (!isValidCoordinate(lat, lng)) {
    await writeLocationLog({
      org_id: orgId, user_id, action: 'clock_in', location_status: 'invalid_employee_coord',
      latitude_gcj02: lat, longitude_gcj02: lng,
      factory_latitude_gcj02: factoryLat, factory_longitude_gcj02: factoryLng,
      fail_reason: '员工坐标无效', accuracy: accuracy || -1,
      device_info: device_info || '', raw_payload: JSON.stringify(raw_samples || {})
    })
    return { code: -1, msg: '定位失败，无法获取有效坐标，请检查定位权限' }
  }

  if (!isValidCoordinate(factoryLat, factoryLng)) {
    await writeLocationLog({
      org_id: orgId, user_id, action: 'clock_in', location_status: 'invalid_factory_coord',
      latitude_gcj02: lat, longitude_gcj02: lng,
      factory_latitude_gcj02: factoryLat, factory_longitude_gcj02: factoryLng,
      fail_reason: '工厂坐标未设置', accuracy: accuracy || -1
    })
    return { code: -1, msg: '工厂位置未设置，请联系管理员在设置中配置工厂位置' }
  }

  if (source === 'qrcode') {
    const qrCheck = await validateQrToken(qr_id, orgId)
    if (!qrCheck.ok) {
      await writeAudit('clock_in_failed', `user_id=${user_id}; source=qrcode; reason=${qrCheck.msg}`, orgId)
      return { code: -1, msg: qrCheck.msg }
    }
  }

  // 构建多打卡点配置（目前兼容单点，后续可从 factory_settings 读取 checkpoints 数组）
  const checkpoints = settings.data.checkpoints || [{
    name: '工厂',
    latitude: factoryLat,
    longitude: factoryLng,
    radius: radius
  }]

  // 使用增强版综合打卡判定
  const accVal = Number(accuracy) || -1
  const checkResult = comprehensiveCheckIn({
    latitude: lat,
    longitude: lng,
    accuracy: accVal,
    allSamples: raw_samples || [],
    checkpoints: checkpoints,
    factoryLatitude: factoryLat,
    factoryLongitude: factoryLng,
    radius: radius,
    wifiBSSID: event.wifi_bssid || '',
    allowedBSSIDs: settings.data.allowed_wifi_bssids || []
  })

  // 构建完整判定日志
  const checkLog = buildCheckInLog({
    latitude: lat,
    longitude: lng,
    accuracy: accVal,
    allSamples: raw_samples || [],
    wifiBSSID: event.wifi_bssid || ''
  }, checkResult)

  const distance = (checkResult.geofenceResult && checkResult.geofenceResult.nearestCheckpoint)
    ? checkResult.geofenceResult.nearestCheckpoint.distance : 0
  const roundedDistance = Math.round(distance)

  // 写入诊断日志（无论成功失败都写，含增强判定信息）
  const logData = {
    org_id: orgId,
    user_id,
    action: 'clock_in',
    latitude_gcj02: lat,
    longitude_gcj02: lng,
    accuracy: accVal,
    location_time: location_timestamp || '',
    factory_latitude_gcj02: factoryLat,
    factory_longitude_gcj02: factoryLng,
    distance_meters: roundedDistance,
    sign_radius_meters: radius,
    device_info: device_info || '',
    source: source || 'normal',
    raw_payload: JSON.stringify(raw_samples || {}),
    // 增强判定字段
    check_status: checkResult.status,
    check_reason: checkResult.reason,
    check_confidence: checkResult.confidence,
    quality_score: checkLog.quality_score,
    quality_level: checkLog.quality_level,
    wifi_matched: checkLog.wifi_matched,
    check_signals: checkLog.check_signals
  }

  // 根据判定结果处理
  if (checkResult.status === 'rejected') {
    logData.location_status = 'out_of_geofence'
    logData.fail_reason = checkResult.reason
    await writeLocationLog(logData)
    await writeAudit('clock_in_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=out_of_geofence; distance=${roundedDistance}m; accuracy=${accVal}m; quality=${checkLog.quality_level}`, orgId)
    let failMsg = checkResult.reason
    if (checkResult.suggestion) failMsg += '\n\n' + checkResult.suggestion
    return { code: -1, msg: failMsg }
  }

  if (checkResult.status === 'retry') {
    logData.location_status = 'retry_suggested'
    logData.fail_reason = checkResult.reason
    await writeLocationLog(logData)
    await writeAudit('clock_in_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=retry_suggested; distance=${roundedDistance}m; accuracy=${accVal}m; quality=${checkLog.quality_level}`, orgId)
    return { code: -2, msg: checkResult.suggestion || checkResult.reason, data: { retry: true } }
  }

  // 检查是否有未签退的记录（允许多次签到/签退）
  const existing = await db.collection('Attendances').where({
    org_id: orgId, user_id, date: today
  }).orderBy('created_at', 'desc').get()

  const openRecord = (existing.data || []).find(item => item.clock_in_time && !item.clock_out_time)
  if (openRecord) {
    await writeAudit('clock_in_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=open_record_exists`, orgId)
    return { code: -1, msg: '请先签退当前记录后再签到' }
  }

  // 获取用户名
  const userRes = await db.collection('Users').doc(user_id).get()
  if (!ensureSameOrg(userRes.data, auth.caller)) {
    return { code: -1, msg: '无权操作其他工厂员工的考勤数据' }
  }
  const userName = userRes.data ? userRes.data.name : ''

  const now = new Date()
  const isReview = checkResult.status === 'review'
  try {
    await db.collection('Attendances').add({
      data: {
        org_id: orgId,
        user_id,
        user_name: userName,
        date: today,
        date_key: today,
        period_key: today.substring(0, 7),
        clock_in_time: now.toISOString(),
        clock_in_location: { latitude: lat, longitude: lng, accuracy: accVal, coordinate_system: 'gcj02' },
        clock_out_time: null,
        clock_out_location: {},
        status: isReview ? 'pending_review' : 'normal',
        source: source || 'normal',
        qr_id: source === 'qrcode' ? qr_id : '',
        distance_meters: roundedDistance,
        hours: 0,
        // 增强判定元数据
        check_confidence: checkResult.confidence,
        quality_score: checkLog.quality_score,
        quality_level: checkLog.quality_level,
        wifi_matched: checkLog.wifi_matched,
        created_at: db.serverDate()
      }
    })
    logData.location_status = 'success'
    logData.fail_reason = ''
    await writeLocationLog(logData)
    await writeAudit('clock_in_success', `user_id=${user_id}; source=${source || 'normal'}; distance=${roundedDistance}m; accuracy=${accVal}m; quality=${checkLog.quality_level}; confidence=${checkResult.confidence}`, orgId)
    return { code: 0, msg: '签到成功', data: { clock_in_time: now.toISOString(), distance: roundedDistance, quality: checkLog.quality_level } }
  } catch (err) {
    await writeAudit('clock_in_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=db_error`, orgId)
    return { code: -1, msg: '签到失败' }
  }
}

async function clockOut(event, wxContext) {
  const auth = await requireAttendanceActor(event, wxContext, event.user_id)
  if (!auth.ok) return auth.response

  const user_id = auth.actorUserId
  const orgId = getOrgId(auth.caller)
  const { latitude, longitude, source, accuracy, location_timestamp, device_info } = event
  const today = getDateStr()
  const settings = await getFactorySettings(orgId)

  if (!settings.ok) {
    return { code: -1, msg: settings.msg }
  }

  const lat = Number(latitude)
  const lng = Number(longitude)
  const factoryLat = Number(settings.data.factory_latitude)
  const factoryLng = Number(settings.data.factory_longitude)
  const radius = Number(settings.data.geofence_radius) || 100
  const accVal = Number(accuracy) || -1

  // 使用 v2 容差式围栏判定（与签到一致）
  const checkpoints = settings.data.checkpoints || [{
    name: '工厂',
    latitude: factoryLat,
    longitude: factoryLng,
    radius: radius
  }]

  const checkResult = comprehensiveCheckIn({
    latitude: lat,
    longitude: lng,
    accuracy: accVal,
    allSamples: event.raw_samples || [],
    checkpoints: checkpoints,
    factoryLatitude: factoryLat,
    factoryLongitude: factoryLng,
    radius: radius,
    wifiBSSID: event.wifi_bssid || '',
    allowedBSSIDs: settings.data.allowed_wifi_bssids || []
  })

  const distance = (checkResult.geofenceResult && checkResult.geofenceResult.nearestCheckpoint)
    ? checkResult.geofenceResult.nearestCheckpoint.distance : 0
  const roundedDistance = Math.round(distance)

  // 与签到一致：围栏外直接拦截
  if (checkResult.status === 'rejected') {
    await writeLocationLog({
      org_id: orgId, user_id, action: 'clock_out',
      latitude_gcj02: lat, longitude_gcj02: lng, accuracy: accVal,
      location_time: location_timestamp || '',
      factory_latitude_gcj02: factoryLat, factory_longitude_gcj02: factoryLng,
      distance_meters: roundedDistance, sign_radius_meters: radius,
      device_info: device_info || '', source: source || 'normal',
      location_status: 'out_of_geofence',
      fail_reason: checkResult.reason
    })
    await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=out_of_geofence; distance=${roundedDistance}m; accuracy=${accVal}m`, orgId)
    let failMsg = checkResult.reason
    if (checkResult.suggestion) failMsg += '\n\n' + checkResult.suggestion
    return { code: -1, msg: failMsg }
  }

  if (checkResult.status === 'retry') {
    await writeLocationLog({
      org_id: orgId, user_id, action: 'clock_out',
      latitude_gcj02: lat, longitude_gcj02: lng, accuracy: accVal,
      location_time: location_timestamp || '',
      factory_latitude_gcj02: factoryLat, factory_longitude_gcj02: factoryLng,
      distance_meters: roundedDistance, sign_radius_meters: radius,
      device_info: device_info || '', source: source || 'normal',
      location_status: 'retry_suggested',
      fail_reason: checkResult.reason
    })
    await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=retry_suggested; distance=${roundedDistance}m; accuracy=${accVal}m`, orgId)
    return { code: -2, msg: checkResult.suggestion || checkResult.reason, data: { retry: true } }
  }

  // 查找今日签到记录
  const existing = await db.collection('Attendances').where({
    org_id: orgId, user_id, date: today
  }).orderBy('created_at', 'desc').get()

  const records = existing.data || []

  if (records.length === 0) {
    await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=no_record_today`, orgId)
    return { code: -1, msg: '请先签到（今日无任何考勤记录）' }
  }

  let openRecord = records.find(item => item.clock_in_time && !item.clock_out_time)

  // 兜底：如果当天没有可签退记录，尝试签退最近一条"未签退"记录（跨日加班场景）
  if (!openRecord) {
    const latestOpen = await db.collection('Attendances').where({
      org_id: orgId,
      user_id,
      clock_in_time: _.neq(null),
      clock_out_time: _.eq(null)
    }).orderBy('created_at', 'desc').limit(1).get()

    if (latestOpen.data && latestOpen.data.length > 0) {
      openRecord = latestOpen.data[0]
    }
  }

  if (!openRecord) {
    const hasClockIn = records.some(item => !!item.clock_in_time)
    if (hasClockIn) {
      await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=already_clocked_out`, orgId)
      return { code: -1, msg: '今日已签退（所有记录均已有签退时间）' }
    }
    await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=no_clock_in`, orgId)
    return { code: -1, msg: '请先签到（无签到时间）' }
  }

  if (openRecord.clock_out_time) {
    await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=already_clocked_out`, orgId)
    return { code: -1, msg: '今日已签退' }
  }

  const record = openRecord
  const now = new Date()
  const clockInTime = new Date(record.clock_in_time)
  const hours = Math.round((now - clockInTime) / (1000 * 60 * 60) * 100) / 100

  if (hours < 0) {
    await writeAudit('clock_out_failed', `user_id=${user_id}; reason=negative_hours; hours=${hours}`, orgId)
    return { code: -1, msg: '签退时间早于签到时间，无法签退' }
  }

  try {
    await db.collection('Attendances').doc(record._id).update({
      data: {
        clock_out_time: now.toISOString(),
        clock_out_location: _.set({ latitude: lat, longitude: lng, accuracy: accVal, coordinate_system: 'gcj02' }),
        hours: hours,
        distance_meters_out: roundedDistance,
        status: 'normal',
        abnormal_reason: ''
      }
    })

    // 写入诊断日志
    await writeLocationLog({
      org_id: orgId, user_id, action: 'clock_out',
      latitude_gcj02: lat, longitude_gcj02: lng, accuracy: accVal,
      location_time: location_timestamp || '',
      factory_latitude_gcj02: factoryLat, factory_longitude_gcj02: factoryLng,
      distance_meters: roundedDistance, sign_radius_meters: radius,
      device_info: device_info || '', source: source || 'normal',
      location_status: 'success',
      fail_reason: ''
    })

    // 更新用户月工时
    await updateMonthlyHours(user_id, orgId)
    await writeAudit('clock_out_success', `user_id=${user_id}; source=${source || 'normal'}; distance=${roundedDistance}m`, orgId)

    return {
      code: 0,
      msg: '签退成功',
      data: { clock_out_time: now.toISOString(), hours, distance: roundedDistance }
    }
  } catch (err) {
    await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=db_error`, orgId)
    return { code: -1, msg: '签退失败：' + (err.message || JSON.stringify(err)) }
  }
}

async function getTodayRecord(event) {
  const wxContext = cloud.getWXContext()
  const auth = await requireAttendanceActor(event, wxContext, event.user_id)
  if (!auth.ok) return auth.response

  const user_id = auth.actorUserId
  const orgId = getOrgId(auth.caller)
  const { date } = event
  const today = date || getDateStr(new Date())

  try {
    const res = await db.collection('Attendances').where({
      org_id: orgId, user_id, date: today
    }).orderBy('created_at', 'desc').get()

    const records = res.data || []
    if (records.length === 0) {
      return { code: 0, data: null }
    }

    const openRecord = records.find(item => item.clock_in_time && !item.clock_out_time)
    const latestRecord = records[0] // already sorted desc by created_at

    // Calculate total hours across all today's sessions
    let totalHoursToday = 0
    let sessionCount = 0
    for (const r of records) {
      if (r.clock_in_time && r.clock_out_time) {
        totalHoursToday += r.hours || 0
        sessionCount++
      }
    }
    totalHoursToday = Math.round(totalHoursToday * 100) / 100

    return {
      code: 0,
      data: {
        // Backward-compatible fields (from latest record)
        ...latestRecord,
        clock_in_time: latestRecord.clock_in_time,
        clock_out_time: latestRecord.clock_out_time,
        // New summary fields
        total_hours_today: totalHoursToday,
        session_count: sessionCount,
        has_open_session: !!openRecord
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取记录失败' }
  }
}

async function getMonthlyHours(event) {
  const wxContext = cloud.getWXContext()
  const auth = await requireAttendanceActor(event, wxContext, event.user_id)
  if (!auth.ok) return auth.response

  const user_id = auth.actorUserId
  const orgId = getOrgId(auth.caller)
  const range = bjTime.getBeijingMonthRange()

  try {
    let allRecords = []
    let batchLen = 0
    do {
      const res = await db.collection('Attendances').where({
        org_id: orgId,
        user_id,
        date: _.gte(range.startDate).and(_.lt(range.endDate))
      }).skip(allRecords.length).limit(100).get()
      batchLen = (res.data || []).length
      allRecords = allRecords.concat(res.data || [])
    } while (batchLen === 100)

    let totalHours = 0
    allRecords.forEach(r => { totalHours += r.hours || 0 })

    return { code: 0, data: { hours: Math.round(totalHours * 10) / 10 } }
  } catch (err) {
    return { code: -1, msg: '获取工时失败' }
  }
}

async function updateMonthlyHours(userId, orgId) {
  const range = bjTime.getBeijingMonthRange()

  let allRecords = []
  let batchLen = 0
  do {
    const res = await db.collection('Attendances').where({
      org_id: orgId,
      user_id: userId,
      date: _.gte(range.startDate).and(_.lt(range.endDate))
    }).skip(allRecords.length).limit(100).get()
    batchLen = (res.data || []).length
    allRecords = allRecords.concat(res.data || [])
  } while (batchLen === 100)

  let totalHours = 0
  allRecords.forEach(r => { totalHours += r.hours || 0 })

  await db.collection('Users').doc(userId).update({
    data: { monthly_hours: Math.round(totalHours * 10) / 10 }
  })
}

async function getPeriodRecords(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }
  const orgId = getOrgId(caller)

  const dimension = event.dimension === 'year' ? 'year' : 'month'
  const periodValue = dimension === 'year' ? event.year : event.month
  const range = getPeriodRange(dimension, periodValue)

  try {
    const allRecords = sortDocsByFields(await fetchAllDocs('Attendances', {
        org_id: orgId,
        date: _.gte(range.startDate).and(_.lt(range.endDate))
      }), ['date', 'clock_in_time', 'created_at'], 'desc')

    const records = allRecords.map(r => ({
      ...r,
      clock_in_display: r.clock_in_time ? formatTimeStr(r.clock_in_time) : null,
      clock_out_display: r.clock_out_time ? formatTimeStr(r.clock_out_time) : null
    }))

    return { code: 0, data: records }
  } catch (err) {
    return { code: -1, msg: '获取记录失败' }
  }
}

async function getDailyRecords(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }
  const orgId = getOrgId(caller)

  const { date } = event
  try {
    const allRecords = sortDocsByFields(await fetchAllDocs('Attendances', {
        org_id: orgId,
        date: date || getDateStr(new Date())
      }), ['clock_in_time', 'created_at', 'date'], 'desc')

    const records = allRecords.map(r => ({
      ...r,
      clock_in_display: r.clock_in_time ? formatTimeStr(r.clock_in_time) : null,
      clock_out_display: r.clock_out_time ? formatTimeStr(r.clock_out_time) : null
    }))

    return { code: 0, data: records }
  } catch (err) {
    return { code: -1, msg: '获取记录失败' }
  }
}

async function getAbnormalRecords(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }
  const orgId = getOrgId(caller)

  try {
    const allRecords = sortDocsByFields(await fetchAllDocs('Attendances', {
        org_id: orgId,
        status: 'abnormal'
      }), ['date', 'clock_in_time', 'created_at'], 'desc')

    const records = allRecords.map(r => ({
      ...r,
      clock_in_display: r.clock_in_time ? formatTimeStr(r.clock_in_time) : null
    }))

    return { code: 0, data: records }
  } catch (err) {
    return { code: -1, msg: '获取异常记录失败' }
  }
}

async function supplement(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足，仅管理员可补签' }
  }
  const orgId = getOrgId(caller)

  const { attendance_id, user_id, date, clock_out_time } = event
  if (!attendance_id || !clock_out_time) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    const record = await db.collection('Attendances').doc(attendance_id).get()
    if (!record.data) {
      return { code: -1, msg: '考勤记录不存在' }
    }
    if (!ensureSameOrg(record.data, caller)) return { code: -1, msg: '无权补签其他工厂考勤' }

    const clockInTime = new Date(record.data.clock_in_time)
    const clockOutTime = new Date(clock_out_time)
    const hours = Math.round((clockOutTime - clockInTime) / (1000 * 60 * 60) * 100) / 100

    if (hours <= 0 || hours > 24) {
      return { code: -1, msg: '补签时间无效' }
    }

    await db.collection('Attendances').doc(attendance_id).update({
      data: {
        clock_out_time: clockOutTime.toISOString(),
        hours: hours,
        status: 'supplemented',
        supplemented_by: caller._id,
        supplemented_at: db.serverDate()
      }
    })

    // 更新月工时
    await updateMonthlyHours(record.data.user_id, orgId)

    // 审计日志
    await db.collection('audit_logs').add({
      data: {
        org_id: orgId,
        operator_id: caller._id,
        operator_name: caller.name,
        action: 'supplement_attendance',
        target_id: attendance_id,
        details: `为 ${record.data.user_name} 补签 ${date} 下班时间`,
        created_at: db.serverDate()
      }
    })

    return { code: 0, msg: '补签成功' }
  } catch (err) {
    return { code: -1, msg: '补签失败' }
  }
}

async function getUserMonthlyRecords(event) {
  const wxContext = cloud.getWXContext()
  const auth = await requireAttendanceActor(event, wxContext, event.user_id)
  if (!auth.ok) return auth.response

  const user_id = auth.actorUserId
  const orgId = getOrgId(auth.caller)
  const range = bjTime.getBeijingMonthRange()

  try {
    const allRecords = sortDocsByFields(await fetchAllDocs('Attendances', {
        org_id: orgId,
        user_id,
        date: _.gte(range.startDate).and(_.lt(range.endDate))
      }), ['date', 'clock_in_time', 'created_at'], 'desc')

    const records = allRecords.map(r => ({
      ...r,
      clock_in_display: r.clock_in_time ? formatTimeStr(r.clock_in_time) : null,
      clock_out_display: r.clock_out_time ? formatTimeStr(r.clock_out_time) : null
    }))

    return { code: 0, data: records }
  } catch (err) {
    return { code: -1, msg: '获取考勤记录失败' }
  }
}

// 定时触发：检查异常考勤（前一天只签到未签退的）
async function checkAbnormalAttendances() {
  // 使用北京时间计算"昨天"
  var todayFields = bjTime.getBeijingFields()
  var yesterdayDate = new Date(Date.UTC(todayFields.year, todayFields.month - 1, todayFields.day - 1))
  var yesterdayStr = yesterdayDate.getUTCFullYear() + '-' +
    String(yesterdayDate.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(yesterdayDate.getUTCDate()).padStart(2, '0')

  try {
    let allRecords = []
    let batchLen = 0
    do {
      const batch = await db.collection('Attendances').where({
        date: yesterdayStr,
        clock_in_time: _.exists(true),
        clock_out_time: null,
        status: _.in(['normal', 'pending_review'])
      }).skip(allRecords.length).limit(100).get()
      batchLen = (batch.data || []).length
      allRecords = allRecords.concat(batch.data || [])
    } while (batchLen === 100)

    for (const record of allRecords) {
      await db.collection('Attendances').doc(record._id).update({
        data: { status: 'abnormal' }
      })
    }

    return { code: 0, msg: `已标记 ${allRecords.length} 条异常记录` }
  } catch (err) {
    return { code: -1, msg: '检查异常失败' }
  }
}
