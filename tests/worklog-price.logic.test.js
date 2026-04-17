const test = require('node:test')
const assert = require('node:assert/strict')

const {
  normalizePrice,
  normalizeAssignedProcessForEmployee
} = require('../miniprogram/pages/employee/worklog/worklog.logic')

test('normalizePrice returns zero for empty values', () => {
  assert.equal(normalizePrice(null), 0)
  assert.equal(normalizePrice(undefined), 0)
  assert.equal(normalizePrice(''), 0)
})

test('normalizePrice preserves numeric values', () => {
  assert.equal(normalizePrice(0), 0)
  assert.equal(normalizePrice(1.5), 1.5)
  assert.equal(normalizePrice('2.25'), 2.25)
})

test('normalizeAssignedProcessForEmployee shows zero price when price is unset', () => {
  const result = normalizeAssignedProcessForEmployee({
    _id: 'p1',
    order_name: '订单A',
    process_name: '缝制',
    current_price: null,
    price_hidden: false
  })

  assert.equal(result.current_price, 0)
  assert.equal(result.display, '订单A - 缝制 (¥0/件)')
})

test('normalizeAssignedProcessForEmployee keeps hidden-price copy while allowing zero snapshot', () => {
  const result = normalizeAssignedProcessForEmployee({
    _id: 'p2',
    order_name: '订单B',
    process_name: '包装',
    current_price: null,
    price_hidden: true
  })

  assert.equal(result.current_price, 0)
  assert.equal(result.display, '订单B - 包装 (工价已隐藏)')
})
