const test = require('node:test')
const assert = require('node:assert/strict')

const { getStartupSessionAction } = require('../miniprogram/app.logic')

test('getStartupSessionAction clears stale users without consent or token', () => {
  assert.equal(getStartupSessionAction({ user: null, hasConsent: false }), 'noop')
  assert.equal(getStartupSessionAction({ user: { _id: 'u1' }, hasConsent: false }), 'clear')
  assert.equal(getStartupSessionAction({ user: { _id: 'u1' }, hasConsent: true }), 'clear')
  assert.equal(getStartupSessionAction({ user: { _id: 'u1', session_token: 't1' }, hasConsent: true }), 'resume')
})