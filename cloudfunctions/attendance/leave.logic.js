// 请假纯逻辑（CLAUDE.md §1.4）：不碰 wx / db，可被 node:test 单测。
//
// 口径：
//  - 「全勤」= 本月没有任何 active 请假记录；否则「请假 N 天」。
//  - 请假只是老板核对工资时的参考标记，永不进计件工资（§2.1）。
//  - 一条请假记录的天数优先取 day_count，缺失时回退到 dates 数组长度。

// 单条请假记录的天数
function countLeaveDays(record) {
  if (!record) return 0
  if (typeof record.day_count === 'number' && record.day_count >= 0) return record.day_count
  if (Array.isArray(record.dates)) return record.dates.length
  return 0
}

// 汇总某月各员工请假天数：返回 { [user_id]: day_count }
// 只统计 status==='active' 的记录；同一员工多条记录累加。
function summarizeMonthLeave(records) {
  const map = {}
  ;(records || []).forEach(function (r) {
    if (!r || r.status !== 'active') return
    const uid = r.user_id
    if (!uid) return
    const days = countLeaveDays(r)
    if (days <= 0) return
    map[uid] = (map[uid] || 0) + days
  })
  return map
}

// 是否可撤销：仅当 active，且所有请假日期都在今天之后（> 今天，北京日期串 YYYY-MM-DD）。
// 含今天（已开始）或含过去的请假，不允许员工自行撤销。
function canCancelLeave(record, todayBeijing) {
  if (!record || record.status !== 'active') return false
  if (!todayBeijing) return false
  const dates = Array.isArray(record.dates) ? record.dates : []
  if (dates.length === 0) return false
  return dates.every(function (d) { return String(d) > String(todayBeijing) })
}

// 规范化请假日期：去重 + 升序 + 仅保留属于 month(YYYY-MM) 的合法 YYYY-MM-DD。
// 防止前端传脏数据 / 跨月混入。
function normalizeLeaveDates(dates, month) {
  const re = /^\d{4}-\d{2}-\d{2}$/
  const seen = {}
  const out = []
  ;(Array.isArray(dates) ? dates : []).forEach(function (d) {
    const s = String(d)
    if (!re.test(s)) return
    if (month && s.substring(0, 7) !== month) return
    if (seen[s]) return
    seen[s] = true
    out.push(s)
  })
  out.sort()
  return out
}

module.exports = {
  countLeaveDays,
  summarizeMonthLeave,
  canCancelLeave,
  normalizeLeaveDates
}
