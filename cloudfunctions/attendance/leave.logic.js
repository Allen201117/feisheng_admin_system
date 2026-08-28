// 请假纯逻辑（CLAUDE.md §1.4）：不碰 wx / db，可被 node:test 单测。
//
// 口径：
//  - 「全勤」= 本月 active 请假合计 **≤ 2 天**（2026-08-29 老板确认的口径，此前是「一天都不能请」）。
//    半天算 0.5 天，所以 4 个半天 = 2 天仍算全勤，第 5 个半天就掉出全勤。
//  - 请假支持半天：`half_days` 是 { 'YYYY-MM-DD': 'am' | 'pm' } 映射，只标记 dates 里的日期；
//    没有 half_days 的老记录一律视为全天，向后兼容。
//  - 请假只是老板核对工资时的参考标记，永不进计件工资（§2.1）。
//  - 一条请假记录的天数优先取 day_count，缺失时按 dates + half_days 现算。

// 全勤阈值：当月请假合计 ≤ 2 天算全勤
const FULL_ATTENDANCE_MAX_LEAVE_DAYS = 2

function isFullAttendance(leaveDays) {
  return (Number(leaveDays) || 0) <= FULL_ATTENDANCE_MAX_LEAVE_DAYS
}

// 半天的三种取值：am 上午 / pm 下午 / half 只知道是半天但没说哪半（老数据迁移出来的）
const HALF_KINDS = ['am', 'pm', 'half']

// 规范化半天标记：只保留 dates 里存在、且值合法的项
function normalizeHalfDays(halfDays, dates) {
  const allowed = {}
  ;(Array.isArray(dates) ? dates : []).forEach(function (d) { allowed[String(d)] = true })
  const out = {}
  const src = halfDays && typeof halfDays === 'object' ? halfDays : {}
  Object.keys(src).forEach(function (k) {
    const v = String(src[k])
    if (!allowed[k]) return
    if (HALF_KINDS.indexOf(v) < 0) return
    out[k] = v
  })
  return out
}

// 从请假备注里认出「其实是请半天」——老数据迁移用（半天功能上线前，老板只能把"上午休息"写进备注）。
// 返回 'am' | 'pm' | 'half' | ''（''=看不出是半天）。
// 先认上午/下午这种明确的，再兜底认「半天」这种没说哪半的；宁可返回 'half' 也不瞎猜是上午还是下午。
const AM_WORDS = ['上午', '早上', '早晨', '上半天', '前半天', '早班', '上半晌', '中午前']
const PM_WORDS = ['下午', '下半天', '后半天', '午后', '晚班', '下半晌', '傍晚']
const HALF_WORDS = ['半天', '半日', '0.5天', '.5天']

function detectHalfDayFromReason(reason) {
  const text = String(reason || '')
  if (!text) return ''
  for (var i = 0; i < AM_WORDS.length; i++) {
    if (text.indexOf(AM_WORDS[i]) >= 0) return 'am'
  }
  for (var j = 0; j < PM_WORDS.length; j++) {
    if (text.indexOf(PM_WORDS[j]) >= 0) return 'pm'
  }
  for (var k = 0; k < HALF_WORDS.length; k++) {
    if (text.indexOf(HALF_WORDS[k]) >= 0) return 'half'
  }
  return ''
}

// 挑出需要修的请假记录，返回待修清单（纯函数）。两种情况：
//   fix_type='reason'   —— 备注里其实写着半天、但库里按全天记着（半天功能上线前的老数据）
//   fix_type='day_count'—— half_days 已经标了半天，但 day_count 还是按全天记着（两个字段对不上）
// 第二种是真实踩到的：列表上会出现「上午 · 1 天」这种自相矛盾的行，全勤天数也跟着多算。
// 都只在「算出来的天数 ≠ 库里存的天数」时才进清单，所以幂等、可重复跑。
function planLegacyHalfDayMigration(records) {
  const plan = []
  ;(records || []).forEach(function (r) {
    if (!r || r.status !== 'active') return
    const dates = Array.isArray(r.dates) ? r.dates : []
    if (dates.length === 0) return

    const existing = normalizeHalfDays(r.half_days, dates)
    const oldDayCount = countLeaveDays(r)

    let halfDays
    let kind
    let fixType
    if (Object.keys(existing).length > 0) {
      // 已经标过半天：不动 half_days，只看 day_count 对不对得上
      halfDays = existing
      const kinds = Object.keys(existing).map(function (k) { return existing[k] })
      kind = kinds.every(function (k) { return k === kinds[0] }) ? kinds[0] : 'half'
      fixType = 'day_count'
    } else {
      kind = detectHalfDayFromReason(r.reason)
      if (!kind) return
      halfDays = {}
      dates.forEach(function (d) { halfDays[String(d)] = kind })
      fixType = 'reason'
    }

    const newDayCount = computeLeaveDays(dates, halfDays)
    if (newDayCount === oldDayCount) return

    plan.push({
      _id: r._id,
      user_id: r.user_id,
      user_name: r.user_name || '',
      month: r.month || '',
      dates: dates.slice(),
      reason: r.reason || '',
      kind: kind,
      fix_type: fixType,
      half_days: halfDays,
      old_day_count: oldDayCount,
      new_day_count: newDayCount
    })
  })
  return plan
}

// 按 dates + half_days 现算天数（半天记 0.5）
function computeLeaveDays(dates, halfDays) {
  const list = Array.isArray(dates) ? dates : []
  const half = normalizeHalfDays(halfDays, list)
  let total = 0
  list.forEach(function (d) { total += half[String(d)] ? 0.5 : 1 })
  return Math.round(total * 2) / 2
}

// 单条请假记录的天数（半天记 0.5）
function countLeaveDays(record) {
  if (!record) return 0
  if (typeof record.day_count === 'number' && record.day_count >= 0) return record.day_count
  if (Array.isArray(record.dates)) return computeLeaveDays(record.dates, record.half_days)
  return 0
}

// 汇总某月各员工「哪天请了假、是全天还是半天」：{ [user_id]: { [date]: 'full'|'am'|'pm' } }
// 同一天有多条记录时，半天遇上全天以全天为准（更严格的那个）。
function buildMonthLeaveMap(records) {
  const map = {}
  ;(records || []).forEach(function (r) {
    if (!r || r.status !== 'active' || !r.user_id) return
    const dates = Array.isArray(r.dates) ? r.dates : []
    const half = normalizeHalfDays(r.half_days, dates)
    if (!map[r.user_id]) map[r.user_id] = {}
    const slot = map[r.user_id]
    dates.forEach(function (d) {
      const key = String(d)
      const kind = half[key] || 'full'
      if (slot[key] === 'full') return
      if (slot[key] && slot[key] !== kind) slot[key] = 'full' // 上午+下午 = 全天
      else slot[key] = kind
    })
  })
  return map
}

// 一个员工的「日期→全天/半天」映射折算成天数
function countDaysFromLeaveSlot(slot) {
  let total = 0
  Object.keys(slot || {}).forEach(function (d) { total += slot[d] === 'full' ? 1 : 0.5 })
  return Math.round(total * 2) / 2
}

// 汇总某月各员工请假天数：返回 { [user_id]: day_count }
// 只统计 status==='active' 的记录。
// ⚠️ 必须按「去重后的日期」算，不能把多条记录的 day_count 直接相加：
// 实际数据里存在同一员工同一天被两条请假记录覆盖的情况（比如先录了 6/23+6/24，
// 又单独录了一条 6/23），直接相加会把 2 天算成 3 天，进而把本来全勤的人误判成不全勤。
function summarizeMonthLeave(records) {
  const leaveMap = buildMonthLeaveMap(records)
  const map = {}
  Object.keys(leaveMap).forEach(function (uid) {
    const days = countDaysFromLeaveSlot(leaveMap[uid])
    if (days > 0) map[uid] = days
  })
  // 兜底：极少数只有 day_count、没有 dates 的脏记录没法按日期去重，只能累加
  ;(records || []).forEach(function (r) {
    if (!r || r.status !== 'active' || !r.user_id) return
    if (Array.isArray(r.dates) && r.dates.length > 0) return
    const days = countLeaveDays(r)
    if (days <= 0) return
    map[r.user_id] = Math.round(((map[r.user_id] || 0) + days) * 2) / 2
  })
  return map
}

// 今日请假人数：records 中 status==='active' 且 dates 含 today 的去重员工数。
// 供老板首页考勤卡展示；来源不分（员工提报 + 老板代录都算），与全勤口径一致。
function countTodayLeave(records, today) {
  if (!today) return 0
  const set = {}
  ;(records || []).forEach(function (r) {
    if (!r || r.status !== 'active' || !r.user_id) return
    const dates = Array.isArray(r.dates) ? r.dates : []
    if (dates.indexOf(today) >= 0) set[r.user_id] = true
  })
  return Object.keys(set).length
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
  FULL_ATTENDANCE_MAX_LEAVE_DAYS,
  HALF_KINDS,
  detectHalfDayFromReason,
  planLegacyHalfDayMigration,
  isFullAttendance,
  normalizeHalfDays,
  computeLeaveDays,
  buildMonthLeaveMap,
  countDaysFromLeaveSlot,
  countLeaveDays,
  summarizeMonthLeave,
  countTodayLeave,
  canCancelLeave,
  normalizeLeaveDates
}
