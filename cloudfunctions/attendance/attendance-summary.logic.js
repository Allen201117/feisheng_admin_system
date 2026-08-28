// 月度考勤汇总纯逻辑（CLAUDE.md §1.4）：不碰 wx / db / new Date，可被 node:test 单测。
// 「今天」一律由调用方传入北京日期串（§1.3）。
//
// 老板要的是：一屏看清「这个月谁全勤、谁不全勤」，再点进某个人看他这个月每天的出勤日历。
//
// 每天的状态（优先级从高到低）：
//   present 出勤 —— 当天有考勤记录且有签到时间（绿）
//   leave   请假 —— 当天有 active 请假（橙；半天标 am/pm）
//   absent  缺勤 —— 当天已过去、既没打卡也没请假（红）
//   future  未到 —— 日期还没到（灰，不算缺勤）
// 请假单独一色而不是并进红色：不然「请假 2 天以内还算全勤」的口径在日历上会自相矛盾。

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

// 某员工当月每天的状态清单
function buildDayStatuses(month, presentMap, leaveSlot, today) {
  const total = getDaysInMonth(month)
  const elapsed = countElapsedDays(month, today)
  const days = []
  for (let d = 1; d <= total; d++) {
    const date = `${month}-${pad2(d)}`
    const attendance = presentMap[date]
    const leaveKind = leaveSlot[date] || ''
    let status
    if (attendance) status = 'present'
    else if (leaveKind) status = 'leave'
    else if (d <= elapsed) status = 'absent'
    else status = 'future'
    days.push({
      day: d,
      date,
      status,
      leave_kind: leaveKind,
      hours: attendance ? (Number(attendance.hours) || 0) : 0,
      // 抽屉里的出勤明细/补签要用：签到签退时间 + 原始考勤记录 id 和状态
      attendance_id: attendance ? (attendance._id || '') : '',
      att_status: attendance ? (attendance.status || '') : '',
      clock_in_display: attendance ? (attendance.clock_in_display || '') : '',
      clock_out_display: attendance ? (attendance.clock_out_display || '') : '',
      is_today: date === today
    })
  }
  return days
}

// 主入口：把 Users / Attendances / LeaveRecords 三份原始数据揉成老板端要的月度视图。
// users 只需 { _id, name, role }；attendances 只需 { user_id, date, hours, clock_in_time }；
// leaves 是本月 status==='active' 的 LeaveRecords。
function buildMonthAttendanceOverview(input) {
  const month = String((input && input.month) || '')
  const today = String((input && input.today) || '')
  const users = (input && input.users) || []
  const attendances = (input && input.attendances) || []
  const leaves = (input && input.leaves) || []

  const leaveMap = buildMonthLeaveMap(leaves)
  const leaveDaysByUser = {}
  leaves.forEach((r) => {
    if (!r || r.status !== 'active' || !r.user_id) return
    leaveDaysByUser[r.user_id] = (leaveDaysByUser[r.user_id] || 0) + countLeaveDays(r)
  })

  // 只认「有签到时间」的记录算出勤：只建了空记录不算人来了
  const presentByUser = {}
  attendances.forEach((a) => {
    if (!a || !a.user_id || !a.date || !a.clock_in_time) return
    if (!presentByUser[a.user_id]) presentByUser[a.user_id] = {}
    presentByUser[a.user_id][String(a.date)] = a
  })

  const elapsed = countElapsedDays(month, today)

  const employees = users.map((u) => {
    const presentMap = presentByUser[u._id] || {}
    const leaveSlot = leaveMap[u._id] || {}
    const days = buildDayStatuses(month, presentMap, leaveSlot, today)

    let presentDays = 0
    let absentDays = 0
    let totalHours = 0
    days.forEach((d) => {
      if (d.status === 'present') { presentDays += 1; totalHours += d.hours }
      else if (d.status === 'absent') absentDays += 1
    })

    const leaveDays = Math.round((leaveDaysByUser[u._id] || 0) * 2) / 2
    return {
      user_id: u._id,
      user_name: u.name || '',
      role: u.role || 'employee',
      present_days: presentDays,
      absent_days: absentDays,
      leave_days: leaveDays,
      total_hours: Math.round(totalHours * 10) / 10,
      is_full_attendance: isFullAttendance(leaveDays),
      days
    }
  })

  // 排序：不全勤的排前面（老板最关心），其次按缺勤天数多的在前，最后按姓名稳定
  employees.sort((a, b) => {
    if (a.is_full_attendance !== b.is_full_attendance) return a.is_full_attendance ? 1 : -1
    if (a.absent_days !== b.absent_days) return b.absent_days - a.absent_days
    return String(a.user_name).localeCompare(String(b.user_name))
  })

  const presentToday = employees.filter(e => e.days.some(d => d.date === today && d.status === 'present')).length
  const leaveToday = employees.filter(e => e.days.some(d => d.date === today && d.status === 'leave')).length

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
      total_present_days: employees.reduce((sum, e) => sum + e.present_days, 0),
      total_absent_days: employees.reduce((sum, e) => sum + e.absent_days, 0),
      total_leave_days: Math.round(employees.reduce((sum, e) => sum + e.leave_days, 0) * 2) / 2
    },
    employees
  }
}

module.exports = {
  getDaysInMonth,
  countElapsedDays,
  buildDayStatuses,
  buildMonthAttendanceOverview
}
