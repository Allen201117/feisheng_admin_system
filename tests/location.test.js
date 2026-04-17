const test = require('node:test')
const assert = require('node:assert/strict')

const {
  requestBestLocation,
  sampleLocationAndPickBest,
  calculateDistanceMeters,
  haversineDistance,
  isValidCoordinate,
  isInChinaMainland
} = require('../miniprogram/utils/location')

test('requestBestLocation prefers precise location with gcj02', async () => {
  const wxMock = {
    getLocation(options) {
      assert.equal(options.type, 'gcj02', 'should request gcj02 coordinates')
      options.success({ latitude: 38.2688, longitude: 114.1889, accuracy: 30 })
    },
    getFuzzyLocation() {
      throw new Error('should not call fuzzy location when precise location succeeds')
    }
  }

  const location = await requestBestLocation(wxMock)

  assert.equal(location.latitude, 38.2688)
  assert.equal(location.longitude, 114.1889)
  assert.equal(location.isPrecise, true)
  assert.equal(location.accuracy, 30)
  assert.ok(location.timestamp > 0)
})

test('requestBestLocation surfaces precise location failure without fuzzy fallback', async () => {
  const wxMock = {
    getLocation(options) {
      options.fail({ errMsg: 'getLocation:fail auth deny' })
    }
  }

  await assert.rejects(
    requestBestLocation(wxMock),
    (err) => err && err.errMsg === 'getLocation:fail auth deny'
  )
})

test('sampleLocationAndPickBest picks best accuracy from multiple samples', async () => {
  let callCount = 0
  const wxMock = {
    getLocation(options) {
      callCount++
      const results = [
        { latitude: 38.2688, longitude: 114.1889, accuracy: 100 },
        { latitude: 38.2689, longitude: 114.1890, accuracy: 20 },
        { latitude: 38.2687, longitude: 114.1888, accuracy: 50 }
      ]
      options.success(results[callCount - 1] || results[0])
    }
  }

  const result = await sampleLocationAndPickBest(wxMock, 3, 10)
  assert.equal(result.latitude, 38.2689, 'should pick best accuracy sample')
  assert.equal(result.accuracy, 20)
  assert.equal(result.validCount, 3)
  assert.equal(result.sampleCount, 3)
})

test('sampleLocationAndPickBest prefers warmed GPS updates when realtime location is available', async () => {
  let listener = null
  let stopped = false
  const wxMock = {
    startLocationUpdate(options) {
      assert.equal(options.type, 'gcj02', 'should warm GPS with gcj02 updates')
      setTimeout(() => {
        listener && listener({ latitude: 38.1000, longitude: 114.1000, accuracy: 1800 })
        listener && listener({ latitude: 38.2689, longitude: 114.1890, accuracy: 25 })
      }, 0)
      options.success({})
    },
    stopLocationUpdate(options) {
      stopped = true
      if (options && options.success) options.success({})
    },
    onLocationChange(fn) {
      listener = fn
    },
    offLocationChange(fn) {
      if (listener === fn) {
        listener = null
      }
    },
    getLocation() {
      throw new Error('should not fall back to one-shot getLocation when realtime updates succeed')
    }
  }

  const result = await sampleLocationAndPickBest(wxMock, 2, 10)

  assert.equal(result.latitude, 38.2689)
  assert.equal(result.longitude, 114.1890)
  assert.equal(result.accuracy, 25)
  assert.equal(result.validCount, 2)
  assert.equal(result.sampleCount, 2)
  assert.equal(stopped, true, 'should stop realtime updates after collecting samples')
})

test('haversineDistance returns correct meters', () => {
  const d = haversineDistance(38.2688, 114.1889, 38.2688, 114.1889)
  assert.equal(d, 0)

  // ~111m for 0.001 degree latitude
  const d2 = haversineDistance(38.2688, 114.1889, 38.2698, 114.1889)
  assert.ok(d2 > 100 && d2 < 120, `expected ~111m, got ${d2}`)
})

test('calculateDistanceMeters returns valid distance', () => {
  const result = calculateDistanceMeters(38.2688, 114.1889, 38.2698, 114.1889)
  assert.equal(result.valid, true)
  assert.ok(result.distance > 100 && result.distance < 120)
})

test('calculateDistanceMeters rejects invalid coordinates', () => {
  const result = calculateDistanceMeters(0, 0, 38.2688, 114.1889)
  assert.equal(result.valid, false)
  assert.equal(result.distance, -1)
})

test('isValidCoordinate rejects out-of-range values', () => {
  assert.equal(isValidCoordinate(38.2688, 114.1889), true)
  assert.equal(isValidCoordinate(0, 0), false)
  assert.equal(isValidCoordinate(91, 114), false)
  assert.equal(isValidCoordinate(38, 181), false)
  assert.equal(isValidCoordinate(NaN, 114), false)
  assert.equal(isValidCoordinate(38, Infinity), false)
})

test('isInChinaMainland detects Chinese coordinates', () => {
  assert.equal(isInChinaMainland(38.2688, 114.1889), true)  // 石家庄
  assert.equal(isInChinaMainland(39.9042, 116.4074), true)   // 北京
  assert.equal(isInChinaMainland(51.5074, -0.1278), false)   // 伦敦
  assert.equal(isInChinaMainland(0, 0), false)
})
