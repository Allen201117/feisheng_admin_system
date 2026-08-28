const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getDaysInMonth,
  countElapsedDays,
  buildMonthAttendanceOverview
} = require('../cloudfunctions/attendance/attendance-summary.logic')
const {
  computeLeaveDays,
  normalizeHalfDays,
  buildMonthLeaveMap,
  isFullAttendance,
  countLeaveDays
} = require('../cloudfunctions/attendance/leave.logic')

test('getDaysInMonth 处理闰年二月', () => {
  assert.equal(getDaysInMonth('2026-02'), 28)
  assert.equal(getDaysInMonth('2028-02'), 29)
  assert.equal(getDaysInMonth('2026-08'), 31)
  assert.equal(getDaysInMonth('bad'), 0)
})

test('已过去天数：过去的月份算整月，当月只算到今天，未来月份为 0', () => {
  assert.equal(countElapsedDays('2026-07', '2026-08-15'), 31)
  assert.equal(countElapsedDays('2026-08', '2026-08-15'), 15)
  assert.equal(countElapsedDays('2026-09', '2026-08-15'), 0)
})

test('半天请假记 0.5 天，老记录没有 half_days 一律当全天', () => {
  assert.equal(computeLeaveDays(['2026-08-01', '2026-08-02'], { '2026-08-01': 'am' }), 1.5)
  assert.equal(computeLeaveDays(['2026-08-01', '2026-08-02'], null), 2)
  assert.equal(countLeaveDays({ dates: ['2026-08-01'], half_days: { '2026-08-01': 'pm' } }), 0.5)
  // 存了 day_count 就以它为准（发生过改口径也不会追溯改历史记录）
  assert.equal(countLeaveDays({ dates: ['2026-08-01', '2026-08-02'], day_count: 1.5 }), 1.5)
})

test('half_days 只认 dates 里存在且值为 am/pm 的项，脏数据被丢掉', () => {
  const out = normalizeHalfDays(
    { '2026-08-01': 'am', '2026-08-09': 'pm', '2026-08-02': 'whole' },
    ['2026-08-01', '2026-08-02']
  )
  assert.deepEqual(out, { '2026-08-01': 'am' })
})

test('同一天上午+下午两条记录合成全天', () => {
  const map = buildMonthLeaveMap([
    { user_id: 'u1', status: 'active', dates: ['2026-08-05'], half_days: { '2026-08-05': 'am' } },
    { user_id: 'u1', status: 'active', dates: ['2026-08-05'], half_days: { '2026-08-05': 'pm' } }
  ])
  assert.equal(map.u1['2026-08-05'], 'full')
})

test('已撤销的请假不进日历也不算天数', () => {
  const map = buildMonthLeaveMap([
    { user_id: 'u1', status: 'cancelled', dates: ['2026-08-05'] }
  ])
  assert.deepEqual(map, {})
})

test('全勤口径：请假 ≤ 2 天算全勤，超过 2 天不算', () => {
  assert.equal(isFullAttendance(0), true)
  assert.equal(isFullAttendance(2), true)
  assert.equal(isFullAttendance(2.5), false)
  assert.equal(isFullAttendance(3), false)
})

test('月度总览：出勤/请假/缺勤/未到 四态分清，且全勤按 ≤2 天判定', () => {
  const overview = buildMonthAttendanceOverview({
    month: '2026-08',
    today: '2026-08-05',
    users: [
      { _id: 'u1', name: '张三', role: 'employee' },
      { _id: 'u2', name: '李四', role: 'employee' }
    ],
    attendances: [
      { user_id: 'u1', date: '2026-08-01', hours: 8, clock_in_time: '2026-08-01T01:00:00Z' },
      { user_id: 'u1', date: '2026-08-02', hours: 7.5, clock_in_time: '2026-08-02T01:00:00Z' },
      // 只有记录没签到时间的不算出勤
      { user_id: 'u2', date: '2026-08-01', hours: 0, clock_in_time: '' }
    ],
    leaves: [
      { user_id: 'u1', status: 'active', dates: ['2026-08-03'], half_days: { '2026-08-03': 'am' }, day_count: 0.5 },
      { user_id: 'u2', status: 'active', dates: ['2026-08-01', '2026-08-02', '2026-08-03'], day_count: 3 }
    ]
  })

  const zhang = overview.employees.find(e => e.user_id === 'u1')
  const li = overview.employees.find(e => e.user_id === 'u2')

  assert.equal(zhang.present_days, 2)
  assert.equal(zhang.leave_days, 0.5)
  assert.equal(zhang.absent_days, 2) // 8-04、8-05 既没打卡也没请假
  assert.equal(zhang.total_hours, 15.5)
  assert.equal(zhang.is_full_attendance, true)

  assert.equal(li.present_days, 0)
  assert.equal(li.leave_days, 3)
  assert.equal(li.absent_days, 2) // 8-04、8-05
  assert.equal(li.is_full_attendance, false)

  // 8-06 之后还没到，不算缺勤
  assert.equal(zhang.days.find(d => d.date === '2026-08-06').status, 'future')
  assert.equal(zhang.days.find(d => d.date === '2026-08-03').status, 'leave')
  assert.equal(zhang.days.find(d => d.date === '2026-08-03').leave_kind, 'am')
  assert.equal(zhang.days.length, 31)

  assert.equal(overview.summary.employee_count, 2)
  assert.equal(overview.summary.full_attendance_count, 1)
  assert.equal(overview.summary.not_full_count, 1)
  assert.equal(overview.summary.total_leave_days, 3.5)
})

test('列表把不全勤的排在前面，方便老板一眼看到要盯的人', () => {
  const overview = buildMonthAttendanceOverview({
    month: '2026-08',
    today: '2026-08-31',
    users: [
      { _id: 'ok', name: '全勤的', role: 'employee' },
      { _id: 'bad', name: '请太多的', role: 'employee' }
    ],
    attendances: [],
    leaves: [
      { user_id: 'bad', status: 'active', dates: ['2026-08-01', '2026-08-02', '2026-08-03'], day_count: 3 }
    ]
  })
  assert.equal(overview.employees[0].user_id, 'bad')
})

test('当天既出勤又请了半天时算出勤（绿），但保留半天标记', () => {
  const overview = buildMonthAttendanceOverview({
    month: '2026-08',
    today: '2026-08-31',
    users: [{ _id: 'u1', name: '张三', role: 'employee' }],
    attendances: [
      { user_id: 'u1', date: '2026-08-01', hours: 4, clock_in_time: '2026-08-01T01:00:00Z' }
    ],
    leaves: [
      { user_id: 'u1', status: 'active', dates: ['2026-08-01'], half_days: { '2026-08-01': 'pm' }, day_count: 0.5 }
    ]
  })
  const day = overview.employees[0].days.find(d => d.date === '2026-08-01')
  assert.equal(day.status, 'present')
  assert.equal(day.leave_kind, 'pm')
})
