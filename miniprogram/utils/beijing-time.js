/**
 * 北京时间工具模块（Asia/Shanghai UTC+8）
 * 
 * 全项目统一时间处理：
 * - 存储：UTC 时间戳 / ISO 字符串
 * - 业务逻辑：以北京时间为准（跨天、月结、迟到判断等）
 * - 展示：统一显示北京时间
 * 
 * 禁止在业务代码中直接使用 new Date() 的本地时区方法（getFullYear/getMonth/getHours 等），
 * 必须通过本模块转换后再使用。
 */

const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000 // UTC+8 = 8小时

/**
 * 获取当前 UTC 时间戳（毫秒）
 */
function nowUTC() {
  return Date.now()
}

/**
 * 将任意时间输入转换为 UTC 毫秒时间戳
 * 支持: Date, number(ms), ISO string, {$date}, {seconds, nanoseconds}
 */
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

/**
 * 获取当前北京时间的 Date 对象（通过偏移 UTC 实现，
 * 使用该 Date 对象的 getUTCXxx() 方法可得到北京时间的各字段）
 */
function getNowBeijingDate() {
  return new Date(Date.now() + BEIJING_OFFSET_MS)
}

/**
 * 将 UTC 时间戳转换为北京时间 Date（使用 getUTCXxx 读取字段）
 */
function toBeijingDate(utcInput) {
  var ts = toUTCTimestamp(utcInput)
  if (!ts) return null
  return new Date(ts + BEIJING_OFFSET_MS)
}

/**
 * 获取北京时间各字段（年月日时分秒）
 */
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

/**
 * 获取当前北京日期字符串 YYYY-MM-DD
 */
function getBeijingToday() {
  var f = getBeijingFields()
  return f.year + '-' + pad2(f.month) + '-' + pad2(f.day)
}

/**
 * 获取当前北京月份 YYYY-MM
 */
function getBeijingMonth() {
  var f = getBeijingFields()
  return f.year + '-' + pad2(f.month)
}

/**
 * 获取当前北京年份
 */
function getBeijingYear() {
  return getBeijingFields().year
}

/**
 * 格式化为北京日期 YYYY-MM-DD
 */
function formatBeijingDate(utcInput) {
  if (!utcInput) return ''
  var f = getBeijingFields(utcInput)
  if (!f) return ''
  return f.year + '-' + pad2(f.month) + '-' + pad2(f.day)
}

/**
 * 格式化为北京时间 HH:mm:ss
 */
function formatBeijingTime(utcInput) {
  if (!utcInput) return ''
  var f = getBeijingFields(utcInput)
  if (!f) return ''
  return pad2(f.hours) + ':' + pad2(f.minutes) + ':' + pad2(f.seconds)
}

/**
 * 格式化为北京日期时间 YYYY-MM-DD HH:mm
 */
function formatBeijingDateTime(utcInput) {
  if (!utcInput) return ''
  var f = getBeijingFields(utcInput)
  if (!f) return ''
  return f.year + '-' + pad2(f.month) + '-' + pad2(f.day) + ' ' + pad2(f.hours) + ':' + pad2(f.minutes)
}

/**
 * 格式化为北京时间 HH:mm（短格式，用于打卡时间显示）
 */
function formatBeijingTimeShort(utcInput) {
  if (!utcInput) return ''
  var f = getBeijingFields(utcInput)
  if (!f) return ''
  return pad2(f.hours) + ':' + pad2(f.minutes)
}

/**
 * 获取指定月份在北京时间的日期范围 [startDate, endDate)
 * @param {string} monthStr - YYYY-MM 格式，默认当前北京月份
 * @returns {{startDate: string, endDate: string, month: string}}
 */
function getBeijingMonthRange(monthStr) {
  if (!monthStr) {
    monthStr = getBeijingMonth()
  }
  var parts = monthStr.split('-')
  var year = parseInt(parts[0], 10)
  var m = parseInt(parts[1], 10)
  var startDate = year + '-' + pad2(m) + '-01'
  var endDate
  if (m >= 12) {
    endDate = (year + 1) + '-01-01'
  } else {
    endDate = year + '-' + pad2(m + 1) + '-01'
  }
  return { startDate: startDate, endDate: endDate, month: monthStr }
}

/**
 * 获取指定年份在北京时间的日期范围
 * @param {string|number} yearValue
 */
function getBeijingYearRange(yearValue) {
  var year = parseInt(yearValue, 10) || getBeijingYear()
  return {
    startDate: year + '-01-01',
    endDate: (year + 1) + '-01-01',
    year: String(year)
  }
}

/**
 * 获取北京时间某天的开始和结束 UTC 时间戳
 * @param {string} dateStr - YYYY-MM-DD 格式（北京时间日期）
 * @returns {{startUTC: number, endUTC: number}}
 */
function getBeijingDayRange(dateStr) {
  if (!dateStr) dateStr = getBeijingToday()
  var parts = dateStr.split('-')
  var year = parseInt(parts[0], 10)
  var month = parseInt(parts[1], 10) - 1
  var day = parseInt(parts[2], 10)
  // 北京时间 00:00:00 对应的 UTC 时间
  var startUTC = Date.UTC(year, month, day) - BEIJING_OFFSET_MS
  var endUTC = startUTC + 24 * 60 * 60 * 1000
  return { startUTC: startUTC, endUTC: endUTC }
}

/**
 * 判断两个时间（UTC输入）是否在北京时间同一天
 */
function isSameBeijingDay(utcInput1, utcInput2) {
  return formatBeijingDate(utcInput1) === formatBeijingDate(utcInput2)
}

/**
 * 获取北京时间当月第一天 YYYY-MM-01
 */
function getBeijingMonthStart(utcInput) {
  var f = utcInput ? getBeijingFields(utcInput) : getBeijingFields()
  if (!f) return ''
  return f.year + '-' + pad2(f.month) + '-01'
}

/**
 * 获取北京时间当月最后一天的日期字符串
 */
function getBeijingMonthEnd(utcInput) {
  var f = utcInput ? getBeijingFields(utcInput) : getBeijingFields()
  if (!f) return ''
  var lastDay = new Date(Date.UTC(f.year, f.month, 0)).getUTCDate()
  return f.year + '-' + pad2(f.month) + '-' + pad2(lastDay)
}

/**
 * 计算两个 UTC 时间之间的小时数（跟时区无关）
 */
function calcHoursBetween(startUTC, endUTC) {
  var s = toUTCTimestamp(startUTC)
  var e = toUTCTimestamp(endUTC)
  if (!s || !e || e <= s) return 0
  return Math.round((e - s) / (1000 * 60 * 60) * 100) / 100
}

/**
 * 获取北京时间"上月"月份字符串 YYYY-MM
 */
function getBeijingPrevMonth(monthStr) {
  if (!monthStr) monthStr = getBeijingMonth()
  var parts = monthStr.split('-')
  var year = parseInt(parts[0], 10)
  var m = parseInt(parts[1], 10)
  if (m <= 1) {
    return (year - 1) + '-12'
  }
  return year + '-' + pad2(m - 1)
}

/**
 * 获取北京时间"下月"月份字符串 YYYY-MM
 */
function getBeijingNextMonth(monthStr) {
  if (!monthStr) monthStr = getBeijingMonth()
  var parts = monthStr.split('-')
  var year = parseInt(parts[0], 10)
  var m = parseInt(parts[1], 10)
  if (m >= 12) {
    return (year + 1) + '-01'
  }
  return year + '-' + pad2(m + 1)
}

module.exports = {
  // 核心
  BEIJING_OFFSET_MS: BEIJING_OFFSET_MS,
  nowUTC: nowUTC,
  toUTCTimestamp: toUTCTimestamp,
  getNowBeijingDate: getNowBeijingDate,
  toBeijingDate: toBeijingDate,
  getBeijingFields: getBeijingFields,

  // 日期字符串
  getBeijingToday: getBeijingToday,
  getBeijingMonth: getBeijingMonth,
  getBeijingYear: getBeijingYear,

  // 格式化
  formatBeijingDate: formatBeijingDate,
  formatBeijingTime: formatBeijingTime,
  formatBeijingDateTime: formatBeijingDateTime,
  formatBeijingTimeShort: formatBeijingTimeShort,

  // 范围计算
  getBeijingMonthRange: getBeijingMonthRange,
  getBeijingYearRange: getBeijingYearRange,
  getBeijingDayRange: getBeijingDayRange,
  getBeijingMonthStart: getBeijingMonthStart,
  getBeijingMonthEnd: getBeijingMonthEnd,

  // 比较 & 计算
  isSameBeijingDay: isSameBeijingDay,
  calcHoursBetween: calcHoursBetween,
  getBeijingPrevMonth: getBeijingPrevMonth,
  getBeijingNextMonth: getBeijingNextMonth
}
