const test = require('node:test')
const assert = require('node:assert/strict')

const { rankMenuByUsage, bumpUsage } = require('../miniprogram/utils/menu-usage.logic')

const POOL = [
  { key: 'employees' },
  { key: 'attendance' },
  { key: 'worklog-manage' },
  { key: 'orders' },
  { key: 'qc' },
  { key: 'salary' }
]

test('无使用记录：保持池默认顺序，前 4 = 员工/考勤/报工/订单', () => {
  const ranked = rankMenuByUsage(POOL, {})
  assert.deepEqual(ranked.slice(0, 4).map((x) => x.key), ['employees', 'attendance', 'worklog-manage', 'orders'])
})

test('按频次降序排序', () => {
  const usage = { orders: 10, salary: 5, employees: 1 }
  const ranked = rankMenuByUsage(POOL, usage)
  assert.deepEqual(ranked.map((x) => x.key), ['orders', 'salary', 'employees', 'attendance', 'worklog-manage', 'qc'])
})

test('同频次保持池内默认顺序（稳定）', () => {
  // attendance 与 worklog-manage 同为 3 次 → 仍按池顺序 attendance 在前
  const usage = { attendance: 3, 'worklog-manage': 3 }
  const ranked = rankMenuByUsage(POOL, usage)
  assert.deepEqual(ranked.slice(0, 2).map((x) => x.key), ['attendance', 'worklog-manage'])
})

test('bumpUsage 递增且不可变', () => {
  const u0 = {}
  const u1 = bumpUsage(u0, 'orders')
  assert.equal(u1.orders, 1)
  assert.deepEqual(u0, {}) // 原对象不被修改
  const u2 = bumpUsage(u1, 'orders')
  assert.equal(u2.orders, 2)
  assert.equal(bumpUsage(u2, '').orders, 2) // 空 key 不加
})

test('高频入口会顶掉默认入口进入前 4', () => {
  const usage = { salary: 8, qc: 6 } // 薪酬、质检被频繁使用
  const top4 = rankMenuByUsage(POOL, usage).slice(0, 4).map((x) => x.key)
  assert.deepEqual(top4, ['salary', 'qc', 'employees', 'attendance'])
})
