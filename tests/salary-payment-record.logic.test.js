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

// ---- 奖惩发薪锁定口径（老板反馈：点删除提示已删除，但记录还在明细里）----
const {
  buildAdjustmentPayLockWhere,
  inheritAdjustmentScope
} = require('../cloudfunctions/salary/payment-record.logic')

// 只用到 exists，做一个可断言的假 command
const fakeCommand = { exists: (v) => ({ __op: 'exists', value: v }) }

test('月度奖惩的锁定判断必须排掉「按订单发薪」记录', () => {
  // markPaid 给按订单发薪的 SalaryPayments 也写了 month，
  // 不排掉就会把没按月发薪的月份误判成锁定 → 删除变冲正 → 老板看着像没删掉
  const where = buildAdjustmentPayLockWhere({
    orgId: 'org1',
    adjustment: { user_id: 'u1', month: '2026-08' },
    command: fakeCommand
  })
  assert.deepEqual(where, {
    org_id: 'org1',
    user_id: 'u1',
    paid: true,
    month: '2026-08',
    order_id: { __op: 'exists', value: false }
  })
})

test('订单奖惩的锁定判断只看该订单那笔发薪，不看月份', () => {
  const where = buildAdjustmentPayLockWhere({
    orgId: 'org1',
    adjustment: { user_id: 'u1', month: '2026-08', order_id: 'order-a' },
    command: fakeCommand
  })
  assert.deepEqual(where, {
    org_id: 'org1',
    user_id: 'u1',
    paid: true,
    order_id: 'order-a'
  })
  assert.equal(where.month, undefined)
})

test('冲正记录继承原记录的订单归属，否则订单模式详情页查不到这条冲正', () => {
  assert.deepEqual(
    inheritAdjustmentScope({ order_id: 'order-a', order_name: '订单A' }),
    { order_id: 'order-a', order_name: '订单A' }
  )
  assert.deepEqual(inheritAdjustmentScope({ order_id: 'order-a' }), { order_id: 'order-a', order_name: '' })
  assert.deepEqual(inheritAdjustmentScope({ month: '2026-08' }), {})
  assert.deepEqual(inheritAdjustmentScope(null), {})
})
