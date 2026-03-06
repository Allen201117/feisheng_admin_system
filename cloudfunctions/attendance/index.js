// 云函数 - attendance (考勤管理)
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

async function writeAudit(action, details) {
  try {
    await db.collection('audit_logs').add({
      data: {
        action,
        details,
        created_at: db.serverDate()
      }
    })
  } catch (e) {}
}

async function validateQrToken(qrId) {
  if (!qrId) return { ok: false, msg: '缺少二维码标识' }
  const qrRes = await db.collection('qr_codes').where({ token: qrId }).limit(1).get()
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
function haversineDistance(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const dLat = (lat2 - lat1) * Math.PI / 180
  const dLon = (lon2 - lon1) * Math.PI / 180
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function getDateStr(date) {
  const d = date || new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

function formatTimeStr(date) {
  const d = new Date(date)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

// 获取工厂设置
async function getFactorySettings() {
  try {
    const res = await db.collection('factory_settings').doc('main').get()
    return res.data || {}
  } catch (e) {
    return {
      factory_latitude: 39.9042,
      factory_longitude: 116.4074,
      geofence_radius: 100
    }
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

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  switch (action) {
    case 'clockIn': return await clockIn(event, wxContext)
    case 'clockOut': return await clockOut(event, wxContext)
    case 'getTodayRecord': return await getTodayRecord(event)
    case 'getMonthlyHours': return await getMonthlyHours(event)
    case 'getDailyRecords': return await getDailyRecords(event, wxContext)
    case 'getAbnormalRecords': return await getAbnormalRecords(event, wxContext)
    case 'supplement': return await supplement(event, wxContext)
    case 'getUserMonthlyRecords': return await getUserMonthlyRecords(event)
    case 'checkAbnormal': return await checkAbnormalAttendances()
    default: return { code: -1, msg: '未知操作' }
  }
}

async function clockIn(event, wxContext) {
  const { user_id, latitude, longitude, source, qr_id } = event
  const today = getDateStr(new Date())
  const settings = await getFactorySettings()

  if (source === 'qrcode') {
    const qrCheck = await validateQrToken(qr_id)
    if (!qrCheck.ok) {
      await writeAudit('clock_in_failed', `user_id=${user_id}; source=qrcode; reason=${qrCheck.msg}`)
      return { code: -1, msg: qrCheck.msg }
    }
  }

  // 地理围栏校验
  const distance = haversineDistance(
    latitude, longitude,
    settings.factory_latitude, settings.factory_longitude
  )

  if (distance > (settings.geofence_radius || 100)) {
    await writeAudit('clock_in_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=out_of_geofence`)
    return {
      code: -1,
      msg: `您不在工厂范围内（距离${Math.round(distance)}米，允许${settings.geofence_radius || 100}米）`
    }
  }

  // 检查是否有未签退的记录（允许多次签到/签退）
  const existing = await db.collection('Attendances').where({
    user_id, date: today
  }).orderBy('created_at', 'desc').get()

  const openRecord = (existing.data || []).find(item => item.clock_in_time && !item.clock_out_time)
  if (openRecord) {
    await writeAudit('clock_in_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=open_record_exists`)
    return { code: -1, msg: '请先签退当前记录后再签到' }
  }

  // 获取用户名
  const userRes = await db.collection('Users').doc(user_id).get()
  const userName = userRes.data ? userRes.data.name : ''

  const now = new Date()
  try {
    await db.collection('Attendances').add({
      data: {
        user_id,
        user_name: userName,
        date: today,
        clock_in_time: now.toISOString(),
        clock_in_location: { latitude, longitude },
        clock_out_time: null,
        clock_out_location: {},
        status: 'normal',
        source: source || 'normal',
        qr_id: source === 'qrcode' ? qr_id : '',
        hours: 0,
        created_at: db.serverDate()
      }
    })
    await writeAudit('clock_in_success', `user_id=${user_id}; source=${source || 'normal'}; qr_id=${source === 'qrcode' ? (qr_id || '') : ''}`)
    return { code: 0, msg: '签到成功', data: { clock_in_time: now.toISOString() } }
  } catch (err) {
    await writeAudit('clock_in_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=db_error`)
    return { code: -1, msg: '签到失败' }
  }
}

async function clockOut(event, wxContext) {
  const { user_id, latitude, longitude, source } = event
  const today = getDateStr(new Date())
  const settings = await getFactorySettings()

  // 地理围栏校验
  const distance = haversineDistance(
    latitude, longitude,
    settings.factory_latitude, settings.factory_longitude
  )

  const isOutsideFence = distance > (settings.geofence_radius || 100)

  // 查找今日签到记录
  const existing = await db.collection('Attendances').where({
    user_id, date: today
  }).orderBy('created_at', 'desc').get()

  const records = existing.data || []

  if (records.length === 0) {
    await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=no_record_today`)
    return { code: -1, msg: '请先签到（今日无任何考勤记录）' }
  }

  let openRecord = records.find(item => item.clock_in_time && !item.clock_out_time)

  // 兜底：如果当天没有可签退记录，尝试签退最近一条"未签退"记录（跨日加班场景）
  if (!openRecord) {
    const latestOpen = await db.collection('Attendances').where({
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
      await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=already_clocked_out`)
      return { code: -1, msg: '今日已签退（所有记录均已有签退时间）' }
    }
    await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=no_clock_in`)
    return { code: -1, msg: '请先签到（无签到时间）' }
  }

  if (openRecord.clock_out_time) {
    await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=already_clocked_out`)
    return { code: -1, msg: '今日已签退' }
  }

  const record = openRecord
  const now = new Date()
  const clockInTime = new Date(record.clock_in_time)
  const hours = Math.round((now - clockInTime) / (1000 * 60 * 60) * 100) / 100

  try {
    await db.collection('Attendances').doc(record._id).update({
      data: {
        clock_out_time: now.toISOString(),
        clock_out_location: _.set({ latitude, longitude }),
        hours: hours,
        status: isOutsideFence ? 'abnormal' : 'normal',
        abnormal_reason: isOutsideFence ? `签退超出围栏(${Math.round(distance)}米)` : ''
      }
    })

    // 更新用户月工时
    await updateMonthlyHours(user_id)
    await writeAudit('clock_out_success', `user_id=${user_id}; source=${source || 'normal'}; abnormal=${isOutsideFence ? 1 : 0}`)

    return {
      code: 0,
      msg: isOutsideFence
        ? `签退成功（已标记异常：超出围栏${Math.round(distance)}米）`
        : '签退成功',
      data: { clock_out_time: now.toISOString(), hours, abnormal: isOutsideFence }
    }
  } catch (err) {
    await writeAudit('clock_out_failed', `user_id=${user_id}; source=${source || 'normal'}; reason=db_error`)
    return { code: -1, msg: '签退失败：' + (err.message || JSON.stringify(err)) }
  }
}

async function getTodayRecord(event) {
  const { user_id, date } = event
  const today = date || getDateStr(new Date())

  try {
    const res = await db.collection('Attendances').where({
      user_id, date: today
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
  const { user_id } = event
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const nextMonth = now.getMonth() + 2 > 12
    ? `${now.getFullYear() + 1}-01-01`
    : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}-01`

  try {
    const res = await db.collection('Attendances').where({
      user_id,
      date: _.gte(monthStart).and(_.lt(nextMonth))
    }).get()

    let totalHours = 0
    res.data.forEach(r => { totalHours += r.hours || 0 })

    return { code: 0, data: { hours: Math.round(totalHours * 10) / 10 } }
  } catch (err) {
    return { code: -1, msg: '获取工时失败' }
  }
}

async function updateMonthlyHours(userId) {
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const nextMonth = now.getMonth() + 2 > 12
    ? `${now.getFullYear() + 1}-01-01`
    : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}-01`

  const res = await db.collection('Attendances').where({
    user_id: userId,
    date: _.gte(monthStart).and(_.lt(nextMonth))
  }).get()

  let totalHours = 0
  res.data.forEach(r => { totalHours += r.hours || 0 })

  await db.collection('Users').doc(userId).update({
    data: { monthly_hours: Math.round(totalHours * 10) / 10 }
  })
}

async function getDailyRecords(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  const { date } = event
  try {
    const res = await db.collection('Attendances').where({
      date: date || getDateStr(new Date())
    }).orderBy('clock_in_time', 'desc').get()

    const records = res.data.map(r => ({
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
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  try {
    const res = await db.collection('Attendances').where({
      status: 'abnormal'
    }).orderBy('date', 'desc').limit(50).get()

    const records = res.data.map(r => ({
      ...r,
      clock_in_display: r.clock_in_time ? formatTimeStr(r.clock_in_time) : null
    }))

    return { code: 0, data: records }
  } catch (err) {
    return { code: -1, msg: '获取异常记录失败' }
  }
}

async function supplement(event, wxContext) {
  const caller = await getCallerUser(wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足，仅管理员可补签' }
  }

  const { attendance_id, user_id, date, clock_out_time } = event
  if (!attendance_id || !clock_out_time) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    const record = await db.collection('Attendances').doc(attendance_id).get()
    if (!record.data) {
      return { code: -1, msg: '考勤记录不存在' }
    }

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
    await updateMonthlyHours(user_id)

    // 审计日志
    await db.collection('audit_logs').add({
      data: {
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
  const { user_id } = event
  const now = new Date()
  const monthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-01`
  const nextMonth = now.getMonth() + 2 > 12
    ? `${now.getFullYear() + 1}-01-01`
    : `${now.getFullYear()}-${String(now.getMonth() + 2).padStart(2, '0')}-01`

  try {
    const res = await db.collection('Attendances').where({
      user_id,
      date: _.gte(monthStart).and(_.lt(nextMonth))
    }).orderBy('date', 'desc').get()

    const records = res.data.map(r => ({
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
  const yesterday = new Date()
  yesterday.setDate(yesterday.getDate() - 1)
  const yesterdayStr = getDateStr(yesterday)

  try {
    const res = await db.collection('Attendances').where({
      date: yesterdayStr,
      clock_in_time: _.exists(true),
      clock_out_time: null,
      status: 'normal'
    }).get()

    for (const record of res.data) {
      await db.collection('Attendances').doc(record._id).update({
        data: { status: 'abnormal' }
      })
    }

    return { code: 0, msg: `已标记 ${res.data.length} 条异常记录` }
  } catch (err) {
    return { code: -1, msg: '检查异常失败' }
  }
}
