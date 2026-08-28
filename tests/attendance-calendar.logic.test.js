const test = require('node:test')
const assert = require('node:assert/strict')

const {
  buildAttendanceCalendar,
  buildEmployeeRows,
  buildDaysIndex,
  buildOverviewText,
  formatDays,
  FULL_ATTENDANCE_MAX_LEAVE_DAYS
} = require('../miniprogram/utils/attendance-calendar.logic')
const {
  cycleLeaveSelection,
  selectionDates,
  selectionHalfDays,
  selectionDayCount,
  summarizeLeaveSelection,
  buildLeaveCalendar
} = require('../miniprogram/utils/leave-calendar.logic')
const {
  FULL_ATTENDANCE_MAX_LEAVE_DAYS: BACKEND_THRESHOLD
} = require('../cloudfunctions/attendance/leave.logic')

test('前后端全勤阈值必须一致（前端是同口径副本，改一处要同步另一处）', () => {
  assert.equal(FULL_ATTENDANCE_MAX_LEAVE_DAYS, BACKEND_THRESHOLD)
})

test('考勤日历补齐周内前导空格并翻译状态样式', () => {
  // 2026-08-01 是周六 → 前面补 6 个空格子
  const cells = buildAttendanceCalendar('2026-08', [
    { day: 1, date: '2026-08-01', status: 'present', leave_kind: '', hours: 8, is_today: false },
    { day: 2, date: '2026-08-02', status: 'leave', leave_kind: 'am', hours: 0, is_today: false },
    { day: 3, date: '2026-08-03', status: 'absent', leave_kind: '', hours: 0, is_today: true }
  ])

  assert.equal(cells.filter(c => c.empty).length, 6)
  assert.equal(cells.length, 6 + 31)

  const d1 = cells.find(c => c.key === '2026-08-01')
  assert.equal(d1.statusClass, 'att-present')
  assert.equal(d1.badge, '')

  const d2 = cells.find(c => c.key === '2026-08-02')
  assert.equal(d2.statusClass, 'att-leave')
  assert.equal(d2.badge, '上')

  const d3 = cells.find(c => c.key === '2026-08-03')
  assert.equal(d3.statusClass, 'att-absent')
  assert.equal(d3.isToday, true)

  // 云函数没返回的日子兜底为「未到」，不会渲染成缺勤吓人
  assert.equal(cells.find(c => c.key === '2026-08-20').statusClass, 'att-future')
})

test('出勤当天又请半天：绿底 + 半天角标，别让老板漏掉只干了半天', () => {
  const cells = buildAttendanceCalendar('2026-08', [
    { day: 1, date: '2026-08-01', status: 'present', leave_kind: 'pm', hours: 4, is_today: false }
  ])
  const d1 = cells.find(c => c.key === '2026-08-01')
  assert.equal(d1.statusClass, 'att-present')
  assert.equal(d1.subBadge, '下')
})

test('天数文案：0.5 天说人话叫「半天」', () => {
  assert.equal(formatDays(0), '0天')
  assert.equal(formatDays(0.5), '半天')
  assert.equal(formatDays(2), '2天')
  assert.equal(formatDays(2.5), '2天半')
})

test('员工列表行拍平成文案 + 全勤徽章样式', () => {
  const rows = buildEmployeeRows([
    { user_id: 'u1', user_name: '张三', present_days: 20, leave_days: 0.5, absent_days: 1, is_full_attendance: true },
    { user_id: 'u2', user_name: '李四', present_days: 10, leave_days: 3, absent_days: 5, is_full_attendance: false }
  ])
  assert.equal(rows[0].badgeText, '全勤')
  assert.equal(rows[0].badgeClass, 'badge-green')
  assert.equal(rows[0].statText, '出勤 20 天 · 请假 半天 · 缺勤 1 天')
  assert.equal(rows[1].badgeText, '请假3天')
  assert.equal(rows[1].badgeClass, 'badge-red')
})

test('列表行剥掉每天明细，明细单独建索引（避免 setData 顶到 1MB）', () => {
  const employees = [
    { user_id: 'u1', user_name: '张三', present_days: 1, leave_days: 0, absent_days: 0, is_full_attendance: true, days: [{ day: 1, date: '2026-08-01', status: 'present' }] }
  ]
  const rows = buildEmployeeRows(employees)
  assert.equal(rows[0].days, undefined)
  // 原始数据不能被就地改坏
  assert.equal(employees[0].days.length, 1)

  const index = buildDaysIndex(employees)
  assert.equal(index.u1.length, 1)
  assert.equal(index.u1[0].date, '2026-08-01')
})

test('概览文案', () => {
  const text = buildOverviewText({ employee_count: 10, full_attendance_count: 7, not_full_count: 3, present_today: 8, leave_today: 1 })
  assert.equal(text.fullText, '7/10')
  assert.equal(text.notFullText, '3')
  assert.equal(text.presentTodayText, '8')
  assert.equal(text.leaveTodayText, '1')
})

test('请假选中态连点循环：未选 → 全天 → 上午 → 下午 → 未选', () => {
  let sel = {}
  sel = cycleLeaveSelection(sel, '2026-08-01')
  assert.equal(sel['2026-08-01'], 'full')
  sel = cycleLeaveSelection(sel, '2026-08-01')
  assert.equal(sel['2026-08-01'], 'am')
  sel = cycleLeaveSelection(sel, '2026-08-01')
  assert.equal(sel['2026-08-01'], 'pm')
  sel = cycleLeaveSelection(sel, '2026-08-01')
  assert.equal(sel['2026-08-01'], undefined)
})

test('选中态：天数统计半天记 0.5，只把半天项发给云函数', () => {
  const sel = { '2026-08-01': 'full', '2026-08-03': 'am', '2026-08-05': 'pm' }
  assert.equal(selectionDayCount(sel), 2)
  assert.deepEqual(selectionDates(sel), ['2026-08-01', '2026-08-03', '2026-08-05'])
  assert.deepEqual(selectionHalfDays(sel), { '2026-08-03': 'am', '2026-08-05': 'pm' })
  assert.equal(summarizeLeaveSelection(sel), '1 全天、3 上午、5 下午')
})

test('请假日历兼容老的数组入参（一律当全天）', () => {
  const cells = buildLeaveCalendar('2026-08', ['2026-08-01'], '2026-08-01', true)
  const d1 = cells.find(c => c.key === '2026-08-01')
  assert.equal(d1.selected, true)
  assert.equal(d1.half, '')
  assert.equal(d1.halfLabel, '')
})

test('请假日历半天格子带上/下角标', () => {
  const cells = buildLeaveCalendar('2026-08', { '2026-08-02': 'pm' }, '2026-08-01', true)
  const d2 = cells.find(c => c.key === '2026-08-02')
  assert.equal(d2.selected, true)
  assert.equal(d2.half, 'pm')
  assert.equal(d2.halfLabel, '下')
})

test('员工自助请假仍然选不了过去的日期（allowPast=false）', () => {
  const cells = buildLeaveCalendar('2026-08', {}, '2026-08-10', false)
  assert.equal(cells.find(c => c.key === '2026-08-09').selectable, false)
  assert.equal(cells.find(c => c.key === '2026-08-10').selectable, true)
})
