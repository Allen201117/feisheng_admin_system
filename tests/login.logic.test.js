const test = require('node:test')
const assert = require('node:assert/strict')

const {
  pickLoginUser,
  validateLoginAttempt
} = require('../cloudfunctions/login/login.logic')

test('validateLoginAttempt requires factory code, name, phone and password', () => {
  assert.deepEqual(validateLoginAttempt({ factory_code: '', name: '', phone: '', password: '' }), {
    ok: false,
    msg: '请输入工厂码'
  })

  assert.deepEqual(validateLoginAttempt({ factory_code: 'HOME001', name: '', phone: '', password: '' }), {
    ok: false,
    msg: '请输入姓名'
  })

  assert.deepEqual(validateLoginAttempt({ factory_code: 'HOME001', name: '张三', phone: '', password: '' }), {
    ok: false,
    msg: '请输入手机号'
  })

  assert.deepEqual(validateLoginAttempt({ factory_code: 'HOME001', name: '张三', phone: '13800138000', password: '' }), {
    ok: false,
    msg: '请输入密码'
  })
})

test('pickLoginUser requires phone for first login accounts', () => {
  const result = pickLoginUser({
    name: '张三',
    phone: '',
    users: [
      { _id: 'u1', name: '张三', phone: '13800138000', password_changed: false, must_change_password: true }
    ]
  })

  assert.deepEqual(result, {
    ok: false,
    field: 'phone',
    msg: '首次登录请输入手机号'
  })
})

test('pickLoginUser allows later logins without phone', () => {
  const result = pickLoginUser({
    name: '张三',
    phone: '',
    users: [
      { _id: 'u1', name: '张三', phone: '13800138000', password_changed: true, must_change_password: false }
    ]
  })

  assert.equal(result.ok, true)
  assert.equal(result.user._id, 'u1')
})

test('pickLoginUser distinguishes wrong name, phone, and ambiguous later login', () => {
  assert.deepEqual(
    pickLoginUser({ name: '李四', phone: '', users: [] }),
    { ok: false, field: 'name', msg: '姓名错误' }
  )

  assert.deepEqual(
    pickLoginUser({
      name: '张三',
      phone: '13900139000',
      users: [
        { _id: 'u1', name: '张三', phone: '13800138000', password_changed: false, must_change_password: true }
      ]
    }),
    { ok: false, field: 'phone', msg: '手机号错误' }
  )

  assert.deepEqual(
    pickLoginUser({
      name: '张三',
      phone: '',
      users: [
        { _id: 'u1', name: '张三', phone: '13800138000', password_changed: true, must_change_password: false },
        { _id: 'u2', name: '张三', phone: '13900139000', password_changed: true, must_change_password: false }
      ]
    }),
    { ok: false, field: 'phone', msg: '该姓名存在多个账号，请输入手机号' }
  )
})
