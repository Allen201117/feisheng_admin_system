/**
 * 统一定位工具（GCJ-02 坐标系）
 * 中国大陆微信小程序定位统一使用 gcj02，与腾讯地图生态一致
 */

// Haversine 球面距离算法，返回米
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

// 校验经纬度合法性
function isValidCoordinate(lat, lng) {
  return typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
}

// 判断坐标是否在中国大陆范围内（粗略）
function isInChinaMainland(lat, lng) {
  return lat >= 3.86 && lat <= 53.55 && lng >= 73.66 && lng <= 135.05
}

function normalizeAccuracy(res) {
  const accuracy = Number(res.horizontalAccuracy || res.accuracy)
  return Number.isFinite(accuracy) && accuracy >= 0 ? accuracy : -1
}

function toLocationSample(res, isPrecise) {
  return {
    latitude: res.latitude,
    longitude: res.longitude,
    accuracy: normalizeAccuracy(res),
    isPrecise,
    timestamp: Date.now()
  }
}

function callLocationApi(api, methodName, isPrecise) {
  return new Promise((resolve, reject) => {
    if (!api || typeof api[methodName] !== 'function') {
      reject(new Error(`${methodName} is not available`))
      return
    }

    const opts = {
      type: 'gcj02',
      success(res) {
        resolve(toLocationSample(res, isPrecise))
      },
      fail(err) {
        reject(err)
      }
    }

    // getLocation 支持 isHighAccuracy
    if (methodName === 'getLocation') {
      opts.isHighAccuracy = true
      opts.highAccuracyExpireTime = 4000
    }

    api[methodName](opts)
  })
}

async function requestBestLocation(api) {
  return callLocationApi(api, 'getLocation', true)
}

function supportsRealtimeLocation(api) {
  return !!(api && typeof api.startLocationUpdate === 'function' && typeof api.onLocationChange === 'function')
}

function collectRealtimeLocationSamples(api, count, timeoutMs) {
  return new Promise((resolve, reject) => {
    const samples = []
    let settled = false
    let timer = null
    let listener = null

    function cleanup() {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      if (listener && typeof api.offLocationChange === 'function') {
        api.offLocationChange(listener)
      }
      if (typeof api.stopLocationUpdate === 'function') {
        api.stopLocationUpdate({
          fail() {},
          success() {}
        })
      }
    }

    function finish(err) {
      if (settled) return
      settled = true
      cleanup()
      if (err) {
        reject(err)
        return
      }
      resolve(samples)
    }

    listener = (res) => {
      samples.push(toLocationSample(res, true))
      if (samples.length >= count) {
        finish()
      }
    }

    api.onLocationChange(listener)
    timer = setTimeout(() => finish(), timeoutMs)
    api.startLocationUpdate({
      type: 'gcj02',
      fail(err) {
        finish(err)
      },
      success() {}
    })
  })
}

/**
 * 多次采样定位，选取精度最优结果
 * @param {Object} api - wx 对象
 * @param {number} count - 采样次数（默认 3）
 * @param {number} delayMs - 采样间隔毫秒（默认 800）
 * @returns {Promise<Object>} 最优定位结果及全部采样
 */
async function sampleLocationAndPickBest(api, count, delayMs) {
  count = count || 3
  delayMs = delayMs || 800
  const samples = []

  if (supportsRealtimeLocation(api)) {
    try {
      const realtimeSamples = await collectRealtimeLocationSamples(
        api,
        count,
        Math.max(count * Math.max(delayMs, 800), 3500)
      )
      if (realtimeSamples.length > 0) {
        samples.push(...realtimeSamples)
      }
    } catch (err) {
      samples.push({ error: err.errMsg || err.message || 'realtime location failed', timestamp: Date.now() })
    }
  }

  for (let i = samples.length; i < count; i++) {
    try {
      const loc = await requestBestLocation(api)
      samples.push(loc)
    } catch (err) {
      samples.push({ error: err.errMsg || err.message || 'unknown', timestamp: Date.now() })
    }
    if (i < count - 1) {
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  // 过滤合法采样
  const validSamples = samples.filter(s =>
    !s.error && isValidCoordinate(s.latitude, s.longitude)
  )

  if (validSamples.length === 0) {
    const lastErr = samples.find(s => s.error)
    throw new Error(lastErr ? lastErr.error : '所有采样均失败')
  }

  // 按精度排序（accuracy 越小越好）
  validSamples.sort((a, b) => (a.accuracy || 9999) - (b.accuracy || 9999))
  const best = validSamples[0]

  return {
    latitude: best.latitude,
    longitude: best.longitude,
    accuracy: best.accuracy,
    isPrecise: best.isPrecise,
    timestamp: best.timestamp,
    sampleCount: samples.length,
    validCount: validSamples.length,
    allSamples: samples
  }
}

/**
 * 计算两点距离（米），并返回诊断信息
 */
function calculateDistanceMeters(lat1, lng1, lat2, lng2) {
  if (!isValidCoordinate(lat1, lng1) || !isValidCoordinate(lat2, lng2)) {
    return { distance: -1, valid: false, reason: '坐标无效' }
  }
  const distance = Math.round(haversineDistance(lat1, lng1, lat2, lng2) * 100) / 100
  return { distance, valid: true }
}

/**
 * 检查定位权限状态，返回诊断信息
 */
function checkLocationPermission() {
  return new Promise((resolve) => {
    wx.getSetting({
      success(res) {
        const precise = res.authSetting['scope.userLocation']
        resolve({
          preciseGranted: precise === true,
          preciseDenied: precise === false,
          fuzzyGranted: false,
          fuzzyDenied: false,
          neverAsked: precise === undefined
        })
      },
      fail() {
        resolve({ preciseGranted: false, preciseDenied: false, fuzzyGranted: false, fuzzyDenied: false, neverAsked: true })
      }
    })
  })
}

module.exports = {
  requestBestLocation,
  sampleLocationAndPickBest,
  calculateDistanceMeters,
  haversineDistance,
  isValidCoordinate,
  isInChinaMainland,
  checkLocationPermission
}
