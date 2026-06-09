const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  buildCheckpointPayload,
  createCheckpointDraft,
  normalizePayrollMode
} = require('../miniprogram/pages/boss/settings/settings.logic')

const root = path.join(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

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

test('normalizePayrollMode keeps only supported salary payroll modes', () => {
  assert.equal(normalizePayrollMode('monthly'), 'monthly')
  assert.equal(normalizePayrollMode('order'), 'order')
  assert.equal(normalizePayrollMode('weekly'), 'monthly')
  assert.equal(normalizePayrollMode(), 'monthly')
})

test('settings page exposes save action in the top-right header', () => {
  const source = read('miniprogram/pages/boss/settings/settings.wxml')
  const headerIndex = source.indexOf('class="page-header"')
  const saveIndex = source.indexOf('class="settings-header-save')

  assert.ok(headerIndex >= 0, 'settings page header should exist')
  assert.ok(saveIndex > headerIndex, 'save action should be inside the page header area')
  assert.match(source, /class="settings-header-save[^"]*"[\s\S]*bindtap="onSave"[\s\S]*\{\{loading \? '保存中' : '保存'\}\}/)
  assert.doesNotMatch(source, /bottom-action-bar[\s\S]*bindtap="onSave"/)
})
