/**
 * 北京时间工具模块 — 云函数端
 * 与 miniprogram/utils/beijing-time.js 保持完全一致的逻辑
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

function nowUTC() {
  return Date.now()
}

function toUTCTimestamp(input) {
  if (!input) return 0
  if (typeof input === 'number') return input
  if (input instanceof Date) return input.getTime()
  if (typeof input === 'string') {
    var t = new Date(input).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (input.$date) {
    var t2 = new Date(input.$date).getTime()
    return Number.isNaN(t2) ? 0 : t2
  }
  if (input.seconds) {
    return parseInt(input.seconds, 10) * 1000 + Math.floor((parseInt(input.nanoseconds, 10) || 0) / 1000000)
  }
  return 0
}

function getNowBeijingDate() {
  return new Date(Date.now() + BEIJING_OFFSET_MS)
}

function toBeijingDate(utcInput) {
  var ts = toUTCTimestamp(utcInput)
  if (!ts) return null
  return new Date(ts + BEIJING_OFFSET_MS)
}

function getBeijingFields(utcInput) {
  var d = utcInput ? toBeijingDate(utcInput) : getNowBeijingDate()
  if (!d) return null
  return {
    year: d.getUTCFullYear(),
    month: d.getUTCMonth() + 1,
    day: d.getUTCDate(),
    hours: d.getUTCHours(),
    minutes: d.getUTCMinutes(),
    seconds: d.getUTCSeconds()
  }
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

function getBeijingToday() {
  var f = getBeijingFields()
  return f.year + '-' + pad2(f.month) + '-' + pad2(f.day)
}

function getBeijingMonth() {
  var f = getBeijingFields()
  return f.year + '-' + pad2(f.month)
}

function getBeijingYear() {
  return getBeijingFields().year
}

function formatBeijingDate(utcInput) {
  if (!utcInput) return ''
  var f = getBeijingFields(utcInput)
  if (!f) return ''
  return f.year + '-' + pad2(f.month) + '-' + pad2(f.day)
}

function formatBeijingTime(utcInput) {
  if (!utcInput) return ''
  var f = getBeijingFields(utcInput)
  if (!f) return ''
  return pad2(f.hours) + ':' + pad2(f.minutes) + ':' + pad2(f.seconds)
}

function formatBeijingDateTime(utcInput) {
  if (!utcInput) return ''
  var f = getBeijingFields(utcInput)
  if (!f) return ''
  return f.year + '-' + pad2(f.month) + '-' + pad2(f.day) + ' ' + pad2(f.hours) + ':' + pad2(f.minutes)
}

function formatBeijingTimeShort(utcInput) {
  if (!utcInput) return ''
  var f = getBeijingFields(utcInput)
  if (!f) return ''
  return pad2(f.hours) + ':' + pad2(f.minutes)
}

function getBeijingMonthRange(monthStr) {
  if (!monthStr) monthStr = getBeijingMonth()
  var parts = monthStr.split('-')
  var year = parseInt(parts[0], 10)
  var m = parseInt(parts[1], 10)
  var startDate = year + '-' + pad2(m) + '-01'
  var endDate = m >= 12 ? (year + 1) + '-01-01' : year + '-' + pad2(m + 1) + '-01'
  return { startDate: startDate, endDate: endDate, month: monthStr }
}

function getBeijingYearRange(yearValue) {
  var year = parseInt(yearValue, 10) || getBeijingYear()
  return { startDate: year + '-01-01', endDate: (year + 1) + '-01-01', year: String(year) }
}

function getBeijingDayRange(dateStr) {
  if (!dateStr) dateStr = getBeijingToday()
  var parts = dateStr.split('-')
  var year = parseInt(parts[0], 10)
  var month = parseInt(parts[1], 10) - 1
  var day = parseInt(parts[2], 10)
  var startUTC = Date.UTC(year, month, day) - BEIJING_OFFSET_MS
  var endUTC = startUTC + 24 * 60 * 60 * 1000
  return { startUTC: startUTC, endUTC: endUTC }
}

function isSameBeijingDay(utcInput1, utcInput2) {
  return formatBeijingDate(utcInput1) === formatBeijingDate(utcInput2)
}

function getBeijingMonthStart(utcInput) {
  var f = utcInput ? getBeijingFields(utcInput) : getBeijingFields()
  if (!f) return ''
  return f.year + '-' + pad2(f.month) + '-01'
}

function getBeijingMonthEnd(utcInput) {
  var f = utcInput ? getBeijingFields(utcInput) : getBeijingFields()
  if (!f) return ''
  var lastDay = new Date(Date.UTC(f.year, f.month, 0)).getUTCDate()
  return f.year + '-' + pad2(f.month) + '-' + pad2(lastDay)
}

function calcHoursBetween(startUTC, endUTC) {
  var s = toUTCTimestamp(startUTC)
  var e = toUTCTimestamp(endUTC)
  if (!s || !e || e <= s) return 0
  return Math.round((e - s) / (1000 * 60 * 60) * 100) / 100
}

module.exports = {
  BEIJING_OFFSET_MS: BEIJING_OFFSET_MS,
  nowUTC: nowUTC,
  toUTCTimestamp: toUTCTimestamp,
  getNowBeijingDate: getNowBeijingDate,
  toBeijingDate: toBeijingDate,
  getBeijingFields: getBeijingFields,
  getBeijingToday: getBeijingToday,
  getBeijingMonth: getBeijingMonth,
  getBeijingYear: getBeijingYear,
  formatBeijingDate: formatBeijingDate,
  formatBeijingTime: formatBeijingTime,
  formatBeijingDateTime: formatBeijingDateTime,
  formatBeijingTimeShort: formatBeijingTimeShort,
  getBeijingMonthRange: getBeijingMonthRange,
  getBeijingYearRange: getBeijingYearRange,
  getBeijingDayRange: getBeijingDayRange,
  isSameBeijingDay: isSameBeijingDay,
  getBeijingMonthStart: getBeijingMonthStart,
  getBeijingMonthEnd: getBeijingMonthEnd,
  calcHoursBetween: calcHoursBetween
}
