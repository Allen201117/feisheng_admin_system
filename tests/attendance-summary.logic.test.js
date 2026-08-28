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
  countLeaveDays,
  detectHalfDayFromReason,
  planLegacyHalfDayMigration
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

test('月度总览：不看打卡，没请假的过去日子一律算出勤', () => {
  const overview = buildMonthAttendanceOverview({
    month: '2026-08',
    today: '2026-08-05',
    users: [
      { _id: 'u1', name: '张三', role: 'employee' },
      { _id: 'u2', name: '李四', role: 'employee' }
    ],
    leaves: [
      { user_id: 'u1', status: 'active', dates: ['2026-08-03'], half_days: { '2026-08-03': 'am' }, day_count: 0.5, reason: '看病' },
      { user_id: 'u2', status: 'active', dates: ['2026-08-01', '2026-08-02', '2026-08-03'], day_count: 3 }
    ]
  })

  const zhang = overview.employees.find(e => e.user_id === 'u1')
  const li = overview.employees.find(e => e.user_id === 'u2')

  // 8-01~8-05 共 5 天已过去，张三 8-03 请了半天 → 出勤 4.5 天
  assert.equal(zhang.present_days, 4.5)
  assert.equal(zhang.leave_days, 0.5)
  assert.equal(zhang.is_full_attendance, true)

  // 李四 8-01~8-03 全天请假 → 只有 8-04、8-05 算出勤
  assert.equal(li.present_days, 2)
  assert.equal(li.leave_days, 3)
  assert.equal(li.is_full_attendance, false)

  // 8-06 之后还没到，既不算出勤也不算请假
  assert.equal(zhang.days.find(d => d.date === '2026-08-06').status, 'future')
  assert.equal(zhang.days.find(d => d.date === '2026-08-03').status, 'half')
  assert.equal(zhang.days.find(d => d.date === '2026-08-03').leave_kind, 'am')
  assert.equal(zhang.days.find(d => d.date === '2026-08-04').status, 'present')
  assert.equal(li.days.find(d => d.date === '2026-08-01').status, 'leave')
  assert.equal(zhang.days.length, 31)

  assert.equal(overview.summary.employee_count, 2)
  assert.equal(overview.summary.full_attendance_count, 1)
  assert.equal(overview.summary.not_full_count, 1)
  assert.equal(overview.summary.total_leave_days, 3.5)
})

test('请假明细带原因和来源，按日期升序，供抽屉逐条列出', () => {
  const overview = buildMonthAttendanceOverview({
    month: '2026-08',
    today: '2026-08-31',
    users: [{ _id: 'u1', name: '张三', role: 'employee' }],
    leaves: [
      { user_id: 'u1', status: 'active', dates: ['2026-08-09'], half_days: { '2026-08-09': 'pm' }, day_count: 0.5, reason: '接孩子', created_by_boss: true },
      { user_id: 'u1', status: 'active', dates: ['2026-08-02'], day_count: 1, reason: '事假' }
    ]
  })
  const details = overview.employees[0].leave_details
  assert.deepEqual(details.map(d => d.date), ['2026-08-02', '2026-08-09'])
  assert.equal(details[0].kind, 'full')
  assert.equal(details[0].reason, '事假')
  assert.equal(details[1].kind, 'pm')
  assert.equal(details[1].created_by_boss, true)
})

test('列表把不全勤的排在前面，方便老板一眼看到要盯的人', () => {
  const overview = buildMonthAttendanceOverview({
    month: '2026-08',
    today: '2026-08-31',
    users: [
      { _id: 'ok', name: '全勤的', role: 'employee' },
      { _id: 'bad', name: '请太多的', role: 'employee' }
    ],
    leaves: [
      { user_id: 'bad', status: 'active', dates: ['2026-08-01', '2026-08-02', '2026-08-03'], day_count: 3 }
    ]
  })
  assert.equal(overview.employees[0].user_id, 'bad')
})

test('未来已报备的请假照样标红，不会因为日子没到就当成未到', () => {
  const overview = buildMonthAttendanceOverview({
    month: '2026-08',
    today: '2026-08-05',
    users: [{ _id: 'u1', name: '张三', role: 'employee' }],
    leaves: [
      { user_id: 'u1', status: 'active', dates: ['2026-08-20'], day_count: 1 }
    ]
  })
  const days = overview.employees[0].days
  assert.equal(days.find(d => d.date === '2026-08-20').status, 'leave')
  assert.equal(days.find(d => d.date === '2026-08-21').status, 'future')
  // 未来的请假不计进「已出勤天数」，但计进全勤判定用的请假总天数
  assert.equal(overview.employees[0].present_days, 5)
  assert.equal(overview.employees[0].leave_days, 1)
})

// ===== 老数据迁移：半天功能上线前，「上午/下午」只能写在备注里 =====

test('从备注认出半天：先认上午/下午，再兜底认「半天」，认不出返回空', () => {
  assert.equal(detectHalfDayFromReason('上午休息'), 'am')
  assert.equal(detectHalfDayFromReason('早上有事'), 'am')
  assert.equal(detectHalfDayFromReason('下午看病'), 'pm')
  assert.equal(detectHalfDayFromReason('后半天请假'), 'pm')
  // 只说半天没说哪半 → 'half'，宁可标不确定也不瞎猜上午还是下午
  assert.equal(detectHalfDayFromReason('请半天事假'), 'half')
  assert.equal(detectHalfDayFromReason('感冒'), '')
  assert.equal(detectHalfDayFromReason(''), '')
  assert.equal(detectHalfDayFromReason(null), '')
})

test('迁移计划：备注写着上午的老记录转成半天，天数 1 → 0.5', () => {
  const plan = planLegacyHalfDayMigration([
    { _id: 'r1', status: 'active', user_id: 'u1', user_name: '张三', month: '2026-08', dates: ['2026-08-16'], day_count: 1, reason: '上午休息' }
  ])
  assert.equal(plan.length, 1)
  assert.equal(plan[0].kind, 'am')
  assert.deepEqual(plan[0].half_days, { '2026-08-16': 'am' })
  assert.equal(plan[0].old_day_count, 1)
  assert.equal(plan[0].new_day_count, 0.5)
})

test('迁移只碰没标过半天的记录：已用新功能标过的、备注读不出的、已撤销的都不动', () => {
  const plan = planLegacyHalfDayMigration([
    // 已经用新功能标过半天 → 不动
    { _id: 'done', status: 'active', user_id: 'u1', dates: ['2026-08-01'], half_days: { '2026-08-01': 'pm' }, day_count: 0.5, reason: '下午有事' },
    // 备注读不出半天 → 不动
    { _id: 'plain', status: 'active', user_id: 'u1', dates: ['2026-08-02'], day_count: 1, reason: '家里有事' },
    // 已撤销 → 不动
    { _id: 'gone', status: 'cancelled', user_id: 'u1', dates: ['2026-08-03'], day_count: 1, reason: '上午休息' },
    // 没备注 → 不动
    { _id: 'noreason', status: 'active', user_id: 'u1', dates: ['2026-08-04'], day_count: 1 }
  ])
  assert.deepEqual(plan, [])
})

test('迁移可重复跑：转换过的记录第二次扫不出来（幂等）', () => {
  const record = { _id: 'r1', status: 'active', user_id: 'u1', dates: ['2026-08-16'], day_count: 1, reason: '上午休息' }
  const first = planLegacyHalfDayMigration([record])
  assert.equal(first.length, 1)

  // 模拟写库后的样子
  const migrated = { ...record, half_days: first[0].half_days, day_count: first[0].new_day_count }
  assert.deepEqual(planLegacyHalfDayMigration([migrated]), [])
})

test('一条请假带多天时，备注里的半天口径套用到这条记录的每一天', () => {
  const plan = planLegacyHalfDayMigration([
    { _id: 'r1', status: 'active', user_id: 'u1', dates: ['2026-08-10', '2026-08-11'], day_count: 2, reason: '下午有事' }
  ])
  assert.deepEqual(plan[0].half_days, { '2026-08-10': 'pm', '2026-08-11': 'pm' })
  assert.equal(plan[0].new_day_count, 1)
})

test('迁移出来的 half（不知道哪半天）在日历上算半天，不算全天', () => {
  const overview = buildMonthAttendanceOverview({
    month: '2026-08',
    today: '2026-08-31',
    users: [{ _id: 'u1', name: '张三', role: 'employee' }],
    leaves: [
      { user_id: 'u1', status: 'active', dates: ['2026-08-05'], half_days: { '2026-08-05': 'half' }, day_count: 0.5, reason: '请半天' }
    ]
  })
  const day = overview.employees[0].days.find(d => d.date === '2026-08-05')
  assert.equal(day.status, 'half')
  assert.equal(day.leave_kind, 'half')
  assert.equal(overview.employees[0].leave_days, 0.5)
  assert.equal(overview.employees[0].present_days, 30.5)
})
