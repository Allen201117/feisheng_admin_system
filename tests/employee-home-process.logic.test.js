const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildHomeProcessView,
  buildQuantityState,
  findProcessById
} = require('../miniprogram/pages/employee/home/home.logic')

test('buildHomeProcessView prepares a relaxed homepage preview', () => {
  const processes = [
    { _id: 'p1', process_name: '订前斗，单线', order_name: '8号1楼', current_price: 0.4, order_total_quantity: 100, current_total: 20, remaining_quantity: 80 },
    { _id: 'p2', process_name: '挖前兜布2个', order_name: '8号1楼', current_price: 0.26, order_total_quantity: 100, current_total: 100, remaining_quantity: 0, price_hidden: true },
    { _id: 'p3', process_name: '订后斗盖粘扣2个', order_name: '9号2楼', current_price: 0.08, order_total_quantity: 50, current_total: 10, remaining_quantity: 40 }
  ]

  const view = buildHomeProcessView(processes, 'p2', 2)

  assert.equal(view.totalCount, 3)
  assert.equal(view.visibleCount, 2)
  assert.equal(view.hasMore, true)
  assert.equal(view.items[0].priceText, '¥0.4/件')
  assert.equal(view.items[0].quotaText, '剩余 80 件')
  assert.equal(view.items[0].progressPercent, 20)
  assert.equal(view.items[1].priceText, '工价已隐藏')
  assert.equal(view.items[1].statusText, '已报满')
  assert.equal(view.items[1].isSelected, true)
})

test('findProcessById returns matching process only', () => {
  const processes = [{ _id: 'p1' }, { _id: 'p2' }]

  assert.deepEqual(findProcessById(processes, 'p2'), { _id: 'p2' })
  assert.equal(findProcessById(processes, 'missing'), null)
})

test('buildQuantityState validates selected process and remaining quota', () => {
  const selectedProcess = { _id: 'p1' }
  const quotaInfo = { remaining_quantity: 80 }

  assert.deepEqual(buildQuantityState(10, quotaInfo, selectedProcess), {
    quantity: 10,
    quantityError: '',
    canSubmit: true
  })

  assert.equal(buildQuantityState(0, quotaInfo, selectedProcess).canSubmit, false)
  assert.equal(buildQuantityState(90, quotaInfo, selectedProcess).quantityError, '超过剩余可报数量')
  assert.equal(buildQuantityState(10, quotaInfo, null).quantityError, '请先选择工序')
})
