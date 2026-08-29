const test = require('node:test')
const assert = require('node:assert/strict')

const {
  planAdjustmentReversalRepairs,
  buildScopeKey,
  buildLooseKey
} = require('../cloudfunctions/salary/adjustment-repair.logic')

// 线上形状：老板按订单发薪，8 月给员工记了一条 ¥100 处罚，点删除。
// 旧口径把「按订单发薪」当成「按月发薪」→ 误判锁定 → 加了一条 ¥100 奖励冲正，
// 原处罚留在明细里。老板看到没删掉，又点了两次，于是有 3 条冲正 —— 工资多奖了 ¥200。
function onlineCase() {
  return {
    adjustments: [
      { _id: 'a1', user_id: 'u1', user_name: '张三', type: 'penalty', amount: 100, month: '2026-08' },
      { _id: 'r1', user_id: 'u1', user_name: '张三', type: 'reward', amount: 100, month: '2026-08', is_reversal: true, original_id: 'a1' },
      { _id: 'r2', user_id: 'u1', user_name: '张三', type: 'reward', amount: 100, month: '2026-08', is_reversal: true, original_id: 'a1' },
      { _id: 'r3', user_id: 'u1', user_name: '张三', type: 'reward', amount: 100, month: '2026-08', is_reversal: true, original_id: 'a1' }
    ],
    // 该员工 8 月只有「按订单」发薪，没有按月发薪
    payments: [{ user_id: 'u1', month: '2026-08', order_id: 'order-a' }]
  }
}

function planOf({ adjustments, payments }) {
  return planAdjustmentReversalRepairs({
    adjustments,
    paidScopeKeys: payments.map(buildScopeKey),
    paidLooseKeys: payments.map(buildLooseKey)
  })
}

test('按订单发薪不该锁住月度奖惩：误判留下的整组冲正全部清掉', () => {
  const plan = planOf(onlineCase())
  assert.equal(plan.total_group_count, 1)
  const g = plan.groups[0]
  assert.deepEqual(g.remove_ids.sort(), ['a1', 'r1', 'r2', 'r3'])
  assert.deepEqual(g.promote_ids, [])
  // 冲正冲过头：净额本该是 -100（罚），现在是 +200（多奖）
  assert.equal(g.net_before, 200)
  assert.equal(g.net_after, 0)
  assert.equal(g.duplicated, true)
  assert.equal(plan.manual_review.length, 0)
})

test('真按月发薪的冲正是 §2.3 要求的痕迹，一条都不动', () => {
  const plan = planOf({
    adjustments: [
      { _id: 'a1', user_id: 'u1', user_name: '张三', type: 'penalty', amount: 100, month: '2026-08' },
      { _id: 'r1', user_id: 'u1', type: 'reward', amount: 100, month: '2026-08', is_reversal: true, original_id: 'a1' }
    ],
    payments: [{ user_id: 'u1', month: '2026-08' }] // 纯按月发薪
  })
  assert.equal(plan.total_group_count, 0)
  assert.equal(plan.kept_group_count, 1)
  assert.equal(plan.total_fix_count, 0)
})

test('订单奖惩：该订单已发薪则保留，另一个订单发薪不影响它', () => {
  const adjustments = [
    { _id: 'a1', user_id: 'u1', type: 'penalty', amount: 50, month: '2026-08', order_id: 'order-a', order_name: '订单A' },
    { _id: 'r1', user_id: 'u1', type: 'reward', amount: 50, month: '2026-08', order_id: 'order-a', is_reversal: true, original_id: 'a1' }
  ]
  const paid = planOf({ adjustments, payments: [{ user_id: 'u1', month: '2026-08', order_id: 'order-a' }] })
  assert.equal(paid.total_group_count, 0)
  assert.equal(paid.kept_group_count, 1)

  const otherOrder = planOf({ adjustments, payments: [{ user_id: 'u1', month: '2026-08', order_id: 'order-b' }] })
  assert.equal(otherOrder.total_group_count, 1)
  assert.deepEqual(otherOrder.groups[0].remove_ids.sort(), ['a1', 'r1'])
})

test('改金额留下的三条：删原记录和冲正，把更正扶正保留，净额不变', () => {
  const plan = planOf({
    adjustments: [
      { _id: 'a1', user_id: 'u1', user_name: '李四', type: 'reward', amount: 100, month: '2026-08' },
      { _id: 'r1', user_id: 'u1', type: 'penalty', amount: 100, month: '2026-08', is_reversal: true, original_id: 'a1' },
      { _id: 'c1', user_id: 'u1', type: 'reward', amount: 120, month: '2026-08', is_correction: true, original_id: 'a1' }
    ],
    payments: []
  })
  const g = plan.groups[0]
  assert.deepEqual(g.remove_ids.sort(), ['a1', 'r1'])
  assert.deepEqual(g.promote_ids, ['c1'])
  assert.equal(g.net_before, 120)
  assert.equal(g.net_after, 120) // 老板改后的金额原样保留
})

test('孤儿冲正：原记录已删，未发薪就清掉；发过薪则只报不改', () => {
  const adjustments = [
    { _id: 'r1', user_id: 'u1', user_name: '王五', type: 'reward', amount: 80, month: '2026-08', is_reversal: true, original_id: 'gone' }
  ]
  const unpaid = planOf({ adjustments, payments: [] })
  assert.equal(unpaid.groups[0].orphan, true)
  assert.deepEqual(unpaid.groups[0].remove_ids, ['r1'])
  assert.equal(unpaid.groups[0].net_before, 80)

  // 孤儿认不出订单归属，只要该员工该月发过任何一笔薪就不动（可能已计入实发总额）
  const paid = planOf({ adjustments, payments: [{ user_id: 'u1', month: '2026-08', order_id: 'order-a' }] })
  assert.equal(paid.total_group_count, 0)
  assert.equal(paid.manual_review.length, 1)
  assert.equal(paid.manual_review[0].orphan, true)
})

test('已发薪期次里的重复冲正只报不改，交给老板判断', () => {
  const plan = planOf({
    adjustments: [
      { _id: 'a1', user_id: 'u1', user_name: '张三', type: 'penalty', amount: 100, month: '2026-08' },
      { _id: 'r1', user_id: 'u1', type: 'reward', amount: 100, month: '2026-08', is_reversal: true, original_id: 'a1' },
      { _id: 'r2', user_id: 'u1', type: 'reward', amount: 100, month: '2026-08', is_reversal: true, original_id: 'a1' }
    ],
    payments: [{ user_id: 'u1', month: '2026-08' }]
  })
  assert.equal(plan.total_group_count, 0)
  assert.equal(plan.manual_review.length, 1)
  assert.equal(plan.manual_review[0].reversal_count, 2)
})

test('干净的库跑出来什么都不用改，且可重复跑（幂等）', () => {
  const clean = {
    adjustments: [
      { _id: 'a1', user_id: 'u1', type: 'reward', amount: 100, month: '2026-08' },
      { _id: 'a2', user_id: 'u2', type: 'penalty', amount: 30, month: '2026-08' }
    ],
    payments: []
  }
  const plan = planOf(clean)
  assert.equal(plan.total_fix_count, 0)
  assert.equal(plan.total_group_count, 0)
  assert.equal(plan.scanned.adjustments, 2)
  assert.equal(plan.scanned.reversals, 0)

  // 把上一轮的修复结果喂回去，不该再产生新动作
  const afterFix = planOf({ adjustments: [{ _id: 'c1', user_id: 'u1', type: 'reward', amount: 120, month: '2026-08' }], payments: [] })
  assert.equal(afterFix.total_fix_count, 0)
})
