/**
 * 定位系统数据库迁移脚本
 * 
 * 功能：
 * 1. 为 factory_settings 添加坐标元数据字段
 * 2. 创建 sign_location_logs 集合
 * 3. 检查并标记历史工厂坐标来源不明数据
 * 
 * 使用方式：在云函数 init 中调用 migrateLocationData()
 * 
 * 安全策略：
 * - 不自动转换任何坐标（无法确认历史来源）
 * - 仅添加元数据标记
 * - 保留旧字段，新旧双写过渡
 */

const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

async function migrateLocationData() {
  const results = []

  // === 步骤1：为 factory_settings 补充坐标元数据 ===
  try {
    const settingsRes = await db.collection('factory_settings').doc('main').get()
    const settings = settingsRes.data

    const updates = {}
    let needsUpdate = false

    // 如果没有 coordinate_system 字段，标记为 unknown 待人工确认
    if (!settings.coordinate_system) {
      updates.coordinate_system = 'unknown_legacy'
      needsUpdate = true
    }
    if (!settings.location_source) {
      updates.location_source = 'unknown_legacy'
      needsUpdate = true
    }
    if (!settings.location_updated_at) {
      updates.location_updated_at = settings.updated_at || db.serverDate()
      needsUpdate = true
    }

    // 检查坐标合理性
    const lat = Number(settings.factory_latitude)
    const lng = Number(settings.factory_longitude)
    const coordCheck = {
      hasCoord: !!(lat && lng),
      isValidRange: lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180,
      isInChina: lat >= 3.86 && lat <= 53.55 && lng >= 73.66 && lng <= 135.05,
      isDefaultBeijing: lat === 39.9042 && lng === 116.4074,
      lat,
      lng
    }

    if (coordCheck.isDefaultBeijing) {
      updates.location_remark = '当前为默认北京坐标，需要老板到工厂现场重新采集'
      needsUpdate = true
    } else if (!coordCheck.isInChina && coordCheck.hasCoord) {
      updates.location_remark = '坐标不在中国大陆范围，可能是WGS84或坐标有误，需人工确认'
      needsUpdate = true
    }

    if (needsUpdate) {
      await db.collection('factory_settings').doc('main').update({ data: updates })
    }

    results.push({
      step: 'factory_settings_metadata',
      status: 'ok',
      coordCheck,
      updated: needsUpdate,
      fields: Object.keys(updates)
    })
  } catch (e) {
    results.push({
      step: 'factory_settings_metadata',
      status: 'error',
      error: e.message
    })
  }

  // === 步骤2：确保 sign_location_logs 集合存在 ===
  // 微信云开发不支持脚本创建集合，需手动在控制台创建
  // 这里只记录建议
  results.push({
    step: 'sign_location_logs_collection',
    status: 'manual_action_required',
    instruction: '请在微信云开发控制台手动创建集合 sign_location_logs',
    suggestedIndexes: [
      { field: 'user_id', order: 'asc' },
      { field: 'created_at', order: 'desc' },
      { field: 'location_status', order: 'asc' },
      { field: 'priority', order: 'asc' }
    ],
    suggestedFields: [
      'user_id', 'action', 'latitude_gcj02', 'longitude_gcj02',
      'accuracy', 'location_time', 'factory_latitude_gcj02', 'factory_longitude_gcj02',
      'distance_meters', 'sign_radius_meters', 'device_info', 'source',
      'location_status', 'fail_reason', 'priority', 'raw_payload', 'created_at'
    ]
  })

  // === 步骤3：扫描历史考勤记录，检查坐标数据质量 ===
  try {
    const attendanceRes = await db.collection('Attendances')
      .orderBy('created_at', 'desc')
      .limit(100)
      .get()

    let missingLocation = 0
    let invalidLocation = 0
    let totalChecked = 0

    for (const record of attendanceRes.data) {
      totalChecked++
      const loc = record.clock_in_location
      if (!loc || (!loc.latitude && !loc.longitude)) {
        missingLocation++
      } else if (loc.latitude === 0 && loc.longitude === 0) {
        invalidLocation++
      }
    }

    results.push({
      step: 'attendance_data_quality',
      status: 'ok',
      totalChecked,
      missingLocation,
      invalidLocation,
      recommendation: missingLocation + invalidLocation > 0
        ? '存在缺失/异常的定位数据，建议排查这些记录'
        : '历史考勤定位数据正常'
    })
  } catch (e) {
    results.push({
      step: 'attendance_data_quality',
      status: 'error',
      error: e.message
    })
  }

  return {
    code: 0,
    msg: '迁移检查完成',
    results,
    nextSteps: [
      '1. 在云开发控制台创建 sign_location_logs 集合',
      '2. 如果 factory_settings.coordinate_system 为 unknown_legacy，请老板到工厂现场重新获取位置',
      '3. 如果坐标是默认北京坐标，必须重新设置',
      '4. 部署更新后的 attendance 和 settings 云函数'
    ]
  }
}

module.exports = { migrateLocationData }
