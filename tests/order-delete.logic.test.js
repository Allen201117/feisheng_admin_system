const test = require('node:test')
const assert = require('node:assert/strict')

const {
  summarizeDeleteOrderTargets,
  buildDeleteOrderConfirmContent
} = require('../miniprogram/pages/boss/orders/orders.logic')

test('summarizeDeleteOrderTargets normalizes missing counts to zero', () => {
  assert.deepEqual(
    summarizeDeleteOrderTargets(),
    {
      processCount: 0,
      worklogCount: 0,
      adjustmentCount: 0,
      auditLogCount: 0,
      totalCount: 0
    }
  )
})

test('summarizeDeleteOrderTargets returns total related records', () => {
  assert.deepEqual(
    summarizeDeleteOrderTargets({
      processCount: 3,
      worklogCount: 12,
      adjustmentCount: 2,
      auditLogCount: 5
    }),
    {
      processCount: 3,
      worklogCount: 12,
      adjustmentCount: 2,
      auditLogCount: 5,
      totalCount: 22
    }
  )
})

test('buildDeleteOrderConfirmContent renders a destructive warning with counts', () => {
  const content = buildDeleteOrderConfirmContent('春季服装订单 A', {
    processCount: 3,
    worklogCount: 12,
    adjustmentCount: 2,
    auditLogCount: 5
  })

  assert.equal(
    content,
    '删除订单“春季服装订单 A”后，将一并删除：\n- 订单工序 3 条\n- 报工记录 12 条\n- 订单奖惩 2 条\n- 审计日志 5 条\n\n该操作不可恢复，请谨慎确认。'
  )
})
