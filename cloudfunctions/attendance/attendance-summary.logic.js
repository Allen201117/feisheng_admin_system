// 月度考勤汇总纯逻辑（CLAUDE.md §1.4）：不碰 wx / db / new Date，可被 node:test 单测。
// 「今天」一律由调用方传入北京日期串（§1.3）。
//
// 老板要的是：一屏看清「这个月谁全勤、谁不全勤」，再点进某个人看他这个月每天的情况。
//
// 口径（2026-08-29 老板确认）：**考勤不看打卡记录，只看请假**。
//   工厂默认天天开工，没请假就是出勤。打卡数据仍然照常采集（异常补签那一栏还在用），
//   但不再参与「这天算不算出勤」的判定 —— 老板说了先不按打卡卡人。
//
// 于是每天只有两种业务状态 + 一个「还没到」：
//   present 出勤 —— 已过去、当天没请假（绿）
//   leave   请假 —— 当天全天请假（红）
//   half    半天 —— 当天只请了半天（红绿对半，角标标上午/下午）
//   future  未到 —— 日期还没到且没报备请假（不上色；标成绿色等于替他保证会来，是假数据）

const { buildMonthLeaveMap, countLeaveDays, isFullAttendance } = require('./leave.logic')

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function getDaysInMonth(month) {
  const parts = String(month).split('-')
  const y = parseInt(parts[0], 10)
  const m = parseInt(parts[1], 10)
  if (!y || !m || m < 1 || m > 12) return 0
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

// 该月已经过去（含今天）的天数：过去的月份=整月，当月=今天的日号，未来的月份=0
function countElapsedDays(month, today) {
  const total = getDaysInMonth(month)
  if (!total) return 0
  const todayMonth = String(today || '').slice(0, 7)
  if (!todayMonth) return total
  if (month < todayMonth) return total
  if (month > todayMonth) return 0
  const day = parseInt(String(today).slice(8, 10), 10) || 0
  return Math.min(day, total)
}

function round1(value) {
  return Math.round((Number(value) || 0) * 2) / 2
}

// 某员工当月每天的状态清单
function buildDayStatuses(month, leaveSlot, today) {
  const total = getDaysInMonth(month)
  const elapsed = countElapsedDays(month, today)
  const days = []
  for (let d = 1; d <= total; d++) {
    const date = `${month}-${pad2(d)}`
    const leaveKind = leaveSlot[date] || ''
    let status
    if (leaveKind === 'full') status = 'leave'
    else if (leaveKind) status = 'half'
    else if (d <= elapsed) status = 'present'
    else status = 'future'
    days.push({
      day: d,
      date,
      status,
      leave_kind: leaveKind,
      is_today: date === today
    })
  }
  return days
}

// 某员工当月的请假明细（供抽屉里逐条列出来，带原因）
function buildLeaveDetails(leaves, userId) {
  const rows = []
  ;(leaves || []).forEach((r) => {
    if (!r || r.status !== 'active' || r.user_id !== userId) return
    const dates = Array.isArray(r.dates) ? r.dates : []
    const half = (r.half_days && typeof r.half_days === 'object') ? r.half_days : {}
    dates.forEach((d) => {
      const kind = half[d] === 'am' || half[d] === 'pm' ? half[d] : 'full'
      rows.push({
        date: String(d),
        kind,
        reason: r.reason || '',
        created_by_boss: !!r.created_by_boss
      })
    })
  })
  rows.sort((a, b) => (a.date < b.date ? -1 : (a.date > b.date ? 1 : 0)))
  return rows
}

// 主入口：把 Users + 本月 active 的 LeaveRecords 揉成老板端要的月度视图。
// users 只需 { _id, name, role }；leaves 是本月 status==='active' 的 LeaveRecords。
function buildMonthAttendanceOverview(input) {
  const month = String((input && input.month) || '')
  const today = String((input && input.today) || '')
  const users = (input && input.users) || []
  const leaves = (input && input.leaves) || []

  const leaveMap = buildMonthLeaveMap(leaves)
  const leaveDaysByUser = {}
  leaves.forEach((r) => {
    if (!r || r.status !== 'active' || !r.user_id) return
    leaveDaysByUser[r.user_id] = (leaveDaysByUser[r.user_id] || 0) + countLeaveDays(r)
  })

  const elapsed = countElapsedDays(month, today)

  const employees = users.map((u) => {
    const leaveSlot = leaveMap[u._id] || {}
    const days = buildDayStatuses(month, leaveSlot, today)

    // 出勤天数只数「已经过去的日子」：没请假算 1 天，请半天算 0.5 天
    let presentDays = 0
    days.forEach((d) => {
      if (d.day > elapsed) return
      if (d.status === 'present') presentDays += 1
      else if (d.status === 'half') presentDays += 0.5
    })

    const leaveDays = round1(leaveDaysByUser[u._id] || 0)
    return {
      user_id: u._id,
      user_name: u.name || '',
      role: u.role || 'employee',
      present_days: round1(presentDays),
      leave_days: leaveDays,
      is_full_attendance: isFullAttendance(leaveDays),
      leave_details: buildLeaveDetails(leaves, u._id),
      days
    }
  })

  // 排序：不全勤的排前面（老板最关心），其次按请假天数多的在前，最后按姓名稳定
  employees.sort((a, b) => {
    if (a.is_full_attendance !== b.is_full_attendance) return a.is_full_attendance ? 1 : -1
    if (a.leave_days !== b.leave_days) return b.leave_days - a.leave_days
    return String(a.user_name).localeCompare(String(b.user_name))
  })

  const leaveToday = employees.filter(e => e.days.some(d => d.date === today && (d.status === 'leave' || d.status === 'half'))).length
  const presentToday = employees.filter(e => e.days.some(d => d.date === today && d.status !== 'leave' && d.status !== 'future')).length

  return {
    month,
    today,
    days_in_month: getDaysInMonth(month),
    elapsed_days: elapsed,
    summary: {
      employee_count: employees.length,
      full_attendance_count: employees.filter(e => e.is_full_attendance).length,
      not_full_count: employees.filter(e => !e.is_full_attendance).length,
      present_today: presentToday,
      leave_today: leaveToday,
      total_present_days: round1(employees.reduce((sum, e) => sum + e.present_days, 0)),
      total_leave_days: round1(employees.reduce((sum, e) => sum + e.leave_days, 0))
    },
    employees
  }
}

module.exports = {
  getDaysInMonth,
  countElapsedDays,
  buildDayStatuses,
  buildLeaveDetails,
  buildMonthAttendanceOverview
}
