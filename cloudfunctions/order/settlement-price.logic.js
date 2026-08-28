function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function normalizePrice(value) {
  if (value === null || value === undefined || value === '') return null
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

function getMonthKey(dateStr) {
  if (!dateStr || typeof dateStr !== 'string' || dateStr.length < 7) return ''
  return dateStr.slice(0, 7)
}

function buildPaidSets(payments) {
  const monthSet = new Set()
  const orderSet = new Set()
  ;(payments || []).forEach((payment) => {
    if (!payment || payment.paid !== true || !payment.user_id) return
    if (payment.order_id) {
      orderSet.add(`${payment.user_id}::${payment.order_id}`)
    } else if (payment.month) {
      monthSet.add(`${payment.user_id}::${payment.month}`)
    }
  })
  return { monthSet, orderSet }
}

function isWorklogPaid(log, paidSets) {
  if (!log || !log.user_id || !paidSets) return false
  const monthKey = getMonthKey(log.date)
  if (monthKey && paidSets.monthSet && paidSets.monthSet.has(`${log.user_id}::${monthKey}`)) return true
  if (log.order_id && paidSets.orderSet && paidSets.orderSet.has(`${log.user_id}::${log.order_id}`)) return true
  return false
}

function buildProcessPriceMap(processes) {
  const map = {}
  ;(processes || []).forEach((process) => {
    if (!process || process._id === undefined || process._id === null) return
    map[String(process._id)] = normalizePrice(process.current_price)
  })
  return map
}

function hasOwn(obj, key) {
  return Object.prototype.hasOwnProperty.call(obj || {}, key)
}

function applyCurrentPricesToUnpaidLogs(input) {
  const logs = Array.isArray(input && input.logs) ? input.logs : []
  const priceMap = input && input.processPriceMap
    ? input.processPriceMap
    : buildProcessPriceMap(input && input.processes)
  const paidSets = input && input.paidSets ? input.paidSets : buildPaidSets(input && input.payments)

  return logs.map((log) => {
    const processKey = String(log && log.process_id)
    const mappedCurrentPrice = hasOwn(priceMap, processKey) ? normalizePrice(priceMap[processKey]) : normalizePrice(log && log.current_price)
    const originalSnapshotPrice = normalizePrice(log && log.snapshot_price)
    const isLocked = isWorklogPaid(log, paidSets)
    const shouldUseCurrentPrice = !isLocked && mappedCurrentPrice !== null
    const settlementPrice = shouldUseCurrentPrice ? mappedCurrentPrice : (originalSnapshotPrice === null ? 0 : originalSnapshotPrice)
    const quantity = Number(log && log.quantity) || 0
    const amount = round2(quantity * settlementPrice)
    const priceChanged = mappedCurrentPrice !== null && originalSnapshotPrice !== null && mappedCurrentPrice !== originalSnapshotPrice

    return {
      ...log,
      current_price: mappedCurrentPrice,
      snapshot_price: settlementPrice,
      amount,
      price_changed: shouldUseCurrentPrice ? false : priceChanged,
      price_synced_from_current: shouldUseCurrentPrice && priceChanged,
      is_price_locked: isLocked
    }
  })
}

function buildProcessNameMap(processes) {
  const map = {}
  ;(processes || []).forEach((process) => {
    if (!process || process._id === undefined || process._id === null) return
    map[String(process._id)] = process.process_name || ''
  })
  return map
}

// 挑出「WorkLogs 里存的结算价/金额/工序名 ≠ 工序当前值」的报工，返回最小写回集合（纯函数）。
// 用途一（发薪固化）：markPaid 前把未发薪报工的结算价写死到 DB，避免锁定后读时口径翻回旧 snapshot 造成金额跳变。
// 用途二（改价/改名同步）：老板改工序后把未发薪报工一并重写（CLAUDE.md §2.2）。
// 用途三（存量对账修复）：lockedPolicy='all' 才会碰已发薪报工，调用方必须先与 SalaryPayments.total_amount 对账。
// lockedPolicy: 'skip' 已发薪一律不动（默认，§2.2 红线）｜'name-only' 已发薪只同步工序名（不动钱）｜'all' 已发薪也重写价。
// 工价为空/<=0 视为「未设置工价」，一律不改价（与报工时禁止零价报工同口径）。
function selectWorklogSyncUpdates(input) {
  const logs = Array.isArray(input && input.logs) ? input.logs : []
  const priceMap = input && input.processPriceMap
    ? input.processPriceMap
    : buildProcessPriceMap(input && input.processes)
  const nameMap = input && input.processNameMap
    ? input.processNameMap
    : buildProcessNameMap(input && input.processes)
  const paidSets = input && input.paidSets ? input.paidSets : buildPaidSets(input && input.payments)
  const lockedPolicy = (input && input.lockedPolicy) || 'skip'
  const syncName = !(input && input.syncName === false)

  const updates = []
  logs.forEach((log) => {
    if (!log || !log._id) return
    const key = String(log.process_id)
    const locked = isWorklogPaid(log, paidSets)
    if (locked && lockedPolicy === 'skip') return

    const data = {}
    const currentPrice = hasOwn(priceMap, key) ? normalizePrice(priceMap[key]) : null
    const canWritePrice = !locked || lockedPolicy === 'all'
    if (canWritePrice && currentPrice !== null && currentPrice > 0) {
      const quantity = Number(log.quantity) || 0
      const amount = round2(quantity * currentPrice)
      if (normalizePrice(log.snapshot_price) !== currentPrice) data.snapshot_price = currentPrice
      if (normalizePrice(log.amount) !== amount) data.amount = amount
    }
    const currentName = hasOwn(nameMap, key) ? nameMap[key] : ''
    if (syncName && currentName && currentName !== (log.process_name || '')) {
      data.process_name = currentName
    }

    if (Object.keys(data).length > 0) {
      updates.push({ _id: log._id, locked, data })
    }
  })
  return updates
}

module.exports = {
  round2,
  normalizePrice,
  getMonthKey,
  buildPaidSets,
  isWorklogPaid,
  buildProcessPriceMap,
  buildProcessNameMap,
  applyCurrentPricesToUnpaidLogs,
  selectWorklogSyncUpdates
}
