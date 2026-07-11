// 请假日历纯函数（可被 node:test 单测，不依赖 wx / new Date）。
// 「今天」一律由调用方传入北京日期串（§1.3），本文件不自行取当下时间。
//
// 员工自助请假：只能选今天及以后（allowPast=false）。
// 老板代员工补录：允许选当月任意日期，含已过去的（allowPast=true），
//   因为老板代录的本质是补登已发生的请假。

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

// Sakamoto 算法：返回 (y, m, 1) 是星期几（0=周日 … 6=周六），纯算术、确定性。
function firstWeekday(y, m) {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  let yy = y
  if (m < 3) yy -= 1
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + 1) % 7
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

// 构建某月日历格子。selectedDates=已选中的 YYYY-MM-DD 数组；today=北京今天。
// allowPast=true 时当月所有日期可选（老板补录）；否则仅今天及以后（员工自助）。
function buildLeaveCalendar(month, selectedDates, today, allowPast) {
  const parts = String(month).split('-')
  const y = parseInt(parts[0])
  const m = parseInt(parts[1])
  const lead = firstWeekday(y, m)
  const total = daysInMonth(y, m)
  const selected = Array.isArray(selectedDates) ? selectedDates : []
  const cells = []
  for (let i = 0; i < lead; i++) cells.push({ empty: true, key: 'e' + i })
  for (let d = 1; d <= total; d++) {
    const dateStr = `${month}-${pad2(d)}`
    cells.push({
      empty: false,
      key: dateStr,
      day: d,
      dateStr,
      selectable: allowPast ? true : dateStr >= today,
      selected: selected.indexOf(dateStr) >= 0,
      isToday: dateStr === today
    })
  }
  return cells
}

function formatMonthLabel(m) {
  const p = String(m).split('-')
  return `${p[0]}年${parseInt(p[1])}月`
}

// ['2026-06-01','2026-06-03'] → '1、3 日'
function summarizeDays(selectedDates) {
  const list = Array.isArray(selectedDates) ? selectedDates : []
  if (!list.length) return ''
  const days = list.map((d) => parseInt(String(d).split('-')[2])).sort((a, b) => a - b)
  return days.join('、') + ' 日'
}

// ['2026-06-01','2026-07-02'] → '6月1日、7月2日'
function datesToCn(dates) {
  return (Array.isArray(dates) ? dates : []).map((d) => {
    const p = String(d).split('-')
    return parseInt(p[1]) + '月' + parseInt(p[2]) + '日'
  }).join('、')
}

module.exports = {
  pad2,
  buildLeaveCalendar,
  formatMonthLabel,
  summarizeDays,
  datesToCn
}
