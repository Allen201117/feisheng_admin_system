// 考勤日历纯函数（可被 node:test 单测，不依赖 wx / new Date）。
// 云函数 attendance.getMonthAttendanceOverview 已经算好每人每天的状态（present/leave/absent/future），
// 这里只负责补上周内对齐的空格子 + 把状态翻译成 WXML 直接能用的 class 和角标文案。
// WXML 里不做任何计算（项目既有约定），所以文案/样式类一律在这里拍平。

const { firstWeekday, daysInMonth, pad2 } = require('./leave-calendar.logic')

// 全勤口径：当月请假合计 ≤ 2 天算全勤（半天记 0.5 天）。
// 真源在 cloudfunctions/attendance/leave.logic.js，这里是前端同口径副本（同 beijing-time 的做法），
// tests/attendance-calendar.logic.test.js 会校验两边阈值一致，改一处必须同步另一处。
const FULL_ATTENDANCE_MAX_LEAVE_DAYS = 2

function isFullAttendance(leaveDays) {
  return (Number(leaveDays) || 0) <= FULL_ATTENDANCE_MAX_LEAVE_DAYS
}

const STATUS_CLASS = {
  present: 'att-present',
  leave: 'att-leave',
  absent: 'att-absent',
  future: 'att-future'
}

const STATUS_TEXT = {
  present: '出勤',
  leave: '请假',
  absent: '缺勤',
  future: '未到'
}

const LEAVE_BADGE = {
  full: '假',
  am: '上',
  pm: '下'
}

// days 来自云函数：[{ day, date, status, leave_kind, hours, is_today }]
// 返回带前导空格子的日历单元格，供 WXML 直接 wx:for 渲染。
function buildAttendanceCalendar(month, days) {
  const parts = String(month).split('-')
  const y = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (!y || !m) return []

  const lead = firstWeekday(y, m)
  const total = daysInMonth(y, m)
  const byDate = {}
  ;(days || []).forEach((d) => { if (d && d.date) byDate[d.date] = d })

  const cells = []
  for (let i = 0; i < lead; i++) cells.push({ empty: true, key: 'e' + i })
  for (let d = 1; d <= total; d++) {
    const date = `${month}-${pad2(d)}`
    const info = byDate[date] || { status: 'future', leave_kind: '', hours: 0 }
    cells.push({
      empty: false,
      key: date,
      day: d,
      date,
      status: info.status,
      statusClass: STATUS_CLASS[info.status] || STATUS_CLASS.future,
      badge: info.status === 'leave' ? (LEAVE_BADGE[info.leave_kind] || '假') : '',
      // 出勤当天又请了半天：绿底 + 角标，别让老板漏掉「这天只干了半天」
      subBadge: info.status === 'present' && info.leave_kind ? (LEAVE_BADGE[info.leave_kind] || '') : '',
      isToday: !!info.is_today
    })
  }
  return cells
}

// 员工列表行：把统计数字拍平成文案 + 全勤徽章样式。
// 故意丢掉每人 31 天的 days 明细——列表只要汇总数字，日历明细留在页面实例上按 user_id 取，
// 否则几十号人 × 31 天塞进 setData（还要再复制一份给搜索结果）容易顶到 1MB 上限。
function buildEmployeeRows(employees) {
  return (employees || []).map((e) => {
    const row = { ...e }
    delete row.days
    return {
      ...row,
      leaveText: formatDays(e.leave_days),
      statText: `出勤 ${e.present_days} 天 · 请假 ${formatDays(e.leave_days)} · 缺勤 ${e.absent_days} 天`,
      badgeText: e.is_full_attendance ? '全勤' : `请假${formatDays(e.leave_days)}`,
      badgeClass: e.is_full_attendance ? 'badge-green' : 'badge-red'
    }
  })
}

// user_id → 当月每天状态，供抽屉即时出日历（不进 setData）
function buildDaysIndex(employees) {
  const index = {}
  ;(employees || []).forEach((e) => { index[e.user_id] = e.days || [] })
  return index
}

// 0.5 天不显示成 "0.5天"，显示成 "半天"；2 → "2天"
function formatDays(value) {
  const n = Number(value) || 0
  if (n === 0) return '0天'
  if (n === 0.5) return '半天'
  if (n % 1 === 0) return n + '天'
  return Math.floor(n) + '天半'
}

// 顶部概览文案
function buildOverviewText(summary) {
  const s = summary || {}
  return {
    fullText: `${s.full_attendance_count || 0}/${s.employee_count || 0}`,
    notFullText: String(s.not_full_count || 0),
    presentTodayText: String(s.present_today || 0),
    leaveTodayText: String(s.leave_today || 0),
    absentText: String(s.total_absent_days || 0)
  }
}

module.exports = {
  FULL_ATTENDANCE_MAX_LEAVE_DAYS,
  isFullAttendance,
  STATUS_CLASS,
  STATUS_TEXT,
  LEAVE_BADGE,
  formatDays,
  buildAttendanceCalendar,
  buildEmployeeRows,
  buildDaysIndex,
  buildOverviewText
}
