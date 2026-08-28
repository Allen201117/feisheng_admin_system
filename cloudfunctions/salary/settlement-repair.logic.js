// 存量结算价对账修复（纯函数，无 wx/db 副作用）。
//
// 要解决的历史脏数据：老板改了工序单价，但历史「未发薪」报工的 snapshot_price 没被同步落库
// （旧部署 / 月锁污染 / 逐条写超时半同步都会造成）。因为读时口径是「未发薪按工序当前价覆盖」，
// 这些脏数据在发薪前是看不见的；一旦发薪锁定，明细立刻翻回旧 snapshot_price，
// 于是出现「结算价 ¥0.3 · 当前价 ¥0.2」，而且和 SalaryPayments 里记的实发总额对不上。
//
// 修复口径（关键，别绕过）：
//   - 未发薪报工：直接按工序当前价重写，安全（本来就该是这个数）。
//   - 已发薪报工：CLAUDE.md §2.2 红线是「已发薪报工的 snapshot_price 永不被改价触碰」。
//     这里做的不是改价，是**对账**：只有当「按发薪当时的口径重算出来的总额 == SalaryPayments.total_amount」时，
//     才说明发薪那一刻用的就是工序当前价、只是没固化回 DB，此时重写属于把 DB 补成实发值。
//     对不上账的组一律不动，列进 manual_review 交给老板人工判断。
//
// 「发薪当时的口径」= 把这一组自己的发薪记录摘掉后的 paidSets（那一刻它还没发薪），
// 再跑 applyCurrentPricesToUnpaidLogs —— 与 markPaid 里算 total_amount 走的是同一条代码路径。

const {
  round2,
  normalizePrice,
  getMonthKey,
  buildPaidSets,
  applyCurrentPricesToUnpaidLogs
} = require('./settlement-price.logic')

const AMOUNT_EPSILON = 0.011

function paymentScopeKey(payment) {
  if (!payment || !payment.user_id) return ''
  if (payment.order_id) return `${payment.user_id}::order::${payment.order_id}`
  if (payment.month) return `${payment.user_id}::month::${payment.month}`
  return ''
}

// 一条报工归属于哪个发薪组：与 isWorklogPaid 同口径，按订单优先、按月兜底。
function worklogScopeKey(log, sets) {
  if (!log || !log.user_id || !sets) return ''
  if (log.order_id && sets.orderSet && sets.orderSet.has(`${log.user_id}::${log.order_id}`)) {
    return `${log.user_id}::order::${log.order_id}`
  }
  const monthKey = getMonthKey(log.date)
  if (monthKey && sets.monthSet && sets.monthSet.has(`${log.user_id}::${monthKey}`)) {
    return `${log.user_id}::month::${monthKey}`
  }
  return ''
}

function sumAdjustments(adjustments) {
  let reward = 0
  let penalty = 0
  ;(adjustments || []).forEach((adj) => {
    if (!adj) return
    if (adj.type === 'reward') reward += Number(adj.amount) || 0
    else penalty += Number(adj.amount) || 0
  })
  return { reward, penalty }
}

// 某条奖惩是否属于该发薪组（与 calcUserOrderSalary / calcUserSalary 的取数口径一致）
function adjustmentsForScope(adjustments, payment) {
  return (adjustments || []).filter((adj) => {
    if (!adj || adj.user_id !== payment.user_id) return false
    if (payment.order_id) return adj.order_id === payment.order_id
    return adj.month === payment.month
  })
}

function totalFromLogs(logs, reward, penalty) {
  let piece = 0
  ;(logs || []).forEach((log) => {
    piece += round2((Number(log.quantity) || 0) * (normalizePrice(log.snapshot_price) || 0))
  })
  return Math.max(0, round2(round2(piece) + reward - penalty))
}

// 逐个已发薪组做对账，返回 { repairable, manualReview }
//   repairable[i] = { scopeKey, payment, updates: [{_id, data:{snapshot_price, amount}}], recordedTotal, recomputedTotal }
//   manualReview[i] = { scopeKey, user_name, scope, recordedTotal, recomputedByCurrentPrice, recomputedByStoredPrice, logCount, reason }
function planPaidGroupRepairs(input) {
  const payments = (input && input.payments) || []
  const logs = (input && input.logs) || []
  const adjustments = (input && input.adjustments) || []
  const processPriceMap = (input && input.processPriceMap) || {}

  const paidPayments = payments.filter(p => p && p.paid === true && paymentScopeKey(p))
  const allSets = buildPaidSets(paidPayments)

  const logsByScope = {}
  logs.forEach((log) => {
    const key = worklogScopeKey(log, allSets)
    if (!key) return
    if (!logsByScope[key]) logsByScope[key] = []
    logsByScope[key].push(log)
  })

  const repairable = []
  const manualReview = []

  paidPayments.forEach((payment) => {
    const scopeKey = paymentScopeKey(payment)
    const groupLogs = logsByScope[scopeKey] || []
    if (groupLogs.length === 0) return

    const { reward, penalty } = sumAdjustments(adjustmentsForScope(adjustments, payment))
    const recordedTotal = normalizePrice(payment.total_amount)

    // 发薪那一刻这组还没发薪 → 把自己的发薪记录摘掉后重算，走的是 markPaid 当时同一条路径
    const setsAtPayTime = buildPaidSets(paidPayments.filter(p => paymentScopeKey(p) !== scopeKey))
    const settled = applyCurrentPricesToUnpaidLogs({
      logs: groupLogs,
      processPriceMap,
      paidSets: setsAtPayTime
    })
    const recomputedByCurrentPrice = totalFromLogs(settled, reward, penalty)
    const recomputedByStoredPrice = totalFromLogs(groupLogs, reward, penalty)

    const updates = []
    settled.forEach((log, index) => {
      const raw = groupLogs[index]
      const target = normalizePrice(log.snapshot_price)
      if (target === null) return
      const data = {}
      if (normalizePrice(raw.snapshot_price) !== target) data.snapshot_price = target
      const amount = round2((Number(raw.quantity) || 0) * target)
      if (normalizePrice(raw.amount) !== amount) data.amount = amount
      if (Object.keys(data).length > 0) updates.push({ _id: raw._id, data })
    })

    if (updates.length === 0) return

    const scope = payment.order_id ? `订单 ${payment.order_name || payment.order_id}` : `${payment.month} 月`
    const base = {
      scopeKey,
      user_id: payment.user_id,
      user_name: payment.user_name || '',
      scope,
      recordedTotal,
      recomputedByCurrentPrice,
      recomputedByStoredPrice,
      logCount: groupLogs.length,
      fixCount: updates.length
    }

    if (recordedTotal === null) {
      manualReview.push({ ...base, reason: '发薪记录没有 total_amount，无法对账' })
      return
    }
    if (Math.abs(recomputedByCurrentPrice - recordedTotal) < AMOUNT_EPSILON) {
      repairable.push({ ...base, payment, updates })
      return
    }
    if (Math.abs(recomputedByStoredPrice - recordedTotal) < AMOUNT_EPSILON) {
      manualReview.push({ ...base, reason: '库里存的结算价与实发金额一致，属于发薪后才改的工价，不动' })
      return
    }
    manualReview.push({ ...base, reason: '按当前工价和按库存价都对不上实发金额，需人工确认' })
  })

  return { repairable, manualReview }
}

module.exports = {
  AMOUNT_EPSILON,
  paymentScopeKey,
  worklogScopeKey,
  sumAdjustments,
  adjustmentsForScope,
  totalFromLogs,
  planPaidGroupRepairs
}
