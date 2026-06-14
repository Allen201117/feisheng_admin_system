const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getMonthKey,
  buildPaidSets,
  isWorklogPaid,
  findPaidWorklogs,
  isOrderCompleted,
  buildPaidConflictPreview,
  canChangeOrderStatus,
  selectOrderScopedPaidPayments,
  findMonthLockedConflicts
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
  // 按订单发薪记录虽带 month，但只锁该订单，不污染 monthSet（避免跨订单整月误锁）
  assert.equal(sets.monthSet.has('u3::2026-03'), false)
  assert.equal(sets.orderSet.has('u3::o9'), true)
})

// 回归：复制已发薪订单 → 副本订单未发薪，但同员工同月在源订单已按订单发薪。
// 改副本订单工序的价不应被误锁（薪资管理显示未发薪，改价口径必须一致）。
test('order-mode paid does NOT lock a copied unpaid order in the same month', () => {
  const sets = buildPaidSets([
    // 张三在源订单 o-old 按订单发薪，记录带发薪当月 2026-06
    { user_id: 'zhangsan', month: '2026-06', order_id: 'o-old', paid: true, payroll_type: 'order' }
  ])
  // 副本订单 o-new 的同月报工：未发薪，不应命中
  assert.equal(
    isWorklogPaid({ user_id: 'zhangsan', date: '2026-06-15', order_id: 'o-new' }, sets),
    false
  )
  // 源订单 o-old 的报工仍按订单锁定
  assert.equal(
    isWorklogPaid({ user_id: 'zhangsan', date: '2026-06-15', order_id: 'o-old' }, sets),
    true
  )
  // 改价拦截：副本订单工序的报工不构成冲突
  const conflicts = findPaidWorklogs([
    { _id: 'l1', user_id: 'zhangsan', user_name: '张三', date: '2026-06-15', order_id: 'o-new' }
  ], sets)
  assert.equal(conflicts.length, 0)
})

// 防回归：按月发薪模式（纯按月记录，无 order_id）必须锁住该员工该月跨订单的所有报工
test('month-mode paid locks ALL same-month worklogs across orders', () => {
  const sets = buildPaidSets([
    { user_id: 'zhaoliu', month: '2026-06', paid: true }
  ])
  assert.equal(isWorklogPaid({ user_id: 'zhaoliu', date: '2026-06-01', order_id: 'oA' }, sets), true)
  assert.equal(isWorklogPaid({ user_id: 'zhaoliu', date: '2026-06-30', order_id: 'oB' }, sets), true)
  assert.equal(isWorklogPaid({ user_id: 'zhaoliu', date: '2026-07-01', order_id: 'oA' }, sets), false)
})

// 防回归（改价同步重写侧）：syncZero 用 !isWorklogPaid 选可重写报工，副本订单未发薪报工应可重写，
// 已发薪报工（按订单/按月）应被排除，与改价闸门同口径
test('reprice sync selects copied-order unpaid worklogs and excludes paid ones', () => {
  const sets = buildPaidSets([
    { user_id: 'zhangsan', month: '2026-06', order_id: 'o-old', paid: true, payroll_type: 'order' },
    { user_id: 'lisi', month: '2026-06', paid: true }
  ])
  const worklogs = [
    { _id: 'w1', user_id: 'zhangsan', date: '2026-06-10', order_id: 'o-new' },
    { _id: 'w2', user_id: 'zhangsan', date: '2026-06-10', order_id: 'o-old' },
    { _id: 'w3', user_id: 'lisi', date: '2026-06-10', order_id: 'o-new' }
  ]
  const repriceable = worklogs.filter((log) => !isWorklogPaid(log, sets))
  assert.deepEqual(repriceable.map((l) => l._id), ['w1'])
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

test('canChangeOrderStatus allows completed -> active as reactivation', () => {
  const r = canChangeOrderStatus('completed', 'active')
  assert.equal(r.ok, true)
  assert.equal(r.reactivation, true)
})

test('canChangeOrderStatus blocks completed -> cancelled', () => {
  const r = canChangeOrderStatus('completed', 'cancelled')
  assert.equal(r.ok, false)
  assert.equal(r.reactivation, false)
  assert.match(r.reason, /已完成/)
})

test('canChangeOrderStatus treats completed -> completed as no-op (not reactivation)', () => {
  const r = canChangeOrderStatus('completed', 'completed')
  assert.equal(r.ok, true)
  assert.equal(r.reactivation, false)
})

test('canChangeOrderStatus preserves freedom for non-completed orders', () => {
  assert.equal(canChangeOrderStatus('active', 'completed').ok, true)
  assert.equal(canChangeOrderStatus('active', 'cancelled').ok, true)
  assert.equal(canChangeOrderStatus('cancelled', 'active').ok, true)
  assert.equal(canChangeOrderStatus('cancelled', 'completed').ok, true)
  // 但这些都不是「恢复」
  assert.equal(canChangeOrderStatus('active', 'completed').reactivation, false)
})

test('canChangeOrderStatus rejects invalid target status', () => {
  const r = canChangeOrderStatus('completed', 'archived')
  assert.equal(r.ok, false)
  assert.match(r.reason, /无效/)
})

test('selectOrderScopedPaidPayments picks only this order paid order-mode records', () => {
  const payments = [
    { _id: 'p1', user_id: 'u1', order_id: 'oA', paid: true },   // hit
    { _id: 'p2', user_id: 'u2', order_id: 'oA', paid: false },  // not paid
    { _id: 'p3', user_id: 'u3', order_id: 'oB', paid: true },   // other order
    { _id: 'p4', user_id: 'u4', month: '2026-06', paid: true }  // month-mode, no order_id
  ]
  const picked = selectOrderScopedPaidPayments(payments, 'oA')
  assert.deepEqual(picked.map(p => p._id), ['p1'])
})

test('selectOrderScopedPaidPayments returns empty without orderId', () => {
  assert.deepEqual(selectOrderScopedPaidPayments([{ user_id: 'u1', order_id: 'oA', paid: true }], ''), [])
})

test('findMonthLockedConflicts flags month-mode-locked worklogs (deduped), ignores order-mode payments', () => {
  const payments = [
    { user_id: 'u1', month: '2026-06', paid: true },                       // month-mode lock
    { user_id: 'u2', order_id: 'oA', month: '2026-06', paid: true },       // order-mode -> ignored here
    { user_id: 'u3', month: '2026-06', paid: false }                       // not paid
  ]
  const worklogs = [
    { user_id: 'u1', user_name: '张三', date: '2026-06-05', order_id: 'oA' },
    { user_id: 'u1', user_name: '张三', date: '2026-06-20', order_id: 'oA' }, // same user+month -> deduped
    { user_id: 'u2', user_name: '李四', date: '2026-06-05', order_id: 'oA' }, // only order-mode paid -> not month-locked
    { user_id: 'u3', user_name: '王五', date: '2026-06-05', order_id: 'oA' }  // payment unpaid -> not locked
  ]
  const conflicts = findMonthLockedConflicts(worklogs, payments)
  assert.equal(conflicts.length, 1)
  assert.equal(conflicts[0].user_id, 'u1')
  assert.equal(conflicts[0].month, '2026-06')
})

test('findMonthLockedConflicts empty when no month-mode payments', () => {
  assert.deepEqual(findMonthLockedConflicts(
    [{ user_id: 'u1', date: '2026-06-05', order_id: 'oA' }],
    [{ user_id: 'u1', order_id: 'oA', paid: true }]
  ), [])
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
