function sanitizeSettingsRecord(data) {
  const normalized = Object.assign({}, data || {})

  if (normalized.qrcode_expire_hours && !normalized.qrcode_expire_days) {
    normalized.qrcode_expire_days = Math.round(normalized.qrcode_expire_hours / 24) || 1
  }
  if (!normalized.qrcode_expire_days) normalized.qrcode_expire_days = 1
  if (normalized.face_recognition_enabled === undefined) normalized.face_recognition_enabled = false
  if (normalized.allow_home_checkin === undefined) normalized.allow_home_checkin = false
  normalized.salary_payroll_mode = normalizePayrollMode(normalized.salary_payroll_mode)
  normalized.checkpoints = normalizeCheckpoints(normalized)

  return normalized
}

function normalizePayrollMode(value) {
  return value === 'order' ? 'order' : 'monthly'
}

function normalizeCheckpoints(data) {
  var source = Object.assign({}, data || {})
  var mainLat = Number(source.factory_latitude)
  var mainLng = Number(source.factory_longitude)
  var mainRadius = parseInt(source.geofence_radius, 10) || 100
  var hasMain = Number.isFinite(mainLat) && Number.isFinite(mainLng)

  var provided = Array.isArray(source.checkpoints) ? source.checkpoints : []
  var normalizedProvided = provided.map(function(item, index) {
    var lat = Number(item && item.latitude)
    var lng = Number(item && item.longitude)
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null
    return {
      name: item && item.name ? String(item.name) : (index === 0 ? '主打卡点' : '附加打卡点'),
      latitude: lat,
      longitude: lng,
      radius: parseInt(item && item.radius, 10) || 100
    }
  }).filter(Boolean)

  if (normalizedProvided.length === 0) {
    if (!hasMain) return []
    return [{
      name: '主打卡点',
      latitude: mainLat,
      longitude: mainLng,
      radius: mainRadius
    }]
  }

  if (!hasMain) {
    return normalizedProvided
  }

  var first = normalizedProvided[0]
  if (first && first.latitude === mainLat && first.longitude === mainLng) {
    normalizedProvided[0] = {
      name: first.name || '主打卡点',
      latitude: mainLat,
      longitude: mainLng,
      radius: parseInt(first.radius, 10) || mainRadius
    }
    return normalizedProvided
  }

  return [{
    name: '主打卡点',
    latitude: mainLat,
    longitude: mainLng,
    radius: mainRadius
  }].concat(normalizedProvided)
}

function canSaveSettings(state) {
  if (!state || state.loaded !== true) {
    return { ok: false, msg: '设置未加载完成，暂不能保存' }
  }
  return { ok: true }
}

module.exports = {
  sanitizeSettingsRecord,
  canSaveSettings,
  normalizeCheckpoints,
  normalizePayrollMode
}
