const test = require('node:test')
const assert = require('node:assert/strict')

const { planPaidGroupRepairs } = require('../cloudfunctions/salary/settlement-repair.logic')
const { selectWorklogSyncUpdates } = require('../cloudfunctions/common/settlement-price.logic')

// 复现线上那条脏数据的形状（工序「打结1厘米30个 ¥0.3」被改名改价为「打结1厘米20个 ¥0.2」）：
// 7-21 报工 295 件冻结 ¥0.3，改价时没同步落库；8-26 报工 107 件是 ¥0.2。
// 按订单发薪时按「当前价 0.2」算出 (295+107)*0.2 = 80.40 记进 SalaryPayments，
// 但 WorkLogs 里 7-21 那条还是 0.3 → 锁定后明细翻回 88.50，出现「结算价¥0.3·当前价¥0.2」。
function buildOnlineCase() {
  return {
    payments: [
      { user_id: 'u1', user_name: '员工A', order_id: 'order-a', order_name: '订单A', month: '2026-08', paid: true, total_amount: 80.4 }
    ],
    logs: [
      { _id: 'log-jul', user_id: 'u1', order_id: 'order-a', process_id: 'p-dajie', process_name: '打结1厘米30个', quantity: 295, snapshot_price: 0.3, amount: 88.5, date: '2026-07-21' },
      { _id: 'log-aug', user_id: 'u1', order_id: 'order-a', process_id: 'p-dajie', process_name: '打结1厘米20个', quantity: 107, snapshot_price: 0.2, amount: 21.4, date: '2026-08-26' }
    ],
    adjustments: [],
    processPriceMap: { 'p-dajie': 0.2 }
  }
}

test('对得上实发总额的已发薪组：把没固化的结算价补成实发价', () => {
  const { repairable, manualReview } = planPaidGroupRepairs(buildOnlineCase())

  assert.equal(manualReview.length, 0)
  assert.equal(repairable.length, 1)
  assert.equal(repairable[0].recordedTotal, 80.4)
  assert.equal(repairable[0].recomputedByCurrentPrice, 80.4)
  assert.equal(repairable[0].recomputedByStoredPrice, 109.9)
  assert.deepEqual(repairable[0].updates, [
    { _id: 'log-jul', data: { snapshot_price: 0.2, amount: 59 } }
  ])
})

test('发薪后才被改价（库存价才等于实发额）的组一律不动，只报人工确认', () => {
  const input = buildOnlineCase()
  input.payments[0].total_amount = 109.9 // 实发就是按 0.3 发的
  const { repairable, manualReview } = planPaidGroupRepairs(input)

  assert.equal(repairable.length, 0)
  assert.equal(manualReview.length, 1)
  assert.match(manualReview[0].reason, /不动/)
})

test('两种口径都对不上实发额的组进人工确认，不写库', () => {
  const input = buildOnlineCase()
  input.payments[0].total_amount = 999
  const { repairable, manualReview } = planPaidGroupRepairs(input)

  assert.equal(repairable.length, 0)
  assert.equal(manualReview.length, 1)
  assert.match(manualReview[0].reason, /需人工确认/)
})

test('奖惩计入对账：实发额含奖惩时仍能对上', () => {
  const input = buildOnlineCase()
  input.adjustments = [
    { user_id: 'u1', order_id: 'order-a', type: 'reward', amount: 50 },
    { user_id: 'u1', order_id: 'order-a', type: 'penalty', amount: 10 }
  ]
  input.payments[0].total_amount = 120.4 // 80.4 + 50 - 10
  const { repairable, manualReview } = planPaidGroupRepairs(input)

  assert.equal(manualReview.length, 0)
  assert.equal(repairable.length, 1)
  assert.equal(repairable[0].updates.length, 1)
})

test('同一员工同月的另一张未发薪订单不会被按月锁误判进本组', () => {
  const input = buildOnlineCase()
  input.logs.push({
    _id: 'log-other', user_id: 'u1', order_id: 'order-other', process_id: 'p-dajie',
    process_name: '打结1厘米30个', quantity: 10, snapshot_price: 0.3, amount: 3, date: '2026-08-27'
  })
  const { repairable } = planPaidGroupRepairs(input)

  assert.equal(repairable.length, 1)
  assert.deepEqual(repairable[0].updates.map(u => u._id), ['log-jul'])
})

test('工序改名改价后，未发薪报工的名/价/金额一起对齐；已发薪报工按 skip 一律不动', () => {
  const logs = [
    { _id: 'unpaid', user_id: 'u1', order_id: 'order-new', process_id: 'p-dajie', process_name: '打结1厘米30个', quantity: 100, snapshot_price: 0.3, amount: 30, date: '2026-08-27' },
    { _id: 'paid', user_id: 'u1', order_id: 'order-a', process_id: 'p-dajie', process_name: '打结1厘米30个', quantity: 295, snapshot_price: 0.3, amount: 88.5, date: '2026-07-21' }
  ]
  const payments = [{ user_id: 'u1', order_id: 'order-a', paid: true }]

  const skip = selectWorklogSyncUpdates({
    logs,
    processPriceMap: { 'p-dajie': 0.2 },
    processNameMap: { 'p-dajie': '打结1厘米20个' },
    payments,
    lockedPolicy: 'skip'
  })
  assert.deepEqual(skip, [
    { _id: 'unpaid', locked: false, data: { snapshot_price: 0.2, amount: 20, process_name: '打结1厘米20个' } }
  ])

  const nameOnly = selectWorklogSyncUpdates({
    logs,
    processPriceMap: { 'p-dajie': 0.2 },
    processNameMap: { 'p-dajie': '打结1厘米20个' },
    payments,
    lockedPolicy: 'name-only'
  })
  assert.equal(nameOnly.length, 2)
  assert.deepEqual(nameOnly[1], { _id: 'paid', locked: true, data: { process_name: '打结1厘米20个' } })
})

test('已经一致的报工不会产生多余写入（幂等）', () => {
  const updates = selectWorklogSyncUpdates({
    logs: [
      { _id: 'ok', user_id: 'u1', order_id: 'o', process_id: 'p', process_name: '打结', quantity: 100, snapshot_price: 0.2, amount: 20, date: '2026-08-27' }
    ],
    processPriceMap: { p: 0.2 },
    processNameMap: { p: '打结' },
    payments: []
  })
  assert.deepEqual(updates, [])
})

test('工价被清空（null/0）时不改价，只同步工序名', () => {
  const updates = selectWorklogSyncUpdates({
    logs: [
      { _id: 'a', user_id: 'u1', order_id: 'o', process_id: 'p', process_name: '旧名', quantity: 100, snapshot_price: 0.3, amount: 30, date: '2026-08-27' }
    ],
    processPriceMap: { p: null },
    processNameMap: { p: '新名' },
    payments: []
  })
  assert.deepEqual(updates, [{ _id: 'a', locked: false, data: { process_name: '新名' } }])
})
