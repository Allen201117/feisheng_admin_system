const DEFAULT_FACTORY_PLACEHOLDER = {
  latitude: 39.9042,
  longitude: 116.4074
}

function toFiniteNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : NaN
}

function isSameCoordinate(lat, lng, targetLat, targetLng) {
  return Math.abs(lat - targetLat) < 0.000001 && Math.abs(lng - targetLng) < 0.000001
}

function normalizeFactorySettings(record) {
  if (!record) {
    return { ok: false, msg: '工厂位置未设置，请联系管理员重新配置工厂位置' }
  }

  const latitude = toFiniteNumber(record.factory_latitude)
  const longitude = toFiniteNumber(record.factory_longitude)
  const radius = Number(record.geofence_radius) || 100
  const locationSource = record.location_source || ''
  const coordinateSystem = record.coordinate_system || ''
  const inferredConfirmed = record.location_confirmed === true || (
    (locationSource === 'on_site' || locationSource === 'manual_input') &&
    coordinateSystem === 'gcj02'
  )

  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
    return { ok: false, msg: '工厂位置未设置，请联系管理员重新配置工厂位置' }
  }

  if (!inferredConfirmed) {
    return { ok: false, msg: '工厂位置未确认，请联系管理员在设置页重新到现场获取并保存工厂位置' }
  }

  if (isSameCoordinate(latitude, longitude, DEFAULT_FACTORY_PLACEHOLDER.latitude, DEFAULT_FACTORY_PLACEHOLDER.longitude) && locationSource !== 'manual_input') {
    return { ok: false, msg: '当前工厂位置仍是默认占位坐标，请联系管理员重新到现场获取工厂位置' }
  }

  return {
    ok: true,
    data: {
      factory_latitude: latitude,
      factory_longitude: longitude,
      geofence_radius: radius,
      coordinate_system: coordinateSystem || 'gcj02',
      location_source: locationSource || 'unknown',
      location_confirmed: true,
      checkpoints: Array.isArray(record.checkpoints) ? record.checkpoints : [],
      allowed_wifi_bssids: Array.isArray(record.allowed_wifi_bssids) ? record.allowed_wifi_bssids : []
    }
  }
}

module.exports = {
  DEFAULT_FACTORY_PLACEHOLDER,
  normalizeFactorySettings
}