const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeFactorySettings
} = require('../cloudfunctions/attendance/factory-settings.logic')

test('normalizeFactorySettings rejects missing and unconfirmed factory coordinates', () => {
  assert.deepEqual(normalizeFactorySettings(null), {
    ok: false,
    msg: '工厂位置未设置，请联系管理员重新配置工厂位置'
  })

  assert.deepEqual(normalizeFactorySettings({
    factory_latitude: 38.2688,
    factory_longitude: 114.1889,
    geofence_radius: 100,
    coordinate_system: 'gcj02',
    location_source: 'unknown'
  }), {
    ok: false,
    msg: '工厂位置未确认，请联系管理员在设置页重新到现场获取并保存工厂位置'
  })
})

test('normalizeFactorySettings rejects the default placeholder coordinates until replaced', () => {
  assert.deepEqual(normalizeFactorySettings({
    factory_latitude: 39.9042,
    factory_longitude: 116.4074,
    geofence_radius: 100,
    coordinate_system: 'gcj02',
    location_source: 'on_site',
    location_confirmed: true
  }), {
    ok: false,
    msg: '当前工厂位置仍是默认占位坐标，请联系管理员重新到现场获取工厂位置'
  })
})

test('normalizeFactorySettings accepts confirmed gcj02 coordinates', () => {
  assert.deepEqual(normalizeFactorySettings({
    factory_latitude: 38.2688,
    factory_longitude: 114.1889,
    geofence_radius: 150,
    coordinate_system: 'gcj02',
    location_source: 'on_site',
    location_confirmed: true
  }), {
    ok: true,
    data: {
      factory_latitude: 38.2688,
      factory_longitude: 114.1889,
      geofence_radius: 150,
      coordinate_system: 'gcj02',
      location_source: 'on_site',
      location_confirmed: true,
      checkpoints: [],
      allowed_wifi_bssids: []
    }
  })
})

test('normalizeFactorySettings passes through checkpoints array', () => {
  const checkpoints = [
    { name: '大门', latitude: 38.2688, longitude: 114.1889, radius: 100 },
    { name: '车间', latitude: 38.2700, longitude: 114.1900, radius: 50 }
  ]
  const result = normalizeFactorySettings({
    factory_latitude: 38.2688,
    factory_longitude: 114.1889,
    geofence_radius: 100,
    coordinate_system: 'gcj02',
    location_source: 'on_site',
    location_confirmed: true,
    checkpoints: checkpoints
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.checkpoints, checkpoints)
})

test('normalizeFactorySettings passes through allowed_wifi_bssids', () => {
  const result = normalizeFactorySettings({
    factory_latitude: 38.2688,
    factory_longitude: 114.1889,
    geofence_radius: 100,
    coordinate_system: 'gcj02',
    location_source: 'on_site',
    location_confirmed: true,
    allowed_wifi_bssids: ['AA:BB:CC:DD:EE:FF']
  })
  assert.equal(result.ok, true)
  assert.deepEqual(result.data.allowed_wifi_bssids, ['AA:BB:CC:DD:EE:FF'])
})