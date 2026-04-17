const test = require('node:test')
const assert = require('node:assert/strict')

const { buildStrictAuthWhere } = require('../cloudfunctions/user/auth.logic')

test('buildStrictAuthWhere returns a strict session query only when both credentials exist', () => {
  assert.equal(buildStrictAuthWhere({}), null)
  assert.equal(buildStrictAuthWhere({ auth_user_id: 'u1' }), null)
  assert.equal(buildStrictAuthWhere({ auth_session_token: 't1' }), null)

  assert.deepEqual(buildStrictAuthWhere({ auth_user_id: 'u1', auth_session_token: 't1' }), {
    _id: 'u1',
    session_token: 't1',
    status: 'active'
  })
})