const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getMonthKeyFromDate,
  buildPaidMonthSet,
  selectRepriceableWorklogs
} = require('../cloudfunctions/order/reprice-worklogs')

test('getMonthKeyFromDate extracts YYYY-MM', () => {
  assert.equal(getMonthKeyFromDate('2026-03-10'), '2026-03')
  assert.equal(getMonthKeyFromDate(''), '')
})

test('buildPaidMonthSet stores only paid records', () => {
  const result = buildPaidMonthSet([
    { user_id: 'u1', month: '2026-03', paid: true },
    { user_id: 'u1', month: '2026-04', paid: false },
    { user_id: 'u2', month: '2026-03', paid: true }
  ])

  assert.equal(result.has('u1::2026-03'), true)
  assert.equal(result.has('u1::2026-04'), false)
  assert.equal(result.has('u2::2026-03'), true)
})

test('selectRepriceableWorklogs returns all unpaid worklogs regardless of original snapshot price', () => {
  const paidMonthSet = buildPaidMonthSet([
    { user_id: 'u1', month: '2026-03', paid: true }
  ])

  const result = selectRepriceableWorklogs([
    { _id: 'l1', user_id: 'u1', date: '2026-03-10', snapshot_price: 0, quantity: 10 },
    { _id: 'l2', user_id: 'u1', date: '2026-04-10', snapshot_price: 0, quantity: 10 },
    { _id: 'l3', user_id: 'u2', date: '2026-03-10', snapshot_price: 0, quantity: 10 },
    { _id: 'l4', user_id: 'u2', date: '2026-03-10', snapshot_price: 2, quantity: 10 }
  ], paidMonthSet)

  assert.deepEqual(result.map(item => item._id), ['l2', 'l3', 'l4'])
})
