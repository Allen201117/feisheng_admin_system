const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildOrderMatrix,
  processLabel,
  formatPrice
} = require('../cloudfunctions/export/order-matrix.logic')

// ---- formatPrice / processLabel ----

test('formatPrice 处理空值与数字', () => {
  assert.equal(formatPrice(null), null)
  assert.equal(formatPrice(undefined), null)
  assert.equal(formatPrice(''), null)
  assert.equal(formatPrice('abc'), null)
  assert.equal(formatPrice(0.05), '0.05')
  assert.equal(formatPrice(5), '5')
})

test('processLabel 带工价括号；无价不加括号；可关闭', () => {
  assert.equal(processLabel('去明线', 0.05, true), '去明线（0.05元）')
  assert.equal(processLabel('去明线', null, true), '去明线')
  assert.equal(processLabel('去明线', 0.05, false), '去明线')
})

// ---- 默认：仅数量，表头只写员工姓名（员工列按姓名拼音排序：李四 在 张三 之前）----

const processes = [
  { _id: 'p1', process_name: '去明线', current_price: 0.05 },
  { _id: 'p2', process_name: '甲口', current_price: 0.1 }
]
const logs = [
  { user_id: 'u1', user_name: '张三', process_id: 'p1', process_name: '去明线', quantity: 369, snapshot_price: 0.05 },
  { user_id: 'u2', user_name: '李四', process_id: 'p1', process_name: '去明线', quantity: 177, snapshot_price: 0.05 },
  { user_id: 'u1', user_name: '张三', process_id: 'p2', process_name: '甲口', quantity: 36, snapshot_price: 0.1 },
  { user_id: 'u2', user_name: '李四', process_id: 'p2', process_name: '甲口', quantity: 36, snapshot_price: 0.1 }
]

test('表头：工序名称 + 员工姓名(仅姓名，无“数量”) + 合计', () => {
  const { headers } = buildOrderMatrix({ logs, processes })
  assert.deepEqual(headers, ['工序名称', '李四', '张三', '合计'])
})

test('单元格仅数量，工序带工价括号，含最右合计列', () => {
  const { rows } = buildOrderMatrix({ logs, processes })
  // 去明线（0.05元） 李四177 张三369 合计546
  assert.deepEqual(rows[0], ['去明线（0.05元）', 177, 369, 546])
  // 甲口（0.1元） 李四36 张三36 合计72
  assert.deepEqual(rows[1], ['甲口（0.1元）', 36, 36, 72])
})

test('最底合计行：每个员工数量合计 + 总计', () => {
  const { rows } = buildOrderMatrix({ logs, processes })
  const total = rows[rows.length - 1]
  // 李四 213  张三 405  总计 618
  assert.deepEqual(total, ['合计', 213, 405, 618])
})

// ---- 聚合与边界（默认仅数量）----

test('同一员工同一工序多条报工累加', () => {
  const multi = [
    { user_id: 'u1', user_name: '张三', process_id: 'p1', process_name: '去明线', quantity: 100, snapshot_price: 0.05 },
    { user_id: 'u1', user_name: '张三', process_id: 'p1', process_name: '去明线', quantity: 50, snapshot_price: 0.05 }
  ]
  const { rows } = buildOrderMatrix({ logs: multi, processes: [{ _id: 'p1', process_name: '去明线', current_price: 0.05 }] })
  assert.deepEqual(rows[0], ['去明线（0.05元）', 150, 150])
})

test('工序已从 Processes 删除时不带工价括号，仍统计', () => {
  const orphan = [
    { user_id: 'u1', user_name: '张三', process_id: 'pX', process_name: '临时工序', quantity: 10, snapshot_price: 0.2 }
  ]
  const { rows } = buildOrderMatrix({ logs: orphan, processes: [] })
  assert.deepEqual(rows[0], ['临时工序', 10, 10])
})

test('current_price 为 0 时显示（0元），不应被当作无价', () => {
  const freeLogs = [
    { user_id: 'u1', user_name: '张三', process_id: 'p1', process_name: '免费工序', quantity: 5, snapshot_price: 0 }
  ]
  const { rows } = buildOrderMatrix({ logs: freeLogs, processes: [{ _id: 'p1', process_name: '免费工序', current_price: 0 }] })
  assert.deepEqual(rows[0], ['免费工序（0元）', 5, 5])
})

test('可关闭合计行/列', () => {
  const one = [
    { user_id: 'u1', user_name: '张三', process_id: 'p1', process_name: '去明线', quantity: 10, snapshot_price: 0.05 }
  ]
  const { headers, rows } = buildOrderMatrix({
    logs: one,
    processes: [{ _id: 'p1', process_name: '去明线', current_price: 0.05 }],
    options: { includeRowTotal: false, includeColTotal: false }
  })
  assert.deepEqual(headers, ['工序名称', '张三'])
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], ['去明线（0.05元）', 10])
})

test('空数据：仅表头(无员工列) + 一行空合计', () => {
  const { headers, rows } = buildOrderMatrix({ logs: [], processes: [] })
  assert.deepEqual(headers, ['工序名称', '合计'])
  assert.deepEqual(rows, [['合计', 0]])
})

test('员工列按姓名排序，保证导出稳定', () => {
  const mixed = [
    { user_id: 'u2', user_name: '王五', process_id: 'p1', process_name: '去明线', quantity: 1, snapshot_price: 1 },
    { user_id: 'u1', user_name: '陈二', process_id: 'p1', process_name: '去明线', quantity: 2, snapshot_price: 1 }
  ]
  const { headers } = buildOrderMatrix({ logs: mixed, processes: [{ _id: 'p1', process_name: '去明线', current_price: 1 }] })
  assert.ok(headers.indexOf('陈二') < headers.indexOf('王五'))
})

// ---- 可选：includeAmount=true 时每个员工拆「数量|金额」两列 ----

test('includeAmount=true：每人数量|金额两列，金额=数量*快照单价', () => {
  const { headers, rows } = buildOrderMatrix({ logs, processes, options: { includeAmount: true } })
  assert.deepEqual(headers, [
    '工序名称',
    '李四 数量', '李四 金额',
    '张三 数量', '张三 金额',
    '合计 数量', '合计 金额'
  ])
  assert.deepEqual(rows[0], ['去明线（0.05元）', 177, 8.85, 369, 18.45, 546, 27.3])
  assert.deepEqual(rows[rows.length - 1], ['合计', 213, 12.45, 405, 22.05, 618, 34.5])
})
