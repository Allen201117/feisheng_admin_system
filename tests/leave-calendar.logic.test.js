const test = require('node:test')
const assert = require('node:assert/strict')

const {
  pad2,
  buildLeaveCalendar,
  formatMonthLabel,
  summarizeDays,
  datesToCn
} = require('../miniprogram/utils/leave-calendar.logic')

test('buildLeaveCalendar lays out lead blanks + all days of month', () => {
  // 2026-06 的 1 号是周一 → 前面 1 个空格（周日列留空）
  const cells = buildLeaveCalendar('2026-06', [], '2026-06-15', false)
  const blanks = cells.filter((c) => c.empty)
  const days = cells.filter((c) => !c.empty)
  assert.equal(blanks.length, 1)
  assert.equal(days.length, 30)
  assert.equal(days[0].dateStr, '2026-06-01')
  assert.equal(days[29].dateStr, '2026-06-30')
})

test('employee mode (allowPast=false) blocks past days, keeps today+future selectable', () => {
  const cells = buildLeaveCalendar('2026-06', [], '2026-06-15', false)
  const d10 = cells.find((c) => c.dateStr === '2026-06-10')
  const d15 = cells.find((c) => c.dateStr === '2026-06-15')
  const d20 = cells.find((c) => c.dateStr === '2026-06-20')
  assert.equal(d10.selectable, false) // 过去不可选
  assert.equal(d15.selectable, true)  // 今天可选
  assert.equal(d15.isToday, true)
  assert.equal(d20.selectable, true)  // 未来可选
})

test('boss mode (allowPast=true) lets any day of month be selected (backfill)', () => {
  const cells = buildLeaveCalendar('2026-06', ['2026-06-10'], '2026-06-15', true)
  const d10 = cells.find((c) => c.dateStr === '2026-06-10')
  const d01 = cells.find((c) => c.dateStr === '2026-06-01')
  assert.equal(d01.selectable, true) // 老板可补录已过去日期
  assert.equal(d10.selectable, true)
  assert.equal(d10.selected, true)   // 已选中回显
})

test('leap year February has 29 days', () => {
  const cells = buildLeaveCalendar('2024-02', [], '2024-02-01', true)
  assert.equal(cells.filter((c) => !c.empty).length, 29)
})

test('formatMonthLabel / summarizeDays / datesToCn / pad2', () => {
  assert.equal(pad2(3), '03')
  assert.equal(pad2(12), '12')
  assert.equal(formatMonthLabel('2026-06'), '2026年6月')
  assert.equal(summarizeDays(['2026-06-03', '2026-06-01']), '1、3 日')
  assert.equal(summarizeDays([]), '')
  assert.equal(datesToCn(['2026-06-01', '2026-07-02']), '6月1日、7月2日')
})
