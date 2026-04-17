const test = require('node:test')
const assert = require('node:assert/strict')

const {
  haversineDistance,
  evaluateGeofence,
  evaluateGeofenceMultiPoint,
  evaluateLocationQuality,
  comprehensiveCheckIn,
  buildCheckInLog
} = require('../cloudfunctions/attendance/geofence-enhanced')

// ============ haversineDistance ============

test('haversineDistance returns zero for identical coordinates', () => {
  assert.equal(haversineDistance(38.2688, 114.1889, 38.2688, 114.1889), 0)
})

test('haversineDistance returns known distance for Beijing-Shanghai', () => {
  const d = haversineDistance(39.9042, 116.4074, 31.2304, 121.4737)
  assert.ok(d > 1050000 && d < 1090000, `expected ~1068km, got ${d}m`)
})

// ============ evaluateGeofence ============

test('evaluateGeofence returns inside fence for nearby point', () => {
  const result = evaluateGeofence({
    latitude: 38.2688,
    longitude: 114.1889,
    factoryLatitude: 38.2688,
    factoryLongitude: 114.1889,
    radius: 100
  })
  assert.equal(result.withinFence, true)
  assert.equal(result.distance, 0)
})

test('evaluateGeofence detects outside fence', () => {
  const result = evaluateGeofence({
    latitude: 38.2700,
    longitude: 114.1889,
    factoryLatitude: 38.2688,
    factoryLongitude: 114.1889,
    radius: 50
  })
  assert.equal(result.withinFence, false)
  assert.ok(result.distance > 50)
})

// ============ evaluateLocationQuality ============

test('evaluateLocationQuality returns high score for good samples', () => {
  const samples = [
    { latitude: 38.2688, longitude: 114.1889, accuracy: 10 },
    { latitude: 38.2688, longitude: 114.1889, accuracy: 15 },
    { latitude: 38.2688, longitude: 114.1889, accuracy: 12 }
  ]
  const q = evaluateLocationQuality(samples)
  assert.ok(q.score > 70, `expected high quality score, got ${q.score}`)
})

test('evaluateLocationQuality returns low score for bad samples', () => {
  const samples = [
    { latitude: 38.2688, longitude: 114.1889, accuracy: 500 },
    { latitude: 38.2700, longitude: 114.2000, accuracy: 600, error: 'timeout' }
  ]
  const q = evaluateLocationQuality(samples)
  assert.ok(q.score < 50, `expected low quality score, got ${q.score}`)
})

test('evaluateLocationQuality handles empty samples', () => {
  const q = evaluateLocationQuality([])
  assert.equal(q.score, 0)
})

// ============ evaluateGeofenceMultiPoint ============

test('evaluateGeofenceMultiPoint matches closest checkpoint', () => {
  const checkpoints = [
    { latitude: 38.2688, longitude: 114.1889, radius: 100, name: '大门' },
    { latitude: 38.2700, longitude: 114.1900, radius: 50, name: '车间' }
  ]
  const result = evaluateGeofenceMultiPoint({
    latitude: 38.2688,
    longitude: 114.1889,
    checkpoints: checkpoints
  })
  assert.equal(result.withinFence, true)
  // matchedCheckpoint should be one of the checkpoints within fence
  assert.ok(result.matchedCheckpoint != null)
  assert.equal(result.matchedCheckpoint.name, '大门')
})

test('evaluateGeofenceMultiPoint rejects when outside all checkpoints', () => {
  const checkpoints = [
    { latitude: 38.2688, longitude: 114.1889, radius: 10, name: '大门' },
    { latitude: 38.2700, longitude: 114.1900, radius: 10, name: '车间' }
  ]
  const result = evaluateGeofenceMultiPoint({
    latitude: 38.0000,
    longitude: 114.0000,
    checkpoints: checkpoints
  })
  assert.equal(result.withinFence, false)
  assert.equal(result.matchedCheckpoint, null)
})

test('evaluateGeofenceMultiPoint falls back to single factory location', () => {
  const result = evaluateGeofenceMultiPoint({
    latitude: 38.2688,
    longitude: 114.1889,
    factoryLatitude: 38.2688,
    factoryLongitude: 114.1889,
    radius: 100
  })
  assert.equal(result.withinFence, true)
})

// ============ comprehensiveCheckIn ============

test('comprehensiveCheckIn approves when within fence and high quality', () => {
  const options = {
    latitude: 38.2688,
    longitude: 114.1889,
    accuracy: 15,
    allSamples: [
      { latitude: 38.2688, longitude: 114.1889, accuracy: 15 },
      { latitude: 38.2688, longitude: 114.1889, accuracy: 12 },
      { latitude: 38.2688, longitude: 114.1889, accuracy: 18 }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 200, name: '工厂' }
    ],
    wifiBSSID: '',
    allowedBSSIDs: []
  }
  const result = comprehensiveCheckIn(options)

  assert.equal(result.status, 'approved')
  assert.ok(result.geofenceResult != null)
})

test('comprehensiveCheckIn rejects when far outside fence', () => {
  const result = comprehensiveCheckIn({
    latitude: 39.0000,
    longitude: 115.0000,
    accuracy: 15,
    allSamples: [
      { latitude: 39.0000, longitude: 115.0000, accuracy: 15 }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 200, name: '工厂' }
    ],
    wifiBSSID: '',
    allowedBSSIDs: []
  })

  assert.equal(result.status, 'rejected')
})

test('comprehensiveCheckIn approves via trusted Wi-Fi even when near fence', () => {
  const result = comprehensiveCheckIn({
    latitude: 38.2693,
    longitude: 114.1889,
    accuracy: 15,
    allSamples: [
      { latitude: 38.2693, longitude: 114.1889, accuracy: 15 }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 200, name: '工厂' }
    ],
    wifiBSSID: 'AA:BB:CC:DD:EE:FF',
    allowedBSSIDs: ['aa:bb:cc:dd:ee:ff']
  })

  assert.equal(result.status, 'approved')
  assert.ok(result.wifiMatch)
})

test('comprehensiveCheckIn approves even with low quality within fence (v2 tolerance)', () => {
  const result = comprehensiveCheckIn({
    latitude: 38.2688,
    longitude: 114.1889,
    accuracy: 300,
    allSamples: [
      { latitude: 38.2688, longitude: 114.1889, accuracy: 300 }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 200, name: '工厂' }
    ],
    wifiBSSID: '',
    allowedBSSIDs: []
  })

  // v2: distance=0, well within effective radius → always approved
  assert.equal(result.status, 'approved',
    'v2 tolerance-based: distance 0 should always approve regardless of quality')
})

// ============ buildCheckInLog ============

test('buildCheckInLog returns structured log object', () => {
  const options = {
    latitude: 38.2688,
    longitude: 114.1889,
    accuracy: 15,
    allSamples: [
      { latitude: 38.2688, longitude: 114.1889, accuracy: 15 }
    ],
    wifiBSSID: ''
  }
  const checkResult = comprehensiveCheckIn({
    ...options,
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 200, name: '工厂' }
    ],
    allowedBSSIDs: []
  })
  const log = buildCheckInLog(options, checkResult)

  assert.equal(log.check_status, checkResult.status)
  assert.ok(log.raw_latitude > 0)
  assert.ok(log.quality_score >= 0)
  assert.equal(log.coordinate_system, 'gcj02')
})

test('buildCheckInLog normalizes abbreviated sample fields in log JSON', () => {
  // home.js sends {lat,lng,acc,err,t} format
  const options = {
    latitude: 38.2688,
    longitude: 114.1889,
    accuracy: 15,
    allSamples: [
      { lat: 38.2688, lng: 114.1889, acc: 15, t: 1700000000000 },
      { err: 'timeout', t: 1700000001000 }
    ],
    wifiBSSID: ''
  }
  const checkResult = comprehensiveCheckIn({
    ...options,
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 200, name: '工厂' }
    ],
    allowedBSSIDs: []
  })
  const log = buildCheckInLog(options, checkResult)

  // Parse the serialized samples JSON — should contain proper values, not undefined
  const parsedSamples = JSON.parse(log.all_samples_json)
  assert.equal(parsedSamples[0].lat, 38.2688, 'first sample lat should be populated')
  assert.equal(parsedSamples[0].acc, 15, 'first sample accuracy should be populated')
  assert.equal(parsedSamples[1].err, 'timeout', 'error sample should be preserved')
  assert.equal(log.valid_sample_count, 1, 'should count 1 valid sample')
})
