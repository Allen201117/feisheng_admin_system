function pad2(value) {
  return String(value).padStart(2, '0')
}

function roundCurrency(value) {
  return Math.round((value || 0) * 100) / 100
}

function roundHours(value) {
  return Math.round((value || 0) * 10) / 10
}

function getMonthKey(dateLike) {
  if (!dateLike) return ''
  return String(dateLike).slice(0, 7)
}

function getYearMonthKeys(year) {
  const yearNum = parseInt(year, 10)
  const monthKeys = []

  for (let month = 1; month <= 12; month += 1) {
    monthKeys.push(`${yearNum}-${pad2(month)}`)
  }

  return monthKeys
}

function resolvePeriodRange({ month, year } = {}) {
  const bjTime = require('./beijing-time')
  const bjFields = bjTime.getBeijingFields()

  if (year) {
    const yearNum = parseInt(year, 10) || bjFields.year
    return {
      startDate: `${yearNum}-01-01`,
      endDate: `${yearNum + 1}-01-01`,
      periodKey: String(yearNum),
      monthKeys: getYearMonthKeys(yearNum)
    }
  }

  const monthKey = month || `${bjFields.year}-${pad2(bjFields.month)}`
  const [yearText, monthText] = monthKey.split('-')
  const yearNum = parseInt(yearText, 10)
  const monthNum = parseInt(monthText, 10)
  const nextMonth = monthNum + 1

  return {
    startDate: `${yearNum}-${pad2(monthNum)}-01`,
    endDate: nextMonth > 12
      ? `${yearNum + 1}-01-01`
      : `${yearNum}-${pad2(nextMonth)}-01`,
    periodKey: monthKey,
    monthKeys: [monthKey]
  }
}

function buildPaidStatusMap({ salaryList, payments }) {
  const paidMonthMap = {}

  ;(payments || []).forEach((payment) => {
    if (!payment || !payment.paid || !payment.user_id || !payment.month) return
    if (!paidMonthMap[payment.user_id]) paidMonthMap[payment.user_id] = new Set()
    paidMonthMap[payment.user_id].add(payment.month)
  })

  return (salaryList || []).reduce((result, item) => {
    const activeMonths = item.active_months || []
    const paidMonths = paidMonthMap[item.user_id] || new Set()
    const paid = activeMonths.length > 0 && activeMonths.every((monthKey) => paidMonths.has(monthKey))

    result[item.user_id] = { paid }
    return result
  }, {})
}

function buildSalaryPeriodSummary({ users, logs, adjustments, attendances, payments, monthKeys }) {
  const allowedMonthKeys = new Set(monthKeys || [])
  const pieceRateMap = {}
  const adjustMap = {}
  const attendanceMap = {}
  const activeMonthMap = {}

  ;(logs || []).forEach((log) => {
    const userId = log && log.user_id
    const monthKey = getMonthKey(log && log.date)
    if (!userId || !monthKey || (allowedMonthKeys.size > 0 && !allowedMonthKeys.has(monthKey))) return

    if (!pieceRateMap[userId]) pieceRateMap[userId] = 0
    pieceRateMap[userId] += roundCurrency((log.quantity || 0) * (log.snapshot_price || 0))

    if (!activeMonthMap[userId]) activeMonthMap[userId] = new Set()
    activeMonthMap[userId].add(monthKey)
  })

  ;(adjustments || []).forEach((adjustment) => {
    const userId = adjustment && adjustment.user_id
    const monthKey = adjustment && adjustment.month
    if (!userId || !monthKey || (allowedMonthKeys.size > 0 && !allowedMonthKeys.has(monthKey))) return

    if (!adjustMap[userId]) adjustMap[userId] = { reward: 0, penalty: 0 }
    if (adjustment.type === 'reward') adjustMap[userId].reward += adjustment.amount || 0
    else adjustMap[userId].penalty += adjustment.amount || 0

    if (!activeMonthMap[userId]) activeMonthMap[userId] = new Set()
    activeMonthMap[userId].add(monthKey)
  })

  ;(attendances || []).forEach((attendance) => {
    const userId = attendance && attendance.user_id
    const monthKey = getMonthKey(attendance && attendance.date)
    if (!userId || !monthKey || (allowedMonthKeys.size > 0 && !allowedMonthKeys.has(monthKey))) return

    if (!attendanceMap[userId]) attendanceMap[userId] = { totalHours: 0, attendDays: 0 }
    attendanceMap[userId].totalHours += attendance.hours || 0
    if (attendance.clock_in_time) attendanceMap[userId].attendDays += 1

    if (!activeMonthMap[userId]) activeMonthMap[userId] = new Set()
    activeMonthMap[userId].add(monthKey)
  })

  const salaryList = (users || []).map((user) => {
    const userId = user._id
    const pieceRate = roundCurrency(pieceRateMap[userId] || 0)
    const reward = roundCurrency((adjustMap[userId] && adjustMap[userId].reward) || 0)
    const penalty = roundCurrency((adjustMap[userId] && adjustMap[userId].penalty) || 0)
    const total = roundCurrency(pieceRate + reward - penalty)
    const attendance = attendanceMap[userId] || { totalHours: 0, attendDays: 0 }
    const activeMonths = Array.from(activeMonthMap[userId] || []).sort()

    return {
      user_id: userId,
      user_name: user.name,
      role: user.role,
      piece_rate: pieceRate,
      reward,
      penalty,
      total: Math.max(0, total),
      attend_days: attendance.attendDays,
      total_hours: roundHours(attendance.totalHours),
      active_months: activeMonths
    }
  }).sort((left, right) => right.total - left.total)

  const paidStatusMap = buildPaidStatusMap({ salaryList, payments })
  const list = salaryList.map((item) => ({
    ...item,
    paid: !!(paidStatusMap[item.user_id] && paidStatusMap[item.user_id].paid)
  }))

  const totalExpenditure = list.reduce((sum, item) => sum + item.total, 0)

  return {
    list,
    total_expenditure: roundCurrency(totalExpenditure),
    employee_count: list.length
  }
}

module.exports = {
  resolvePeriodRange,
  buildSalaryPeriodSummary,
  buildPaidStatusMap
}
