const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  applyCurrentPricesToUnpaidLogs
} = require('../cloudfunctions/common/settlement-price.logic')

const root = path.join(__dirname, '..')

test('unpaid worklogs use the current process price as settlement price', () => {
  const result = applyCurrentPricesToUnpaidLogs({
    logs: [
      {
        _id: 'log-new',
        user_id: 'u1',
        order_id: 'order-new',
        process_id: 'process-a',
        quantity: 2044,
        snapshot_price: 0.23,
        amount: 470.12,
        date: '2026-06-10'
      }
    ],
    processes: [
      { _id: 'process-a', current_price: 0.29 }
    ],
    payments: []
  })

  assert.equal(result[0].snapshot_price, 0.29)
  assert.equal(result[0].current_price, 0.29)
  assert.equal(result[0].amount, 592.76)
  assert.equal(result[0].price_changed, false)
  assert.equal(result[0].price_synced_from_current, true)
})

test('order-paid records keep historical price without locking copied orders in the same month', () => {
  const result = applyCurrentPricesToUnpaidLogs({
    logs: [
      {
        _id: 'paid-old-order',
        user_id: 'u1',
        order_id: 'order-paid',
        process_id: 'process-paid',
        quantity: 10,
        snapshot_price: 0.23,
        date: '2026-06-10'
      },
      {
        _id: 'unpaid-copied-order',
        user_id: 'u1',
        order_id: 'order-copy',
        process_id: 'process-copy',
        quantity: 10,
        snapshot_price: 0.23,
        date: '2026-06-10'
      }
    ],
    processes: [
      { _id: 'process-paid', current_price: 0.29 },
      { _id: 'process-copy', current_price: 0.29 }
    ],
    payments: [
      { user_id: 'u1', order_id: 'order-paid', month: '2026-06', paid: true }
    ]
  })

  assert.equal(result[0].snapshot_price, 0.23)
  assert.equal(result[0].amount, 2.3)
  assert.equal(result[0].price_changed, true)
  assert.equal(result[0].is_price_locked, true)

  assert.equal(result[1].snapshot_price, 0.29)
  assert.equal(result[1].amount, 2.9)
  assert.equal(result[1].price_changed, false)
  assert.equal(result[1].is_price_locked, false)
})

test('monthly paid records keep historical price for the whole paid month', () => {
  const result = applyCurrentPricesToUnpaidLogs({
    logs: [
      {
        _id: 'month-paid',
        user_id: 'u1',
        order_id: 'order-a',
        process_id: 'process-a',
        quantity: 10,
        snapshot_price: 0.23,
        date: '2026-06-10'
      }
    ],
    processes: [
      { _id: 'process-a', current_price: 0.29 }
    ],
    payments: [
      { user_id: 'u1', month: '2026-06', paid: true }
    ]
  })

  assert.equal(result[0].snapshot_price, 0.23)
  assert.equal(result[0].amount, 2.3)
  assert.equal(result[0].price_changed, true)
  assert.equal(result[0].is_price_locked, true)
})

test('settlement price helper copies match the common source for cloud deployment', () => {
  const canonical = fs.readFileSync(path.join(root, 'cloudfunctions/common/settlement-price.logic.js'), 'utf8')
  ;['worklog', 'salary', 'export', 'leaderboard'].forEach((dir) => {
    const copy = fs.readFileSync(path.join(root, `cloudfunctions/${dir}/settlement-price.logic.js`), 'utf8')
    assert.equal(copy, canonical, `${dir}/settlement-price.logic.js differs from common source`)
  })
})
