const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizeOrderQuantity,
  shouldCheckProcessQuantityLimit,
  buildExceededProcessQuantities
} = require('../cloudfunctions/order/update-order.logic')

test('shouldCheckProcessQuantityLimit treats legacy string quantity as unchanged', () => {
  assert.equal(shouldCheckProcessQuantityLimit('100', 100), false)
  assert.equal(shouldCheckProcessQuantityLimit(100, 100), false)
})

test('shouldCheckProcessQuantityLimit detects real quantity changes', () => {
  assert.equal(shouldCheckProcessQuantityLimit('100', 90), true)
  assert.equal(shouldCheckProcessQuantityLimit(100, 120), true)
})

test('normalizeOrderQuantity supports legacy order_total_quantity fallback', () => {
  assert.equal(normalizeOrderQuantity({ total_quantity: '120' }), 120)
  assert.equal(normalizeOrderQuantity({ order_total_quantity: '80' }), 80)
})

test('buildExceededProcessQuantities sums worklogs once by process', () => {
  const exceeded = buildExceededProcessQuantities({
    processes: [
      { _id: 'p1', process_name: '裁剪' },
      { _id: 'p2', process_name: '缝制' }
    ],
    worklogs: [
      { process_id: 'p1', quantity: 40 },
      { process_id: 'p1', quantity: '30' },
      { process_id: 'p2', quantity: 10 }
    ],
    nextTotalQuantity: 60
  })

  assert.deepEqual(exceeded, [
    { process_name: '裁剪', current_sum: 70 }
  ])
})
