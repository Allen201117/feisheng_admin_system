const { test } = require('node:test')
const assert = require('node:assert')
const {
  countLeaveDays,
  summarizeMonthLeave,
  countTodayLeave,
  canCancelLeave,
  normalizeLeaveDates
} = require('../cloudfunctions/attendance/leave.logic')

test('countLeaveDays: 优先 day_count，回退 dates 长度', () => {
  assert.strictEqual(countLeaveDays({ day_count: 3 }), 3)
  assert.strictEqual(countLeaveDays({ dates: ['2026-06-01', '2026-06-02'] }), 2)
  assert.strictEqual(countLeaveDays({}), 0)
  assert.strictEqual(countLeaveDays(null), 0)
})

test('summarizeMonthLeave: 只统计 active，多条累加，cancelled 不计', () => {
  const records = [
    { user_id: 'u1', status: 'active', day_count: 2 },
    { user_id: 'u1', status: 'active', dates: ['2026-06-10'] },
    { user_id: 'u2', status: 'cancelled', day_count: 5 },
    { user_id: 'u3', status: 'active', day_count: 0 }
  ]
  const map = summarizeMonthLeave(records)
  assert.strictEqual(map.u1, 3)
  assert.strictEqual(map.u2, undefined)
  assert.strictEqual(map.u3, undefined)
})

test('summarizeMonthLeave: 空输入安全', () => {
  assert.deepStrictEqual(summarizeMonthLeave(null), {})
  assert.deepStrictEqual(summarizeMonthLeave([]), {})
})

test('全勤口径不分来源：老板代录与员工提报都计入，删除(cancelled)不计入', () => {
  const records = [
    { user_id: 'u1', status: 'active', day_count: 1 },                          // 员工自助提报
    { user_id: 'u1', status: 'active', day_count: 2, created_by_boss: true },   // 老板代录
    { user_id: 'u2', status: 'cancelled', day_count: 3, created_by_boss: true } // 老板代录后又被删除
  ]
  const map = summarizeMonthLeave(records)
  // u1：员工提报 1 天 + 老板代录 2 天 = 3 天 → 非全勤（来源不影响统计）
  assert.strictEqual(map.u1, 3)
  // u2：唯一一条已删除 → 不计入 → 视为全勤
  assert.strictEqual(map.u2, undefined)
})

test('countTodayLeave: 今日 active 请假去重人数，不分来源，cancelled/不含今日不计', () => {
  const today = '2026-07-12'
  const records = [
    { user_id: 'u1', status: 'active', dates: ['2026-07-11', '2026-07-12'] },              // 含今日 → 计
    { user_id: 'u1', status: 'active', dates: ['2026-07-12'], created_by_boss: true },      // 同员工另一条含今日 → 去重
    { user_id: 'u2', status: 'active', dates: ['2026-07-12'] },                             // 含今日 → 计
    { user_id: 'u3', status: 'active', dates: ['2026-07-13'] },                             // 不含今日 → 不计
    { user_id: 'u4', status: 'cancelled', dates: ['2026-07-12'] }                           // 已删除 → 不计
  ]
  assert.strictEqual(countTodayLeave(records, today), 2) // u1、u2
  assert.strictEqual(countTodayLeave(records, ''), 0)
  assert.strictEqual(countTodayLeave(null, today), 0)
})

test('canCancelLeave: 全部未来可撤，含今天/过去不可撤', () => {
  const today = '2026-06-22'
  // 全部严格在今天之后 → 可撤
  assert.strictEqual(canCancelLeave({ status: 'active', dates: ['2026-06-23', '2026-06-24'] }, today), true)
  // 含今天（已开始）→ 不可撤
  assert.strictEqual(canCancelLeave({ status: 'active', dates: ['2026-06-22', '2026-06-25'] }, today), false)
  // 含过去 → 不可撤
  assert.strictEqual(canCancelLeave({ status: 'active', dates: ['2026-06-21', '2026-06-30'] }, today), false)
})

test('canCancelLeave: 边界与非法输入', () => {
  const today = '2026-06-22'
  assert.strictEqual(canCancelLeave({ status: 'active', dates: ['2026-06-21'] }, today), false)
  assert.strictEqual(canCancelLeave({ status: 'cancelled', dates: ['2026-06-30'] }, today), false)
  assert.strictEqual(canCancelLeave({ status: 'active', dates: [] }, today), false)
  assert.strictEqual(canCancelLeave({ status: 'active', dates: ['2026-06-30'] }, ''), false)
  assert.strictEqual(canCancelLeave(null, today), false)
})

test('normalizeLeaveDates: 去重 + 排序 + 过滤跨月/非法', () => {
  const input = ['2026-06-12', '2026-06-12', '2026-06-10', '2026-07-01', 'bad', '2026-06-9']
  assert.deepStrictEqual(normalizeLeaveDates(input, '2026-06'), ['2026-06-10', '2026-06-12'])
})

test('normalizeLeaveDates: 不传 month 时保留全部合法日期', () => {
  assert.deepStrictEqual(
    normalizeLeaveDates(['2026-07-02', '2026-06-01'], ''),
    ['2026-06-01', '2026-07-02']
  )
  assert.deepStrictEqual(normalizeLeaveDates(null, '2026-06'), [])
})
