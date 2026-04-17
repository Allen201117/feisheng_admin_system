const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildCheckpointPayload,
  createCheckpointDraft
} = require('../miniprogram/pages/boss/settings/settings.logic')

test('createCheckpointDraft returns a usable empty checkpoint', () => {
  assert.deepEqual(createCheckpointDraft(), {
    name: '',
    latitude: '',
    longitude: '',
    radius: '100'
  })
})

test('buildCheckpointPayload combines main point and additional checkpoints with global radius', () => {
  assert.deepEqual(
    buildCheckpointPayload({
      factory_latitude: '38.2688',
      factory_longitude: '114.1889',
      geofence_radius: '100',
      checkpoints: [
        { name: '车间A', latitude: '38.2691', longitude: '114.1894', radius: '80' },
        { name: '', latitude: '', longitude: '', radius: '100' }
      ]
    }),
    [
      { name: '主打卡点', latitude: 38.2688, longitude: 114.1889, radius: 100 },
      { name: '车间A', latitude: 38.2691, longitude: 114.1894, radius: 100 }
    ]
  )
})