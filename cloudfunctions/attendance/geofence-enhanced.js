/**
 * 增强地理围栏模块 — 分层判定 + 多信号融合 + 可解释结果
 *
 * 设计原则：
 * 1. 坐标系统一为 GCJ-02（中国大陆标准）
 * 2. 支持多个合法打卡点 / 多层围栏
 * 3. 多次采样质量评估
 * 4. 定位差时返回"重试/复核"而非直接拒绝
 * 5. 每次打卡产出完整判定日志
 */

// ---- Haversine 距离计算（米） ----
function haversineDistance(lat1, lon1, lat2, lon2) {
  var R = 6371000
  var dLat = (lat2 - lat1) * Math.PI / 180
  var dLon = (lon2 - lon1) * Math.PI / 180
  var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) * Math.sin(dLon / 2)
  var c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  return R * c
}

function toNumber(value) {
  var parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

// ---- 定位质量评分 ----

/**
 * 评估一组采样的质量
 * @param {Array} samples - [{latitude, longitude, accuracy, timestamp, error}]
 * @returns {{score: number, level: string, details: Object}}
 *   score: 0-100, level: 'excellent'|'good'|'fair'|'poor'|'unusable'
 */
function evaluateLocationQuality(samples) {
  if (!samples || samples.length === 0) {
    return {
      score: 0,
      level: 'unusable',
      details: { reason: '无有效采样' }
    }
  }

  // 兼容缩写字段名（home.js 发送 {lat,lng,acc,err,t}）
  var normalized = samples.map(function(s) {
    if (!s) return s
    return {
      latitude: s.latitude !== undefined ? s.latitude : s.lat,
      longitude: s.longitude !== undefined ? s.longitude : s.lng,
      accuracy: s.accuracy !== undefined ? s.accuracy : s.acc,
      error: s.error !== undefined ? s.error : s.err,
      timestamp: s.timestamp !== undefined ? s.timestamp : s.t
    }
  })

  var validSamples = normalized.filter(function(s) {
    return s && !s.error && typeof s.latitude === 'number' && typeof s.longitude === 'number'
  })

  if (validSamples.length === 0) {
    return {
      score: 0,
      level: 'unusable',
      details: { reason: '所有采样均失败', totalSamples: samples.length, validSamples: 0 }
    }
  }

  var scoreComponents = {}
  var totalScore = 0

  // 1. 精度得分 (0-40分)
  var bestAccuracy = Infinity
  var avgAccuracy = 0
  validSamples.forEach(function(s) {
    var acc = s.accuracy || 9999
    if (acc < bestAccuracy) bestAccuracy = acc
    avgAccuracy += acc
  })
  avgAccuracy = avgAccuracy / validSamples.length

  var accuracyScore
  if (bestAccuracy <= 30) accuracyScore = 40
  else if (bestAccuracy <= 65) accuracyScore = 35
  else if (bestAccuracy <= 100) accuracyScore = 25
  else if (bestAccuracy <= 200) accuracyScore = 15
  else if (bestAccuracy <= 500) accuracyScore = 5
  else accuracyScore = 0

  scoreComponents.accuracy = { score: accuracyScore, bestAccuracy: Math.round(bestAccuracy), avgAccuracy: Math.round(avgAccuracy) }
  totalScore += accuracyScore

  // 2. 采样一致性得分 (0-30分) - 多次采样结果的离散程度
  var consistencyScore = 0
  if (validSamples.length >= 2) {
    var maxSpread = 0
    for (var i = 0; i < validSamples.length; i++) {
      for (var j = i + 1; j < validSamples.length; j++) {
        var spread = haversineDistance(
          validSamples[i].latitude, validSamples[i].longitude,
          validSamples[j].latitude, validSamples[j].longitude
        )
        if (spread > maxSpread) maxSpread = spread
      }
    }

    if (maxSpread <= 30) consistencyScore = 30
    else if (maxSpread <= 80) consistencyScore = 25
    else if (maxSpread <= 200) consistencyScore = 15
    else if (maxSpread <= 500) consistencyScore = 8
    else consistencyScore = 0

    scoreComponents.consistency = { score: consistencyScore, maxSpreadMeters: Math.round(maxSpread) }
  } else {
    consistencyScore = 15 // 单次采样给中间分
    scoreComponents.consistency = { score: consistencyScore, note: '仅单次采样' }
  }
  totalScore += consistencyScore

  // 3. 有效采样率得分 (0-15分)
  var validRate = validSamples.length / samples.length
  var validRateScore
  if (validRate >= 1.0) validRateScore = 15
  else if (validRate >= 0.66) validRateScore = 10
  else if (validRate >= 0.33) validRateScore = 5
  else validRateScore = 0

  scoreComponents.validRate = { score: validRateScore, rate: Math.round(validRate * 100) + '%' }
  totalScore += validRateScore

  // 4. 采样数量得分 (0-15分)
  var countScore
  if (validSamples.length >= 5) countScore = 15
  else if (validSamples.length >= 3) countScore = 12
  else if (validSamples.length >= 2) countScore = 8
  else countScore = 3

  scoreComponents.sampleCount = { score: countScore, count: validSamples.length }
  totalScore += countScore

  // 评级
  var level
  if (totalScore >= 80) level = 'excellent'
  else if (totalScore >= 60) level = 'good'
  else if (totalScore >= 40) level = 'fair'
  else if (totalScore >= 20) level = 'poor'
  else level = 'unusable'

  return {
    score: totalScore,
    level: level,
    details: scoreComponents
  }
}

// ---- 多打卡点围栏评估 ----

/**
 * 评估员工位置与多个打卡点的关系
 * @param {Object} options
 *   - latitude, longitude: 员工位置 (GCJ-02)
 *   - checkpoints: [{name, latitude, longitude, radius}] 合法打卡点列表
 *                  如果为空，使用 factoryLatitude/factoryLongitude/radius 兼容旧配置
 *   - factoryLatitude, factoryLongitude, radius: 旧版单点配置（兼容）
 * @returns {Object} 判定结果
 */
function evaluateGeofenceMultiPoint(options) {
  var empLat = toNumber(options.latitude)
  var empLng = toNumber(options.longitude)

  // 构建打卡点列表（兼容旧版单点配置）
  var checkpoints = options.checkpoints
  if (!checkpoints || checkpoints.length === 0) {
    checkpoints = [{
      name: '工厂',
      latitude: toNumber(options.factoryLatitude),
      longitude: toNumber(options.factoryLongitude),
      radius: toNumber(options.radius) || 100
    }]
  }

  // 计算到每个打卡点的距离
  var results = checkpoints.map(function(cp) {
    var dist = haversineDistance(empLat, empLng, cp.latitude, cp.longitude)
    return {
      name: cp.name || '打卡点',
      latitude: cp.latitude,
      longitude: cp.longitude,
      radius: cp.radius || 100,
      distance: Math.round(dist * 100) / 100,
      withinFence: dist <= (cp.radius || 100)
    }
  })

  // 找到最近的打卡点
  results.sort(function(a, b) { return a.distance - b.distance })
  var nearest = results[0]
  var anyMatch = results.some(function(r) { return r.withinFence })

  return {
    withinFence: anyMatch,
    nearestCheckpoint: nearest,
    allCheckpoints: results,
    employeeLocation: { latitude: empLat, longitude: empLng },
    matchedCheckpoint: anyMatch ? results.find(function(r) { return r.withinFence }) : null
  }
}

// ---- 兼容旧版 evaluateGeofence ----

function evaluateGeofence(options) {
  var result = evaluateGeofenceMultiPoint(options)
  var nearest = result.nearestCheckpoint || {}
  return {
    distance: nearest.distance || 0,
    radius: nearest.radius || 100,
    withinFence: result.withinFence,
    employeeLocation: result.employeeLocation,
    factoryLocation: {
      latitude: nearest.latitude || 0,
      longitude: nearest.longitude || 0
    }
  }
}

// ---- 精度容差计算 ----

/**
 * 根据 GPS 精度计算围栏容差缓冲。
 * 原理：GPS accuracy 代表 68% 置信半径，将其一半作为容差补偿，
 * 同时设置上限防止滥用。
 * @param {number} accuracy - GPS 精度（米），越小越好
 * @returns {number} 容差缓冲（米）
 */
function accuracyBuffer(accuracy) {
  var acc = Number(accuracy)
  if (!Number.isFinite(acc) || acc <= 0) return 50 // 未知精度给默认容差
  return Math.min(Math.round(acc * 0.5), 200)      // 半精度，上限 200m
}

// ---- 综合打卡判定（v2: 容差式，参考钉钉/企业微信模式） ----

/**
 * 综合打卡判定 v2
 *
 * 核心改动（相比 v1）：
 *   - 定位质量仅用于日志诊断，**不再作为通过/重试的门槛**
 *   - 围栏判定 = 距离 ≤ 打卡点半径 + accuracyBuffer(精度)
 *   - 仅在 GPS 完全无效（零有效采样）时才返回 retry
 *   - 其余一律给出确定性结果：approved / rejected
 *
 * @param {Object} options
 *   - latitude, longitude: 最终采用的员工位置
 *   - accuracy: 定位精度（米）
 *   - allSamples: 所有采样结果数组
 *   - checkpoints / factoryLatitude/factoryLongitude/radius: 打卡点
 *   - wifiBSSID, allowedBSSIDs: Wi-Fi 辅助（可选）
 * @returns {Object} 判定结果
 */
function comprehensiveCheckIn(options) {
  var result = {
    status: 'unknown',    // 'approved' | 'rejected' | 'retry'
    reason: '',
    confidence: 0,        // 0-100
    locationQuality: null,
    geofenceResult: null,
    wifiMatch: false,
    signals: [],
    suggestion: ''
  }

  // 1. 定位质量评估（仅诊断 / 日志，不影响判定）
  var quality = evaluateLocationQuality(options.allSamples || [])
  result.locationQuality = quality

  // 1b. GPS 完全不可用 + 主坐标也无效 → 唯一的 retry 场景
  var mainLat = toNumber(options.latitude)
  var mainLng = toNumber(options.longitude)
  if (quality.level === 'unusable' && (mainLat === 0 && mainLng === 0)) {
    result.status = 'retry'
    result.reason = 'GPS无法获取有效位置'
    result.confidence = 0
    result.suggestion = '定位失败，请检查：\n1. 手机GPS是否开启\n2. 是否授予微信定位权限\n3. 到室外空旷处重试'
    result.signals.push('gps_broken')
    return result
  }

  // 2. 地理围栏评估
  var geoResult = evaluateGeofenceMultiPoint(options)
  result.geofenceResult = geoResult

  // 3. Wi-Fi 信号匹配
  var wifiMatch = false
  if (options.wifiBSSID && options.allowedBSSIDs && options.allowedBSSIDs.length > 0) {
    var normalizedBSSID = String(options.wifiBSSID).toLowerCase().trim()
    wifiMatch = options.allowedBSSIDs.some(function(b) {
      return String(b).toLowerCase().trim() === normalizedBSSID
    })
    result.wifiMatch = wifiMatch
    if (wifiMatch) {
      result.signals.push('wifi_match')
    }
  }

  // 4. 判定逻辑（容差式）
  var accVal = toNumber(options.accuracy)
  var distance = (geoResult.nearestCheckpoint && geoResult.nearestCheckpoint.distance) || 0
  var radius = (geoResult.nearestCheckpoint && geoResult.nearestCheckpoint.radius) || 100
  var buffer = accuracyBuffer(accVal)
  var effectiveRadius = radius + buffer

  // Wi-Fi 命中 + 在 1.5 倍围栏内 → 直接通过
  if (wifiMatch && distance <= radius * 1.5) {
    result.status = 'approved'
    result.reason = 'Wi-Fi命中且在围栏范围内'
    result.confidence = 95
    result.signals.push('wifi_override')
    return result
  }

  // 主判定：距离 ≤ effectiveRadius → 通过
  if (distance <= effectiveRadius) {
    result.status = 'approved'
    result.reason = '在打卡范围内'
    result.confidence = distance <= radius ? 90 : 70
    result.signals.push('geofence_pass')
    if (buffer > 0 && distance > radius) {
      result.signals.push('accuracy_buffer_used')
    }
    return result
  }

  // 超出有效围栏 → 拒绝，附距离信息
  result.status = 'rejected'
  result.reason = '不在打卡范围内（距离' + Math.round(distance) + '米，允许' + Math.round(effectiveRadius) + '米）'
  result.confidence = quality.score >= 60 ? 80 : 50
  if (accVal > 200) {
    result.suggestion = '当前GPS精度约' + Math.round(accVal) + '米，建议到室外空旷处、开启GPS后重试'
  }
  result.signals.push('out_of_geofence')
  return result
}

// ---- 构建完整判定日志 ----

/**
 * 构建一条打卡判定的完整日志
 */
function buildCheckInLog(options, checkResult) {
  var geoResult = checkResult.geofenceResult || {}
  var nearest = geoResult.nearestCheckpoint || {}
  var quality = checkResult.locationQuality || {}

  return {
    // 原始定位
    raw_latitude: toNumber(options.latitude),
    raw_longitude: toNumber(options.longitude),
    coordinate_system: 'gcj02',
    accuracy: toNumber(options.accuracy),

    // 采样信息
    sample_count: (options.allSamples || []).length,
    valid_sample_count: (options.allSamples || []).filter(function(s) {
      if (!s) return false
      var err = s.error !== undefined ? s.error : s.err
      return !err
    }).length,
    all_samples_json: JSON.stringify((options.allSamples || []).map(function(s) {
      if (!s) return s
      return {
        lat: s.latitude !== undefined ? s.latitude : s.lat,
        lng: s.longitude !== undefined ? s.longitude : s.lng,
        acc: s.accuracy !== undefined ? s.accuracy : s.acc,
        err: s.error !== undefined ? s.error : s.err,
        t: s.timestamp !== undefined ? s.timestamp : s.t
      }
    })),

    // 最终采用的定位
    final_latitude: toNumber(options.latitude),
    final_longitude: toNumber(options.longitude),

    // 围栏信息
    nearest_checkpoint_name: nearest.name || '',
    nearest_checkpoint_lat: nearest.latitude || 0,
    nearest_checkpoint_lng: nearest.longitude || 0,
    nearest_checkpoint_radius: nearest.radius || 0,
    distance_to_nearest: nearest.distance || 0,
    within_fence: geoResult.withinFence || false,
    checkpoint_count: (geoResult.allCheckpoints || []).length,

    // Wi-Fi 信号
    wifi_bssid: options.wifiBSSID || '',
    wifi_matched: checkResult.wifiMatch || false,

    // 定位质量
    quality_score: quality.score || 0,
    quality_level: quality.level || 'unknown',
    quality_details_json: JSON.stringify(quality.details || {}),

    // 判定结果
    check_status: checkResult.status,
    check_reason: checkResult.reason,
    check_confidence: checkResult.confidence,
    check_signals: (checkResult.signals || []).join(','),
    suggestion: checkResult.suggestion || ''
  }
}

module.exports = {
  haversineDistance: haversineDistance,
  evaluateGeofence: evaluateGeofence,
  evaluateGeofenceMultiPoint: evaluateGeofenceMultiPoint,
  evaluateLocationQuality: evaluateLocationQuality,
  accuracyBuffer: accuracyBuffer,
  comprehensiveCheckIn: comprehensiveCheckIn,
  buildCheckInLog: buildCheckInLog
}
