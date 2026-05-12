const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getWorklogMonthKey,
  collectClearableWorklogIds,
  findPaidWorklogConflicts,
  buildClearOrderWorklogsDetails
} = require('../cloudfunctions/order/clear-worklogs.logic')

test('getWorklogMonthKey extracts salary month from worklog date', () => {
  assert.equal(getWorklogMonthKey({ date: '2026-05-12' }), '2026-05')
  assert.equal(getWorklogMonthKey({ date: '' }), '')
})

test('collectClearableWorklogIds keeps only valid worklog ids', () => {
  assert.deepEqual(
    collectClearableWorklogIds([
      { _id: 'w1' },
      { _id: '' },
      { other: 'missing' },
      { _id: 'w2' }
    ]),
    ['w1', 'w2']
  )
})

test('findPaidWorklogConflicts reports worklogs in paid salary months', () => {
  const conflicts = findPaidWorklogConflicts({
    worklogs: [
      { _id: 'w1', user_id: 'u1', user_name: '张三', date: '2026-05-02' },
      { _id: 'w2', user_id: 'u1', user_name: '张三', date: '2026-06-02' },
      { _id: 'w3', user_id: 'u2', user_name: '李四', date: '2026-05-03' }
    ],
    paidMonthSet: new Set(['u1::2026-05'])
  })

  assert.deepEqual(conflicts, [
    { worklog_id: 'w1', user_id: 'u1', user_name: '张三', month: '2026-05' }
  ])
})

test('buildClearOrderWorklogsDetails renders audit details', () => {
  assert.equal(
    buildClearOrderWorklogsDetails({
      orderName: '春季订单',
      removedCount: 3
    }),
    '清空订单“春季订单”关联报工 3 条'
  )
})
