const test = require('node:test')
const assert = require('node:assert/strict')

const {
  comprehensiveCheckIn,
  evaluateLocationQuality,
  accuracyBuffer
} = require('../cloudfunctions/attendance/geofence-enhanced')

// ============ accuracyBuffer ============

test('accuracyBuffer returns 50 for unknown/invalid accuracy', () => {
  assert.equal(accuracyBuffer(-1), 50)
  assert.equal(accuracyBuffer(0), 50)
  assert.equal(accuracyBuffer(NaN), 50)
  assert.equal(accuracyBuffer(undefined), 50)
})

test('accuracyBuffer returns half of accuracy for normal values', () => {
  assert.equal(accuracyBuffer(30), 15)
  assert.equal(accuracyBuffer(100), 50)
  assert.equal(accuracyBuffer(200), 100)
})

test('accuracyBuffer caps at 200m maximum', () => {
  assert.equal(accuracyBuffer(500), 200)
  assert.equal(accuracyBuffer(1000), 200)
})

// ============ comprehensiveCheckIn v2: tolerance-based ============

test('v2: approves when at factory even with poor GPS quality', () => {
  // THIS IS THE CRITICAL FIX: poor quality should NOT block approval
  const result = comprehensiveCheckIn({
    latitude: 38.2688,
    longitude: 114.1889,
    accuracy: 300,
    allSamples: [
      { latitude: 38.2688, longitude: 114.1889, accuracy: 300 }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 100, name: '工厂' }
    ]
  })

  assert.equal(result.status, 'approved',
    'Should approve at factory regardless of quality — distance is 0')
})

test('v2: approves when at factory with unusable quality (DevTools scenario)', () => {
  // Simulates DevTools: single sample, high accuracy value, same coordinates
  const result = comprehensiveCheckIn({
    latitude: 38.2688,
    longitude: 114.1889,
    accuracy: 800,
    allSamples: [
      { latitude: 38.2688, longitude: 114.1889, accuracy: 800 }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 100, name: '工厂' }
    ]
  })

  assert.equal(result.status, 'approved',
    'DevTools with poor accuracy at factory must approve')
})

test('v2: approves when slightly outside fence but within accuracy buffer', () => {
  // Employee 120m from factory, but accuracy is 100m → buffer=50m → effective=150m
  const result = comprehensiveCheckIn({
    latitude: 38.2698,   // ~111m north of factory
    longitude: 114.1889,
    accuracy: 100,
    allSamples: [
      { latitude: 38.2698, longitude: 114.1889, accuracy: 100 }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 100, name: '工厂' }
    ]
  })

  assert.equal(result.status, 'approved',
    'Within accuracy buffer should approve')
})

test('v2: rejects when clearly far outside fence beyond buffer', () => {
  // Employee 500m away, accuracy=30m → buffer=15m → effective=115m. Still way outside.
  const result = comprehensiveCheckIn({
    latitude: 38.2738,   // ~556m north of factory
    longitude: 114.1889,
    accuracy: 30,
    allSamples: [
      { latitude: 38.2738, longitude: 114.1889, accuracy: 30 }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 100, name: '工厂' }
    ]
  })

  assert.equal(result.status, 'rejected',
    'Clearly outside fence should reject')
})

test('v2: retries only when GPS completely broken (no valid samples)', () => {
  const result = comprehensiveCheckIn({
    latitude: 0,
    longitude: 0,
    accuracy: -1,
    allSamples: [
      { error: 'getLocation:fail auth deny' },
      { error: 'getLocation:fail timeout' }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 100, name: '工厂' }
    ]
  })

  assert.equal(result.status, 'retry',
    'Only retry when zero valid samples')
})

test('v2: quality score is preserved for logging but not gating', () => {
  const result = comprehensiveCheckIn({
    latitude: 38.2688,
    longitude: 114.1889,
    accuracy: 500,
    allSamples: [
      { latitude: 38.2688, longitude: 114.1889, accuracy: 500 }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 100, name: '工厂' }
    ]
  })

  // Quality should still be evaluated for logging
  assert.ok(result.locationQuality != null)
  assert.ok(result.locationQuality.score >= 0)
  // But result should be approved (distance=0, well within any tolerance)
  assert.equal(result.status, 'approved')
})

test('v2: Wi-Fi override still works', () => {
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

test('v2: reject message includes distance info', () => {
  const result = comprehensiveCheckIn({
    latitude: 39.0000,
    longitude: 115.0000,
    accuracy: 15,
    allSamples: [
      { latitude: 39.0000, longitude: 115.0000, accuracy: 15 }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 100, name: '工厂' }
    ]
  })

  assert.equal(result.status, 'rejected')
  assert.ok(result.reason.includes('距离'), 'Reject reason should mention distance')
})

// ============ Field name mismatch bug (home.js sends {lat,lng,acc,err}) ============

test('evaluateLocationQuality handles abbreviated field names {lat,lng,acc,err}', () => {
  // home.js maps samples as: { lat, lng, acc, err, t }
  const q = evaluateLocationQuality([
    { lat: 38.2688, lng: 114.1889, acc: 15 },
    { lat: 38.2688, lng: 114.1889, acc: 20 },
    { lat: 38.2688, lng: 114.1889, acc: 12 }
  ])
  assert.ok(q.score > 50, `abbreviated fields should be recognized, got score=${q.score}`)
  assert.notEqual(q.level, 'unusable', 'should not be unusable with 3 valid abbreviated samples')
})

test('evaluateLocationQuality handles abbreviated error field {err}', () => {
  const q = evaluateLocationQuality([
    { lat: 38.2688, lng: 114.1889, acc: 15 },
    { err: 'getLocation:fail timeout' }
  ])
  assert.ok(q.score > 0, 'should have score > 0 with 1 valid sample')
})

test('v2: approves at factory when allSamples use abbreviated fields', () => {
  // This is the EXACT scenario from the bug report:
  // home.js sends { lat, lng, acc, err, t } format
  const result = comprehensiveCheckIn({
    latitude: 38.2688,
    longitude: 114.1889,
    accuracy: 300,
    allSamples: [
      { lat: 38.2688, lng: 114.1889, acc: 300, t: Date.now() }
    ],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 100, name: '工厂' }
    ]
  })

  assert.equal(result.status, 'approved',
    'Must approve at factory even with abbreviated sample fields')
})

test('v2: approves at factory even when allSamples is empty', () => {
  // Edge case: no samples at all, but coordinates are valid
  const result = comprehensiveCheckIn({
    latitude: 38.2688,
    longitude: 114.1889,
    accuracy: 50,
    allSamples: [],
    checkpoints: [
      { latitude: 38.2688, longitude: 114.1889, radius: 100, name: '工厂' }
    ]
  })

  assert.equal(result.status, 'approved',
    'Valid coordinates at factory should approve even without samples')
})
