const test = require('node:test')
const assert = require('node:assert/strict')

const { filterListByKeyword, normalizeListSearchKeyword } = require('../miniprogram/utils/list-search')

test('normalizes list search keywords for stable matching', () => {
  assert.equal(normalizeListSearchKeyword('  Alpha  '), 'alpha')
  assert.equal(normalizeListSearchKeyword(null), '')
  assert.equal(normalizeListSearchKeyword(123), '123')
})

test('filters long list items by configured text fields and derived values', () => {
  const rows = [
    { name: '张三', phone: '13800000000', order: { name: '春季工服' }, quantity: 80 },
    { name: '李四', phone: '13900000000', order: { name: '夏季T恤' }, quantity: 120 },
    { name: 'Wang', phone: '13700000000', order: { name: '包装订单' }, quantity: 30 }
  ]

  assert.deepEqual(
    filterListByKeyword(rows, '工服', ['name', 'phone', 'order.name', (item) => item.quantity]).map((item) => item.name),
    ['张三']
  )
  assert.deepEqual(
    filterListByKeyword(rows, '120', ['name', 'phone', 'order.name', (item) => item.quantity]).map((item) => item.name),
    ['李四']
  )
  assert.deepEqual(
    filterListByKeyword(rows, 'wang', ['name', 'phone', 'order.name', (item) => item.quantity]).map((item) => item.name),
    ['Wang']
  )
})

test('keeps the original list when the keyword is empty', () => {
  const rows = [{ name: '张三' }, { name: '李四' }]

  assert.equal(filterListByKeyword(rows, '', ['name']), rows)
  assert.deepEqual(filterListByKeyword(null, '张三', ['name']), [])
})
