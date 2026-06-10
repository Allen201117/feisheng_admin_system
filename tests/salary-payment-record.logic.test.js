const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildSalaryPaymentDocId,
  buildSalaryPaymentCreateData
} = require('../cloudfunctions/salary/payment-record.logic')

test('buildSalaryPaymentDocId scopes deterministic id by org, user, and month', () => {
  assert.equal(
    buildSalaryPaymentDocId({ orgId: 'org_home', userId: 'user_1', month: '2026-05' }),
    'org_home_user_1_2026-05'
  )
})

test('buildSalaryPaymentDocId scopes order payroll by org, user, and order', () => {
  assert.equal(
    buildSalaryPaymentDocId({ orgId: 'org_home', userId: 'user_1', month: '2026-05', orderId: 'order_88' }),
    'org_home_user_1_order_order_88'
  )
})

test('buildSalaryPaymentCreateData does not include immutable _id in set data', () => {
  const result = buildSalaryPaymentCreateData({
    orgId: 'org_home',
    userId: 'user_1',
    userName: '张三',
    month: '2026-05',
    caller: { _id: 'boss_1', name: '老板' },
    serverDate: () => 'SERVER_DATE'
  })

  assert.equal(Object.prototype.hasOwnProperty.call(result, '_id'), false)
  assert.deepEqual(result, {
    org_id: 'org_home',
    user_id: 'user_1',
    user_name: '张三',
    month: '2026-05',
    paid: true,
    paid_at: 'SERVER_DATE',
    operator_id: 'boss_1',
    operator_name: '老板',
    created_at: 'SERVER_DATE'
  })
})

test('buildSalaryPaymentCreateData stores order payroll context', () => {
  const result = buildSalaryPaymentCreateData({
    orgId: 'org_home',
    userId: 'user_1',
    userName: '张三',
    month: '2026-05',
    orderId: 'order_88',
    orderName: '8号1楼',
    caller: { _id: 'boss_1', name: '老板' },
    serverDate: () => 'SERVER_DATE'
  })

  assert.equal(result.order_id, 'order_88')
  assert.equal(result.order_name, '8号1楼')
  assert.equal(result.payroll_type, 'order')
})

const { isOrderFullyPaid } = require('../cloudfunctions/salary/payment-record.logic')

test('isOrderFullyPaid true only when every participant is paid', () => {
  assert.equal(isOrderFullyPaid({ participantUserIds: ['u1', 'u2'], paidUserIds: ['u1', 'u2'] }), true)
  assert.equal(isOrderFullyPaid({ participantUserIds: ['u1', 'u2'], paidUserIds: ['u1'] }), false)
  assert.equal(isOrderFullyPaid({ participantUserIds: [], paidUserIds: [] }), false)
  assert.equal(isOrderFullyPaid({ participantUserIds: ['u1'], paidUserIds: ['u1', 'u9'] }), true)
})
