const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildCopiedProcessData,
  chunkList,
  copyProcessDocsInChunks
} = require('../cloudfunctions/order/copy-order.logic')

test('buildCopiedProcessData writes active status for copied processes', () => {
  const result = buildCopiedProcessData({
    process_name: '缝制',
    current_price: 1.5,
    note: 'A线',
    assigned_user_ids: ['u1', 'u2']
  }, {
    orgId: 'org_home',
    newOrderId: 'order_new',
    serverDate: () => 'SERVER_DATE'
  })

  assert.equal(result.org_id, 'org_home')
  assert.equal(result.order_id, 'order_new')
  assert.equal(result.status, 'active')
  assert.equal(Object.prototype.hasOwnProperty.call(result, 'is_active'), false)
  assert.deepEqual(result.assigned_user_ids, ['u1', 'u2'])
})

test('chunkList splits large process copies into bounded batches', () => {
  assert.deepEqual(chunkList([1, 2, 3, 4, 5], 2), [[1, 2], [3, 4], [5]])
})

test('copyProcessDocsInChunks copies every process through the injected writer', async () => {
  const copied = []
  const processes = Array.from({ length: 5 }, (_, index) => ({
    process_name: `工序${index + 1}`,
    current_price: index + 1,
    assigned_user_ids: []
  }))

  const result = await copyProcessDocsInChunks(processes, {
    orgId: 'org_home',
    newOrderId: 'order_new',
    serverDate: () => 'SERVER_DATE',
    chunkSize: 2,
    addProcess: async (data) => {
      copied.push(data)
    }
  })

  assert.equal(result.copiedCount, 5)
  assert.equal(copied.length, 5)
  assert.deepEqual(copied.map(item => item.status), ['active', 'active', 'active', 'active', 'active'])
})
