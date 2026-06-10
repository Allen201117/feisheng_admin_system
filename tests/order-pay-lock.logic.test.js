const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getMonthKey,
  buildPaidSets,
  isWorklogPaid,
  findPaidWorklogs,
  isOrderCompleted,
  buildPaidConflictPreview
} = require('../cloudfunctions/order/pay-lock.logic')

test('getMonthKey extracts YYYY-MM', () => {
  assert.equal(getMonthKey('2026-03-10'), '2026-03')
  assert.equal(getMonthKey(''), '')
  assert.equal(getMonthKey(null), '')
})

test('buildPaidSets splits month-mode and order-mode paid records', () => {
  const sets = buildPaidSets([
    { user_id: 'u1', month: '2026-03', paid: true },
    { user_id: 'u1', month: '2026-04', paid: false },
    { user_id: 'u2', order_id: 'o9', paid: true, payroll_type: 'order' },
    { user_id: 'u3', month: '2026-03', order_id: 'o9', paid: true }
  ])
  assert.equal(sets.monthSet.has('u1::2026-03'), true)
  assert.equal(sets.monthSet.has('u1::2026-04'), false)
  assert.equal(sets.orderSet.has('u2::o9'), true)
  assert.equal(sets.monthSet.has('u3::2026-03'), true)
  assert.equal(sets.orderSet.has('u3::o9'), true)
})

test('isWorklogPaid matches by month or by order', () => {
  const sets = buildPaidSets([
    { user_id: 'u1', month: '2026-03', paid: true },
    { user_id: 'u2', order_id: 'o9', paid: true }
  ])
  // month-mode hit
  assert.equal(isWorklogPaid({ user_id: 'u1', date: '2026-03-10', order_id: 'oX' }, sets), true)
  // order-mode hit (different month, but order paid)
  assert.equal(isWorklogPaid({ user_id: 'u2', date: '2026-05-01', order_id: 'o9' }, sets), true)
  // no hit
  assert.equal(isWorklogPaid({ user_id: 'u1', date: '2026-04-10', order_id: 'oX' }, sets), false)
  assert.equal(isWorklogPaid({ user_id: 'u9', date: '2026-03-10', order_id: 'o9' }, sets), false)
})

test('findPaidWorklogs returns deduped conflicts only for paid worklogs', () => {
  const sets = buildPaidSets([
    { user_id: 'u1', month: '2026-03', paid: true },
    { user_id: 'u2', order_id: 'o9', paid: true }
  ])
  const conflicts = findPaidWorklogs([
    { _id: 'l1', user_id: 'u1', user_name: '张三', date: '2026-03-01', order_id: 'o1' },
    { _id: 'l2', user_id: 'u1', user_name: '张三', date: '2026-03-20', order_id: 'o1' }, // same user+month -> deduped
    { _id: 'l3', user_id: 'u2', user_name: '李四', date: '2026-05-01', order_id: 'o9' }, // order-mode paid
    { _id: 'l4', user_id: 'u3', user_name: '王五', date: '2026-03-01', order_id: 'o1' }  // not paid
  ], sets)
  assert.equal(conflicts.length, 2)
  assert.deepEqual(conflicts.map(c => c.user_id).sort(), ['u1', 'u2'])
})

test('findPaidWorklogs empty when nothing paid', () => {
  const sets = buildPaidSets([])
  const conflicts = findPaidWorklogs([
    { _id: 'l1', user_id: 'u1', date: '2026-03-01', order_id: 'o1' }
  ], sets)
  assert.equal(conflicts.length, 0)
})

test('isOrderCompleted only true for completed status', () => {
  assert.equal(isOrderCompleted({ status: 'completed' }), true)
  assert.equal(isOrderCompleted({ status: 'active' }), false)
  assert.equal(isOrderCompleted(null), false)
})

test('buildPaidConflictPreview lists up to 3 and a suffix', () => {
  const preview = buildPaidConflictPreview([
    { user_name: 'A', month: '2026-03' },
    { user_name: 'B', month: '2026-03' },
    { user_name: 'C', month: '2026-03' },
    { user_name: 'D', month: '2026-03' }
  ])
  assert.match(preview, /A 2026-03、B 2026-03、C 2026-03/)
  assert.match(preview, /等 4 个已发薪记录/)
})
