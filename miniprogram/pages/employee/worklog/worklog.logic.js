function normalizePrice(value) {
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeAssignedProcessForEmployee(process) {
  const normalizedPrice = normalizePrice(process && process.current_price)
  const priceHidden = process && process.price_hidden === true

  return {
    ...process,
    current_price: normalizedPrice,
    display: priceHidden
      ? `${process.order_name} - ${process.process_name} (工价已隐藏)`
      : `${process.order_name} - ${process.process_name} (¥${normalizedPrice}/件)`
  }
}

function filterEmployeeVisibleWorkLogs(logs, orderMap) {
  const source = Array.isArray(logs) ? logs : []
  const orders = orderMap || {}
  return source.filter((log) => {
    const order = orders[log.order_id] || {}
    return order.status !== 'completed'
  })
}

function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100
}

function formatMoneyText(value) {
  return `¥${roundMoney(value).toFixed(2)}`
}

function getLogAmount(log) {
  if (log && log.amount !== undefined && log.amount !== null) return Number(log.amount) || 0
  return (Number(log && log.quantity) || 0) * (Number(log && log.snapshot_price) || 0)
}

function buildWorklogHistoryView(logs) {
  const source = Array.isArray(logs) ? logs : []
  const groupMap = {}
  let totalQuantity = 0
  let totalAmount = 0
  let hasHiddenAmount = false

  source.forEach((log) => {
    const orderId = log.order_id || ''
    const processId = log.process_id || log.process_name || ''
    const key = `${orderId}_${processId}`
    const quantity = Number(log.quantity) || 0
    const hidden = log.price_hidden === true
    const amount = hidden ? 0 : getLogAmount(log)
    totalQuantity += quantity
    if (hidden) hasHiddenAmount = true
    else totalAmount += amount

    if (!groupMap[key]) {
      groupMap[key] = {
        key,
        order_id: orderId,
        order_name: log.order_name || '',
        process_id: processId,
        process_name: log.process_name || '',
        totalQuantity: 0,
        totalAmount: 0,
        hasHiddenAmount: false,
        count: 0,
        latestDate: ''
      }
    }

    const group = groupMap[key]
    group.totalQuantity += quantity
    if (hidden) group.hasHiddenAmount = true
    else group.totalAmount += amount
    group.count += 1
    if (log.date && String(log.date) > String(group.latestDate || '')) {
      group.latestDate = log.date
    }
  })

  const overviewCards = Object.values(groupMap)
    .map((group) => ({
      ...group,
      quantityText: `累计 ${group.totalQuantity} 件`,
      amountText: group.hasHiddenAmount ? '金额已隐藏' : formatMoneyText(group.totalAmount),
      detailText: `${group.count} 条明细`,
      lastText: group.latestDate ? `最近 ${group.latestDate}` : '最近 --'
    }))
    .sort((a, b) => String(b.latestDate || '').localeCompare(String(a.latestDate || '')) || String(a.process_name || '').localeCompare(String(b.process_name || '')))

  return {
    overviewCards,
    totalQuantity,
    totalCount: source.length,
    totalAmount: roundMoney(totalAmount),
    hasHiddenAmount
  }
}

module.exports = {
  normalizePrice,
  normalizeAssignedProcessForEmployee,
  filterEmployeeVisibleWorkLogs,
  buildWorklogHistoryView
}
