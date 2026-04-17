const test = require('node:test')
const assert = require('node:assert/strict')

const {
  sanitizeSettingsRecord,
  canSaveSettings,
  normalizeCheckpoints
} = require('../cloudfunctions/settings/settings.logic')

test('sanitizeSettingsRecord normalizes legacy qr code expiry fields', () => {
  assert.deepEqual(
    sanitizeSettingsRecord({
      factory_latitude: 38.2,
      factory_longitude: 114.1,
      qrcode_expire_hours: 48
    }),
    {
      factory_latitude: 38.2,
      factory_longitude: 114.1,
      qrcode_expire_hours: 48,
      qrcode_expire_days: 2,
      face_recognition_enabled: false,
      allow_home_checkin: false,
      checkpoints: [
        {
          name: '主打卡点',
          latitude: 38.2,
          longitude: 114.1,
          radius: 100
        }
      ]
    }
  )
})

test('canSaveSettings fails closed when settings are not loaded', () => {
  assert.deepEqual(canSaveSettings({ loaded: false }), {
    ok: false,
    msg: '设置未加载完成，暂不能保存'
  })

  assert.deepEqual(canSaveSettings({ loaded: true }), { ok: true })
})

test('normalizeCheckpoints backfills from single-point settings and normalizes checkpoint radius', () => {
  assert.deepEqual(
    normalizeCheckpoints({
      factory_latitude: 38.2688,
      factory_longitude: 114.1889,
      geofence_radius: 100,
      checkpoints: [
        { name: '车间A', latitude: '38.2691', longitude: '114.1894', radius: '80' }
      ]
    }),
    [
      { name: '主打卡点', latitude: 38.2688, longitude: 114.1889, radius: 100 },
      { name: '车间A', latitude: 38.2691, longitude: 114.1894, radius: 80 }
    ]
  )
})