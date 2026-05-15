const { normalizeAssignedProcessForEmployee } = require('../worklog/worklog.logic')

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function buildProcessCard(process) {
  const normalized = normalizeAssignedProcessForEmployee(process || {})
  const total = toNumber(normalized.order_total_quantity)
  const current = toNumber(normalized.current_total)
  const remaining = toNumber(normalized.remaining_quantity, Math.max(total - current, 0))
  const progressPercent = total > 0 ? clampPercent((current / total) * 100) : 0
  const isComplete = remaining <= 0 && total > 0

  return {
    ...normalized,
    order_total_quantity: total,
    current_total: current,
    remaining_quantity: remaining,
    progressPercent,
    isComplete,
    actionText: '进入报工',
    priceText: normalized.price_hidden ? '工价已隐藏' : `¥${normalized.current_price}/件`,
    quotaText: total > 0 ? `剩余 ${remaining} 件` : '未设置总量',
    statusText: isComplete ? '已报满' : '可报工'
  }
}

function buildHomeProcessView(processes, limit = 5) {
  const safeLimit = Math.max(1, toNumber(limit, 5))
  const source = Array.isArray(processes) ? processes : []
  const items = source.slice(0, safeLimit).map((process) => buildProcessCard(process))

  return {
    items,
    totalCount: source.length,
    visibleCount: items.length,
    hasMore: source.length > items.length
  }
}

module.exports = {
  buildHomeProcessView
}
