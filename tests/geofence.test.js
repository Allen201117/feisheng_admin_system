const test = require('node:test')
const assert = require('node:assert/strict')

const {
  haversineDistance,
  evaluateGeofence
} = require('../cloudfunctions/attendance/geofence')

test('haversineDistance returns zero for identical coordinates', () => {
  assert.equal(haversineDistance(38.2688, 114.1889, 38.2688, 114.1889), 0)
})

test('evaluateGeofence returns inside fence for same point', () => {
  const result = evaluateGeofence({
    latitude: 38.2688,
    longitude: 114.1889,
    factoryLatitude: 38.2688,
    factoryLongitude: 114.1889,
    radius: 100
  })

  assert.equal(result.withinFence, true)
  assert.equal(result.distance, 0)
  assert.deepEqual(result.employeeLocation, { latitude: 38.2688, longitude: 114.1889 })
  assert.deepEqual(result.factoryLocation, { latitude: 38.2688, longitude: 114.1889 })
})

test('evaluateGeofence coerces string coordinates and detects outside fence', () => {
  const result = evaluateGeofence({
    latitude: '38.2688',
    longitude: '114.1889',
    factoryLatitude: '38.2698',
    factoryLongitude: '114.1889',
    radius: '50'
  })

  assert.equal(result.withinFence, false)
  assert.ok(result.distance > 50)
  assert.equal(result.radius, 50)
})

test('haversineDistance returns known distance for Beijing-Shanghai', () => {
  // 北京(39.9042, 116.4074) 到 上海(31.2304, 121.4737) 约 1068km
  const d = haversineDistance(39.9042, 116.4074, 31.2304, 121.4737)
  assert.ok(d > 1050000 && d < 1090000, `expected ~1068km, got ${d}m`)
})

test('evaluateGeofence detects inside fence at boundary', () => {
  const result = evaluateGeofence({
    latitude: 38.2688,
    longitude: 114.1889,
    factoryLatitude: 38.26925,
    factoryLongitude: 114.1889,
    radius: 200
  })
  assert.equal(result.withinFence, true)
  assert.ok(result.distance < 200)
})

test('evaluateGeofence handles zero coords as outside fence', () => {
  const result = evaluateGeofence({
    latitude: 0,
    longitude: 0,
    factoryLatitude: 38.2688,
    factoryLongitude: 114.1889,
    radius: 100
  })
  assert.equal(result.withinFence, false)
  assert.ok(result.distance > 1000)
})
