const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')
const read = (file) => fs.readFileSync(path.join(root, file), 'utf8')

const {
  filterRankListForViewer
} = require('../cloudfunctions/leaderboard/privacy.logic')

test('employee private leaderboard returns only their own ranked row', () => {
  const list = [
    { user_id: 'u1', user_name: '张三', rank: 1, rank_value: 120 },
    { user_id: 'u2', user_name: '李四', rank: 2, rank_value: 90 },
    { user_id: 'u3', user_name: '王五', rank: 3, rank_value: 30 }
  ]

  const result = filterRankListForViewer(list, {
    caller: { _id: 'u2', role: 'employee' },
    leaderboardVisible: false
  })

  assert.equal(result.visibility, 'self')
  assert.equal(result.total_employees, 3)
  assert.deepEqual(result.list, [
    { user_id: 'u2', user_name: '李四', rank: 2, rank_value: 90 }
  ])
})

test('employee public leaderboard returns the whole ranked list', () => {
  const list = [
    { user_id: 'u1', rank: 1 },
    { user_id: 'u2', rank: 2 }
  ]

  const result = filterRankListForViewer(list, {
    caller: { _id: 'u2', role: 'employee' },
    leaderboardVisible: true
  })

  assert.equal(result.visibility, 'public')
  assert.equal(result.total_employees, 2)
  assert.deepEqual(result.list, list)
})

test('boss always receives the whole ranked list regardless of public setting', () => {
  const list = [
    { user_id: 'u1', rank: 1 },
    { user_id: 'u2', rank: 2 }
  ]

  const result = filterRankListForViewer(list, {
    caller: { _id: 'boss1', role: 'boss' },
    leaderboardVisible: false
  })

  assert.equal(result.visibility, 'boss')
  assert.equal(result.total_employees, 2)
  assert.deepEqual(result.list, list)
})

test('employee home keeps leaderboard entry visible for self ranking', () => {
  const wxml = read('miniprogram/pages/employee/home/home.wxml')
  assert.doesNotMatch(wxml, /bindtap="goToLeaderboard"[^>]*wx:if="\{\{leaderboardVisible\}\}"/)
})

test('leaderboard visibility switch is owned by boss leaderboard page', () => {
  const bossLeaderboard = read('miniprogram/pages/boss/leaderboard/leaderboard.wxml')
  const settings = read('miniprogram/pages/boss/settings/settings.wxml')

  assert.match(bossLeaderboard, /data-field="leaderboard_visible"/)
  assert.doesNotMatch(settings, /data-field="leaderboard_visible"/)
})

test('employee leaderboard page no longer blocks self ranking when leaderboard is private', () => {
  const wxml = read('miniprogram/pages/employee/leaderboard/leaderboard.wxml')
  assert.doesNotMatch(wxml, /排行榜暂未开放/)
  assert.match(wxml, /仅显示我的排名/)
})
