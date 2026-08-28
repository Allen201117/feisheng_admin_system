// 云函数 - attendance (考勤管理) — 已重构为北京时间 + 增强定位判定
const cloud = require('wx-server-sdk')
const { comprehensiveCheckIn, buildCheckInLog } = require('./geofence-enhanced')
const { normalizeFactorySettings } = require('./factory-settings.logic')
const bjTime = require('./beijing-time')
const leaveLogic = require('./leave.logic')
const { buildMonthAttendanceOverview } = require('./attendance-summary.logic')
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

const authGuard = require('./auth-guard')

// 统一鉴权（见 auth-guard.js）：必须携带有效 token，工厂 status=active，失败一律拒绝。
async function getCallerUserByEvent(event, wxContext) {
  return await authGuard.getCallerUserByEvent(db, event)
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

function normalizePageSize(value, fallback = 100) {
  const parsed = parseInt(value, 10)
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback
}

async function fetchAllDocs(collectionName, where, pageSizeValue = 100) {
  const pageSize = normalizePageSize(pageSizeValue)
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
    case 'getMonthAttendanceOverview': return await getMonthAttendanceOverview(event, wxContext)
    case 'repairLegacyHalfDayLeaves': return await repairLegacyHalfDayLeaves(event, wxContext)
    case 'updateLeaveHalfDay': return await updateLeaveHalfDay(event, wxContext)
    case 'checkAbnormal': return await checkAbnormalAttendances()
    // ===== 请假（LeaveRecords）=====
    case 'requestLeave': return await requestLeave(event, wxContext)
    case 'cancelLeave': return await cancelLeave(event, wxContext)
    case 'getMyLeaves': return await getMyLeaves(event, wxContext)
    case 'getMonthLeaveSummary': return await getMonthLeaveSummary(event, wxContext)
    case 'getLeaveRequestsForBoss': return await getLeaveRequestsForBoss(event, wxContext)
    case 'getUnreadLeaveCount': return await getUnreadLeaveCount(event, wxContext)
    case 'getTodayLeaveCount': return await getTodayLeaveCount(event, wxContext)
    case 'markLeavesRead': return await markLeavesRead(event, wxContext)
    case 'bossAddLeave': return await bossAddLeave(event, wxContext)
    case 'bossDeleteLeave': return await bossDeleteLeave(event, wxContext)
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

    // 按批并发更新（每批10条），替代逐条串行 update，降低大数据量下定时任务超时风险。
    // 注：本任务是平台级定时扫描（无调用者上下文），不按 org 过滤是有意为之；
    // 每条记录仅依据自身字段判定，读侧 getAbnormalRecords 仍按 org_id 隔离。
    let marked = 0
    for (let i = 0; i < allRecords.length; i += 10) {
      const chunk = allRecords.slice(i, i + 10)
      await Promise.all(chunk.map(async (record) => {
        await db.collection('Attendances').doc(record._id).update({
          data: { status: 'abnormal' }
        })
        marked += 1
      }))
    }

    return { code: 0, msg: `已标记 ${marked} 条异常记录` }
  } catch (err) {
    return { code: -1, msg: '检查异常失败' }
  }
}

// ════════════════════════ 请假（LeaveRecords）════════════════════════
// 口径见 leave.logic.js：全勤 = 本月无 active 请假；请假不进工资（§2.1）。
// 员工自助提交、立即生效（无需审批）；老板收 App 内红点提醒 + 卡片标记。

// LeaveRecords 是新集合，首次写入前确保其存在（沿用 init/billing 的 createCollection 幂等模式）。
function isCollectionAlreadyExistsError(err) {
  const text = String((err && (err.message || err.errMsg)) || '')
  return !!(err && (
    err.errCode === -502005 ||
    err.errCode === -501001 ||
    text.includes('already exists') ||
    text.includes('Table exist') ||
    text.includes('ResourceExist') ||
    text.includes('DATABASE_COLLECTION_ALREADY_EXIST')
  ))
}

async function safeCreateCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    if (isCollectionAlreadyExistsError(err)) return
    throw err
  }
}

// 员工提交请假（给自己）
async function requestLeave(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) return { code: -1, msg: '登录已失效，请重新登录' }
  const orgId = getOrgId(caller)
  if (!orgId) return { code: -1, msg: '账号未归属工厂' }

  const month = String(event.month || '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) return { code: -1, msg: '请假月份格式不正确' }
  const dates = leaveLogic.normalizeLeaveDates(event.dates, month)
  if (dates.length === 0) return { code: -1, msg: '请选择请假日期' }
  if (dates.length > 31) return { code: -1, msg: '请假天数超出范围' }
  // 半天请假：half_days = { 'YYYY-MM-DD': 'am' | 'pm' }，只对 dates 里的日期生效，半天记 0.5 天
  const halfDays = leaveLogic.normalizeHalfDays(event.half_days, dates)
  const dayCount = leaveLogic.computeLeaveDays(dates, halfDays)
  const reason = String(event.reason || '').slice(0, 200)

  try {
    // 首次请假时若集合不存在则创建（幂等），避免 add 报 collection not exist
    await safeCreateCollection('LeaveRecords')
    const addRes = await db.collection('LeaveRecords').add({
      data: {
        org_id: orgId,
        user_id: caller._id,
        user_name: caller.name || '',
        month: month,
        dates: dates,
        half_days: halfDays,
        day_count: dayCount,
        reason: reason,
        status: 'active',
        boss_read: false,
        created_at: db.serverDate()
      }
    })
    await writeAudit('leave_request', `user_id=${caller._id}; month=${month}; days=${dayCount}`, orgId)
    return { code: 0, msg: '请假已提交', data: { _id: addRes._id, day_count: dayCount } }
  } catch (err) {
    console.error('[attendance] requestLeave 失败', err)
    return { code: -1, msg: '请假提交失败' }
  }
}

// 员工撤销请假（仅本人、仅 active、且全部日期严格在今天之后）
async function cancelLeave(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) return { code: -1, msg: '登录已失效，请重新登录' }
  const leaveId = event.leave_id
  if (!leaveId) return { code: -1, msg: '参数不完整' }
  try {
    let record = null
    try {
      const recRes = await db.collection('LeaveRecords').doc(leaveId).get()
      record = recRes.data
    } catch (e) {
      return { code: -1, msg: '请假记录不存在' }
    }
    if (!record || !ensureSameOrg(record, caller)) return { code: -1, msg: '请假记录不存在' }
    if (String(record.user_id) !== String(caller._id)) return { code: -1, msg: '只能撤销本人的请假' }
    if (record.status !== 'active') return { code: -1, msg: '该请假已撤销' }
    const today = bjTime.getBeijingToday()
    if (!leaveLogic.canCancelLeave(record, today)) return { code: -1, msg: '已开始或已过的请假不能撤销' }
    await db.collection('LeaveRecords').doc(leaveId).update({
      data: { status: 'cancelled', cancelled_at: db.serverDate() }
    })
    await writeAudit('leave_cancel', `user_id=${caller._id}; leave_id=${leaveId}`, getOrgId(caller))
    return { code: 0, msg: '已撤销' }
  } catch (err) {
    console.error('[attendance] cancelLeave 失败', err)
    return { code: -1, msg: '撤销失败' }
  }
}

// 员工查看自己的请假列表（含可否撤销）
async function getMyLeaves(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller) return { code: -1, msg: '登录已失效，请重新登录' }
  try {
    const list = await fetchAllDocs('LeaveRecords', {
      org_id: getOrgId(caller),
      user_id: caller._id
    })
    const today = bjTime.getBeijingToday()
    const sorted = sortDocsByFields(list, ['created_at'], 'desc')
    const data = sorted.map(function (r) {
      return {
        _id: r._id,
        month: r.month,
        dates: r.dates || [],
        half_days: r.half_days || {},
        day_count: leaveLogic.countLeaveDays(r),
        reason: r.reason || '',
        status: r.status,
        can_cancel: leaveLogic.canCancelLeave(r, today),
        created_at: r.created_at
      }
    })
    return { code: 0, data: data }
  } catch (err) {
    console.error('[attendance] getMyLeaves 失败', err)
    return { code: -1, msg: '获取请假记录失败' }
  }
}

// 老板：某月各员工请假天数汇总 → { [user_id]: day_count }
async function getMonthLeaveSummary(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }
  const month = String(event.month || '').trim() || bjTime.getBeijingMonth()
  try {
    const list = await fetchAllDocs('LeaveRecords', {
      org_id: getOrgId(caller),
      month: month,
      status: 'active'
    })
    return { code: 0, data: leaveLogic.summarizeMonthLeave(list) }
  } catch (err) {
    console.error('[attendance] getMonthLeaveSummary 失败', err)
    return { code: -1, msg: '获取请假汇总失败' }
  }
}

// 老板：请假申请列表（红点列表）
async function getLeaveRequestsForBoss(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }
  try {
    const list = await fetchAllDocs('LeaveRecords', {
      org_id: getOrgId(caller),
      status: 'active'
    })
    const sorted = sortDocsByFields(list, ['created_at'], 'desc')
    const data = sorted.map(function (r) {
      return {
        _id: r._id,
        user_id: r.user_id,
        user_name: r.user_name || '',
        month: r.month,
        dates: r.dates || [],
        half_days: r.half_days || {},
        day_count: leaveLogic.countLeaveDays(r),
        reason: r.reason || '',
        boss_read: !!r.boss_read,
        created_by_boss: !!r.created_by_boss,
        created_at: r.created_at
      }
    })
    return { code: 0, data: data }
  } catch (err) {
    console.error('[attendance] getLeaveRequestsForBoss 失败', err)
    return { code: -1, msg: '获取请假列表失败' }
  }
}

// 老板：未读请假条数（红点）
async function getUnreadLeaveCount(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }
  try {
    const res = await db.collection('LeaveRecords').where({
      org_id: getOrgId(caller),
      status: 'active',
      boss_read: _.neq(true)
    }).count()
    return { code: 0, data: { count: res.total || 0 } }
  } catch (err) {
    console.error('[attendance] getUnreadLeaveCount 失败', err)
    return { code: -1, msg: '获取未读数失败' }
  }
}

// 老板首页考勤卡：今日请假人数（本月 active 记录中 dates 含今天，去重员工）
async function getTodayLeaveCount(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }
  try {
    const today = bjTime.getBeijingToday()
    const month = bjTime.getBeijingMonth()
    const list = await fetchAllDocs('LeaveRecords', {
      org_id: getOrgId(caller),
      month: month,
      status: 'active'
    })
    return { code: 0, data: { count: leaveLogic.countTodayLeave(list, today) } }
  } catch (err) {
    console.error('[attendance] getTodayLeaveCount 失败', err)
    return { code: -1, msg: '获取今日请假失败' }
  }
}

// 老板：打开请假列表 → 未读批量置已读（清红点）
async function markLeavesRead(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }
  try {
    await db.collection('LeaveRecords').where({
      org_id: getOrgId(caller),
      status: 'active',
      boss_read: _.neq(true)
    }).update({
      data: { boss_read: true }
    })
    return { code: 0, msg: 'ok' }
  } catch (err) {
    console.error('[attendance] markLeavesRead 失败', err)
    return { code: -1, msg: '操作失败' }
  }
}

// 老板代员工补录请假：给不会自助操作的（多为大龄）员工手动登记请假。
// 与员工自助 requestLeave 的差异：老板权限、给指定员工、允许补录已过去的日期、
// 自动已读（不给自己冒红点）、标记来源与操作人。日期口径仍复用 normalizeLeaveDates。
async function bossAddLeave(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }
  const orgId = getOrgId(caller)
  if (!orgId) return { code: -1, msg: '账号未归属工厂' }

  const targetUserId = event.user_id
  if (!targetUserId) return { code: -1, msg: '请选择员工' }
  const month = String(event.month || '').trim()
  if (!/^\d{4}-\d{2}$/.test(month)) return { code: -1, msg: '请假月份格式不正确' }
  const dates = leaveLogic.normalizeLeaveDates(event.dates, month)
  if (dates.length === 0) return { code: -1, msg: '请选择请假日期' }
  if (dates.length > 31) return { code: -1, msg: '请假天数超出范围' }
  const halfDays = leaveLogic.normalizeHalfDays(event.half_days, dates)
  const dayCount = leaveLogic.computeLeaveDays(dates, halfDays)
  const reason = String(event.reason || '').slice(0, 200)

  try {
    // org 从登录老板推导，绝不信前端传值；校验目标员工存在且属本厂（防跨租户代录）
    let target = null
    try {
      const tRes = await db.collection('Users').doc(targetUserId).get()
      target = tRes.data
    } catch (e) {
      return { code: -1, msg: '员工不存在' }
    }
    if (!target || !ensureSameOrg(target, caller)) return { code: -1, msg: '员工不存在或不属于本厂' }

    // 首次请假时若集合不存在则创建（幂等），与 requestLeave 同口径
    await safeCreateCollection('LeaveRecords')
    const addRes = await db.collection('LeaveRecords').add({
      data: {
        org_id: orgId,
        user_id: targetUserId,
        user_name: target.name || '',
        month: month,
        dates: dates,
        half_days: halfDays,
        day_count: dayCount,
        reason: reason,
        status: 'active',
        boss_read: true,           // 老板代录，自己已知，不给自己列表冒红点
        created_by_boss: true,     // 来源标记：区别于员工自助
        operator_id: caller._id,
        operator_name: caller.name || '',
        created_at: db.serverDate()
      }
    })
    await writeAudit('leave_add_by_boss', `operator=${caller._id}; target=${targetUserId}; month=${month}; days=${dayCount}`, orgId)
    return { code: 0, msg: '已代员工添加请假', data: { _id: addRes._id, day_count: dayCount } }
  } catch (err) {
    console.error('[attendance] bossAddLeave 失败', err)
    return { code: -1, msg: '添加请假失败' }
  }
}

// 老板删除请假：可删本厂任意请假（员工提报的 + 老板代录的），录错也能删。
// 软删 status→cancelled（与员工撤销同口径），删后自动不再计入全勤（summarizeMonthLeave 只算 active）。
// 与员工 cancelLeave 的差异：老板权限、不限本人、不限日期（含已开始/已过的也能删）。
async function bossDeleteLeave(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }
  const leaveId = event.leave_id
  if (!leaveId) return { code: -1, msg: '参数不完整' }
  try {
    let record = null
    try {
      const recRes = await db.collection('LeaveRecords').doc(leaveId).get()
      record = recRes.data
    } catch (e) {
      return { code: -1, msg: '请假记录不存在' }
    }
    // org 从登录老板推导，绝不信前端；校验记录属本厂（防跨租户删除）
    if (!record || !ensureSameOrg(record, caller)) return { code: -1, msg: '请假记录不存在' }
    if (record.status !== 'active') return { code: -1, msg: '该请假已删除' }
    await db.collection('LeaveRecords').doc(leaveId).update({
      data: {
        status: 'cancelled',
        cancelled_at: db.serverDate(),
        cancelled_by_boss: true,          // 删除来源标记，不覆盖代录的 operator_*
        cancelled_operator_id: caller._id,
        cancelled_operator_name: caller.name || ''
      }
    })
    await writeAudit('leave_delete_by_boss', `operator=${caller._id}; leave_id=${leaveId}; target=${record.user_id}`, getOrgId(caller))
    return { code: 0, msg: '已删除' }
  } catch (err) {
    console.error('[attendance] bossDeleteLeave 失败', err)
    return { code: -1, msg: '删除失败' }
  }
}

// 老板端月度考勤总览：一次返回本月所有员工的出勤/请假/缺勤统计 + 每人每天的状态清单。
// 一次取完是有意的——工厂几十号人 × 31 天的数据量很小，换来点开员工抽屉即时出日历，不用二次请求。
async function getMonthAttendanceOverview(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }
  const orgId = getOrgId(caller)
  if (!orgId) return { code: -1, msg: '账号未归属工厂' }

  const month = /^\d{4}-\d{2}$/.test(String(event.month || '')) ? event.month : bjTime.getBeijingMonth()
  const today = bjTime.getBeijingToday()

  try {
    // 只取 Users + 本月请假：考勤口径已改为「不看打卡、只看请假」（见 attendance-summary.logic.js 顶部），
    // 打卡记录仍由 getAbnormalRecords / supplement 那条线单独用，这里不需要。
    const [users, leaves] = await Promise.all([
      // 注意：本云函数的 fetchAllDocs 第三个参数是 pageSize，不支持字段投影，别照搬 salary/order 的写法
      fetchAllDocs('Users', {
        org_id: orgId,
        role: _.in(['employee', 'qc']),
        status: 'active'
      }),
      // LeaveRecords 是「第一次有人请假」才创建的集合：没建过时查询会直接报错，
      // 不能让整个考勤总览跟着挂掉，所以这里单独兜底成空数组。
      fetchAllDocs('LeaveRecords', {
        org_id: orgId,
        month: month,
        status: 'active'
      }).catch(() => [])
    ])

    return {
      code: 0,
      data: buildMonthAttendanceOverview({
        month,
        today,
        // 只喂纯函数需要的字段：Users 里有手机号/密码等敏感字段，绝不整条往前端带
        users: users.map(u => ({ _id: u._id, name: u.name, role: u.role })),
        leaves
      })
    }
  } catch (err) {
    console.error('[attendance] getMonthAttendanceOverview 失败', err)
    return { code: -1, msg: '获取考勤总览失败' }
  }
}


// 历史半天请假识别（一次性数据迁移，boss only，默认 dry_run 只报告不写库）。
// 背景：半天请假功能是 2026-08-29 才上线的。在那之前老板想记「上午请假」只能写进备注，
// 库里仍按整天记（day_count = dates.length），于是新版日历会把它标成红色「全天」，
// 全勤天数也多算了 0.5 天。这里把备注里能读出上午/下午/半天的老记录批量补上 half_days。
// 安全边界：只碰完全没有半天标记的 active 记录，已经用新功能标过的一律不动，重复跑不会改坏。
async function repairLegacyHalfDayLeaves(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }
  const orgId = getOrgId(caller)
  if (!orgId) return { code: -1, msg: '账号未归属工厂' }

  const dryRun = event.dry_run !== false

  try {
    const records = await fetchAllDocs('LeaveRecords', {
      org_id: orgId,
      status: 'active'
    }).catch(() => [])

    const plan = leaveLogic.planLegacyHalfDayMigration(records)

    // 备注里带字但读不出半天的，列出来让老板自己判断（比如写「有事」「10.30走」）。
    // ⚠️ 这里**不能**把「已经设过半天的」过滤掉：老板点「改时段」改完后，
    // 行如果直接消失、面板又还是「没有要转换的老记录」，看起来就像根本没保存。
    // 所以保留整行、附上它**当前的时段**，改完 badge 会跟着变 —— 这才是能看见的确认。
    const unmatchedAll = records
      .filter(r => r && r.status === 'active' && (r.reason || '').trim())
      .filter(r => !plan.some(p => p._id === r._id))
    const unmatched = unmatchedAll
      .slice(0, 50)
      .map(r => {
        const half = leaveLogic.normalizeHalfDays(r.half_days, r.dates)
        const kinds = Object.keys(half).map(k => half[k])
        // 整条记录时段一致才报具体半天，否则按全天显示（混着的极少见）
        const uniform = kinds.length > 0 && kinds.length === (r.dates || []).length && kinds.every(k => k === kinds[0])
        return {
          _id: r._id,
          user_name: r.user_name || '',
          month: r.month || '',
          dates: r.dates || [],
          reason: r.reason || '',
          current_kind: uniform ? kinds[0] : 'full',
          // 按 dates + half_days 现算，不直接读库里的 day_count ——
          // 两者对不上的记录会被上面的 plan 捞去修，这里先按真实口径显示，别展示脏值
          day_count: leaveLogic.computeLeaveDays(r.dates, half)
        }
      })

    const summary = {
      dry_run: dryRun,
      scanned: records.length,
      total_fix_count: plan.length,
      plan: plan.slice(0, 30),
      unmatched,
      unmatched_total: unmatchedAll.length
    }

    if (dryRun || plan.length === 0) {
      return { code: 0, msg: dryRun ? '试运行完成（未写库）' : '没有需要转换的老记录', data: summary }
    }

    let applied = 0
    let failed = 0
    for (let i = 0; i < plan.length; i += 20) {
      const chunk = plan.slice(i, i + 20)
      const results = await Promise.all(chunk.map(async (item) => {
        try {
          await db.collection('LeaveRecords').doc(item._id).update({
            data: {
              half_days: item.half_days,
              day_count: item.new_day_count,
              half_day_migrated: true,
              updated_at: db.serverDate()
            }
          })
          return true
        } catch (err) {
          console.error('[attendance] 半天请假迁移写入失败', item._id, err)
          return false
        }
      }))
      results.forEach((ok) => { ok ? applied++ : failed++ })
    }

    await writeAudit('leave_half_day_migrate', `operator=${caller._id}; scanned=${records.length}; applied=${applied}; failed=${failed}`, orgId)

    return {
      code: 0,
      msg: `转换完成：成功 ${applied} 条，失败 ${failed} 条`,
      data: { ...summary, applied, failed }
    }
  } catch (err) {
    console.error('[attendance] repairLegacyHalfDayLeaves 失败', err)
    return { code: -1, msg: '历史半天请假识别失败: ' + err.message }
  }
}


// 老板手动把一条请假改成半天 / 改回全天（boss only）。
// 迁移工具只认得懂备注里明写「上午/下午/半天」的，剩下像「10.30走」「1」这种读不出来的，
// 得让老板自己点一下改 —— 否则只能删了重录，太折腾。
// 作用于整条记录的所有日期；一条记录里有的日子全天有的日子半天，仍需删了分开重录。
async function updateLeaveHalfDay(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') return { code: -1, msg: '权限不足' }

  const leaveId = event.leave_id
  const kind = String(event.kind || '')
  if (!leaveId) return { code: -1, msg: '参数不完整' }
  if (kind !== 'full' && leaveLogic.HALF_KINDS.indexOf(kind) < 0) return { code: -1, msg: '无效的半天类型' }

  try {
    let record = null
    try {
      const res = await db.collection('LeaveRecords').doc(leaveId).get()
      record = res.data
    } catch (e) {
      return { code: -1, msg: '请假记录不存在' }
    }
    if (!record || !ensureSameOrg(record, caller)) return { code: -1, msg: '请假记录不存在' }
    if (record.status !== 'active') return { code: -1, msg: '该请假已撤销，不能修改' }

    const dates = Array.isArray(record.dates) ? record.dates : []
    if (dates.length === 0) return { code: -1, msg: '这条请假没有日期，无法修改' }

    const halfDays = {}
    if (kind !== 'full') dates.forEach(function (d) { halfDays[String(d)] = kind })
    const dayCount = leaveLogic.computeLeaveDays(dates, halfDays)

    await db.collection('LeaveRecords').doc(leaveId).update({
      data: {
        half_days: halfDays,
        day_count: dayCount,
        updated_at: db.serverDate()
      }
    })
    await writeAudit('leave_half_day_update', `operator=${caller._id}; leave=${leaveId}; kind=${kind}; days=${dayCount}`, getOrgId(caller))

    return { code: 0, msg: '已更新', data: { day_count: dayCount, kind: kind } }
  } catch (err) {
    console.error('[attendance] updateLeaveHalfDay 失败', err)
    return { code: -1, msg: '修改失败' }
  }
}
