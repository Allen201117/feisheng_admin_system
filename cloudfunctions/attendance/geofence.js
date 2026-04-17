function toNumber(value) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

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

function evaluateGeofence(options) {
  const employeeLatitude = toNumber(options.latitude)
  const employeeLongitude = toNumber(options.longitude)
  const factoryLatitude = toNumber(options.factoryLatitude)
  const factoryLongitude = toNumber(options.factoryLongitude)
  const radius = toNumber(options.radius) || 100

  const distance = haversineDistance(
    employeeLatitude,
    employeeLongitude,
    factoryLatitude,
    factoryLongitude
  )

  return {
    distance: Math.round(distance * 100) / 100,
    radius,
    withinFence: distance <= radius,
    employeeLocation: {
      latitude: employeeLatitude,
      longitude: employeeLongitude
    },
    factoryLocation: {
      latitude: factoryLatitude,
      longitude: factoryLongitude
    }
  }
}

module.exports = {
  haversineDistance,
  evaluateGeofence
}
