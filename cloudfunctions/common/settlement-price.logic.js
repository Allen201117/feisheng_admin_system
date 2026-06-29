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

module.exports = {
  round2,
  normalizePrice,
  getMonthKey,
  buildPaidSets,
  isWorklogPaid,
  buildProcessPriceMap,
  applyCurrentPricesToUnpaidLogs
}
