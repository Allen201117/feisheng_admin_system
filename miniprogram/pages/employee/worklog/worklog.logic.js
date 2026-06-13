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

// 报工页第二层：按订单筛出「我负责的工序」卡片，支持关键词搜索（工序名/订单名）
function buildOrderProcessCards(processes, orderId, keyword) {
  const source = Array.isArray(processes) ? processes : []
  const oid = String(orderId || '')
  const kw = String(keyword || '').trim().toLowerCase()
  const inOrder = source.filter((p) => !oid || String(p.order_id || '') === oid)
  const items = inOrder
    .filter((p) => {
      if (!kw) return true
      const name = String(p.process_name || '').toLowerCase()
      const order = String(p.order_name || '').toLowerCase()
      return name.indexOf(kw) >= 0 || order.indexOf(kw) >= 0
    })
    .map((p) => {
      const total = Number(p.order_total_quantity) || 0
      const current = Number(p.current_total) || 0
      const myReported = Number(p.user_current_total) || 0
      const remainingRaw = p.remaining_quantity !== undefined ? Number(p.remaining_quantity) : (total - current)
      const remaining = Math.max(0, Number.isFinite(remainingRaw) ? remainingRaw : 0)
      const progressPercent = total > 0 ? Math.max(0, Math.min(100, Math.round((current / total) * 100))) : 0
      const isComplete = total > 0 && remaining <= 0
      const priceHidden = p.price_hidden === true
      return {
        ...p,
        remaining,
        progressPercent,
        isComplete,
        priceText: priceHidden ? '工价已隐藏' : `¥${Number(p.current_price) || 0}/件`,
        remainingText: total > 0 ? `剩余可报 ${remaining} 件` : '未设置总量',
        myReportedText: `我已报 ${myReported} 件`,
        statusText: isComplete ? '已报满' : '可报工'
      }
    })
  return { items, matchedCount: items.length, totalCount: inOrder.length }
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
  buildOrderProcessCards,
  filterEmployeeVisibleWorkLogs,
  buildWorklogHistoryView
}
