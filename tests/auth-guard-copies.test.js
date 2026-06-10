const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

// 云函数按目录独立部署，auth-guard.js 在每个函数目录各有一份副本（同 beijing-time.js 模式）。
// 唯一真源是 cloudfunctions/common/auth-guard.js；本测试保证所有副本与真源字节一致，
// 防止鉴权口径再次漂移（历史上 9 份手写副本分裂成三档强度，是多个安全缺陷的根因）。

const ROOT = path.join(__dirname, '..', 'cloudfunctions')
const SOURCE_OF_TRUTH = path.join(ROOT, 'common', 'auth-guard.js')
const FUNCTION_DIRS = ['order', 'worklog', 'salary', 'export', 'qrcode', 'attendance', 'leaderboard', 'settings', 'user', 'platform']

test('every cloud function carries an auth-guard copy identical to common/', () => {
  const canonical = fs.readFileSync(SOURCE_OF_TRUTH, 'utf8')
  for (const dir of FUNCTION_DIRS) {
    const copyPath = path.join(ROOT, dir, 'auth-guard.js')
    assert.ok(fs.existsSync(copyPath), `${dir}/auth-guard.js 缺失`)
    assert.equal(fs.readFileSync(copyPath, 'utf8'), canonical, `${dir}/auth-guard.js 与 common/auth-guard.js 不一致`)
  }
})

test('business cloud functions require the shared auth-guard and have no openid fallback', () => {
  for (const dir of ['order', 'worklog', 'salary', 'export', 'qrcode', 'attendance', 'leaderboard', 'settings', 'user']) {
    const src = fs.readFileSync(path.join(ROOT, dir, 'index.js'), 'utf8')
    assert.match(src, /require\('\.\/auth-guard'\)/, `${dir}/index.js 未接入 auth-guard`)
    assert.doesNotMatch(src, /openid:\s*wxContext\.OPENID/, `${dir}/index.js 残留 openid 回退`)
  }
})

const { buildStrictAuthWhere } = require('../cloudfunctions/common/auth-guard')

test('buildStrictAuthWhere requires both credentials', () => {
  assert.equal(buildStrictAuthWhere({}), null)
  assert.equal(buildStrictAuthWhere({ auth_user_id: 'u1' }), null)
  assert.equal(buildStrictAuthWhere({ auth_session_token: 't' }), null)
  assert.deepEqual(buildStrictAuthWhere({ auth_user_id: 'u1', auth_session_token: 't' }), {
    _id: 'u1',
    session_token: 't',
    status: 'active'
  })
})
