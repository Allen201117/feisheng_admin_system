const test = require('node:test')
const assert = require('node:assert/strict')

const {
  sanitizeSettingsRecord,
  canSaveSettings,
  normalizeCheckpoints,
  buildLeaderboardVisibilitySettingsData
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
      salary_payroll_mode: 'monthly',
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

test('sanitizeSettingsRecord defaults payroll mode to monthly and preserves order mode', () => {
  assert.equal(sanitizeSettingsRecord({}).salary_payroll_mode, 'monthly')
  assert.equal(sanitizeSettingsRecord({ salary_payroll_mode: 'order' }).salary_payroll_mode, 'order')
  assert.equal(sanitizeSettingsRecord({ salary_payroll_mode: 'bad-value' }).salary_payroll_mode, 'monthly')
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

test('buildLeaderboardVisibilitySettingsData preserves settings but never writes immutable _id', () => {
  const result = buildLeaderboardVisibilitySettingsData({
    _id: 'org_home',
    org_id: 'org_home',
    factory_latitude: 38.2,
    leaderboard_visible: false,
    salary_payroll_mode: 'order'
  }, {
    orgId: 'org_home',
    leaderboardVisible: true,
    updatedAt: 'SERVER_DATE'
  })

  assert.equal(Object.prototype.hasOwnProperty.call(result, '_id'), false)
  assert.equal(result.org_id, 'org_home')
  assert.equal(result.factory_latitude, 38.2)
  assert.equal(result.salary_payroll_mode, 'order')
  assert.equal(result.leaderboard_visible, true)
  assert.equal(result.updated_at, 'SERVER_DATE')
})
