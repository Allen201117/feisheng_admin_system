// 请假日历纯函数（可被 node:test 单测，不依赖 wx / new Date）。
// 「今天」一律由调用方传入北京日期串（§1.3），本文件不自行取当下时间。
//
// 员工自助请假：只能选今天及以后（allowPast=false）。
// 老板代员工补录：允许选当月任意日期，含已过去的（allowPast=true），
//   因为老板代录的本质是补登已发生的请假。
//
// 半天请假（2026-08-29）：选中状态不再是「选没选」两态，而是一个 { [date]: 'full'|'am'|'pm' } 映射。
// 交互上不加控件，直接**连点同一天循环切换**：未选 → 全天 → 上午 → 下午 → 未选。
// 老接口传数组（['2026-08-01', ...]）仍然可用，一律当全天，向后兼容。

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

// 把「数组 或 映射」统一成 { [date]: 'full'|'am'|'pm' } 映射
function normalizeSelection(selection) {
  const out = {}
  if (Array.isArray(selection)) {
    selection.forEach((d) => { out[String(d)] = 'full' })
    return out
  }
  const src = selection && typeof selection === 'object' ? selection : {}
  Object.keys(src).forEach((k) => {
    const v = String(src[k])
    if (v === 'full' || v === 'am' || v === 'pm') out[k] = v
  })
  return out
}

// 连点循环：未选 → 全天 → 上午 → 下午 → 未选。返回新映射（不改原对象）。
const LEAVE_CYCLE = { '': 'full', full: 'am', am: 'pm', pm: '' }

function cycleLeaveSelection(selection, dateStr) {
  const next = normalizeSelection(selection)
  const cur = next[dateStr] || ''
  const to = LEAVE_CYCLE[cur]
  if (to) next[dateStr] = to
  else delete next[dateStr]
  return next
}

function selectionDates(selection) {
  return Object.keys(normalizeSelection(selection)).sort()
}

// 只把半天项摘出来给云函数：{ [date]: 'am'|'pm' }（全天项不需要标记）
function selectionHalfDays(selection) {
  const map = normalizeSelection(selection)
  const out = {}
  Object.keys(map).forEach((k) => { if (map[k] !== 'full') out[k] = map[k] })
  return out
}

// 半天记 0.5 天
function selectionDayCount(selection) {
  const map = normalizeSelection(selection)
  let total = 0
  Object.keys(map).forEach((k) => { total += map[k] === 'full' ? 1 : 0.5 })
  return Math.round(total * 2) / 2
}

// '1 全天、3 上午、5 下午'
function summarizeLeaveSelection(selection) {
  const map = normalizeSelection(selection)
  const label = { full: '全天', am: '上午', pm: '下午' }
  return Object.keys(map).sort().map((d) => {
    return parseInt(String(d).split('-')[2], 10) + ' ' + label[map[d]]
  }).join('、')
}

// 构建某月日历格子。selection=已选中的日期（数组或 {date:'full'|'am'|'pm'} 映射）；today=北京今天。
// allowPast=true 时当月所有日期可选（老板补录）；否则仅今天及以后（员工自助）。
function buildLeaveCalendar(month, selection, today, allowPast) {
  const parts = String(month).split('-')
  const y = parseInt(parts[0])
  const m = parseInt(parts[1])
  const lead = firstWeekday(y, m)
  const total = daysInMonth(y, m)
  const selectedMap = normalizeSelection(selection)
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
      selected: !!selectedMap[dateStr],
      half: selectedMap[dateStr] === 'full' ? '' : (selectedMap[dateStr] || ''),
      halfLabel: selectedMap[dateStr] === 'am' ? '上' : (selectedMap[dateStr] === 'pm' ? '下' : ''),
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
  firstWeekday,
  daysInMonth,
  normalizeSelection,
  cycleLeaveSelection,
  selectionDates,
  selectionHalfDays,
  selectionDayCount,
  summarizeLeaveSelection,
  buildLeaveCalendar,
  formatMonthLabel,
  summarizeDays,
  datesToCn
}
