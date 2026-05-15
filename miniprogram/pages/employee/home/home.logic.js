const { normalizeAssignedProcessForEmployee } = require('../worklog/worklog.logic')

function toNumber(value, fallback = 0) {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : fallback
}

function clampPercent(value) {
  if (!Number.isFinite(value)) return 0
  return Math.max(0, Math.min(100, Math.round(value)))
}

function buildProcessCard(process, selectedProcessId) {
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
    isSelected: String(normalized._id || '') === String(selectedProcessId || ''),
    priceText: normalized.price_hidden ? '工价已隐藏' : `¥${normalized.current_price}/件`,
    quotaText: total > 0 ? `剩余 ${remaining} 件` : '未设置总量',
    statusText: isComplete ? '已报满' : '可报工'
  }
}

function buildHomeProcessView(processes, selectedProcessId, limit = 5) {
  const safeLimit = Math.max(1, toNumber(limit, 5))
  const source = Array.isArray(processes) ? processes : []
  const items = source.slice(0, safeLimit).map((process) => buildProcessCard(process, selectedProcessId))

  return {
    items,
    totalCount: source.length,
    visibleCount: items.length,
    hasMore: source.length > items.length
  }
}

function findProcessById(processes, processId) {
  const source = Array.isArray(processes) ? processes : []
  const found = source.find((process) => String(process && process._id) === String(processId))
  return found || null
}

function buildQuotaFromProcess(process) {
  if (!process) return null
  return {
    order_total_quantity: toNumber(process.order_total_quantity),
    current_total: toNumber(process.current_total),
    remaining_quantity: toNumber(process.remaining_quantity)
  }
}

function buildQuantityState(rawQuantity, quotaInfo, selectedProcess) {
  const quantity = Math.max(0, parseInt(rawQuantity, 10) || 0)
  let quantityError = ''

  if (!selectedProcess) {
    quantityError = '请先选择工序'
  } else if (quantity <= 0) {
    quantityError = ''
  } else if (quotaInfo && quantity > toNumber(quotaInfo.remaining_quantity)) {
    quantityError = '超过剩余可报数量'
  }

  return {
    quantity,
    quantityError,
    canSubmit: !!selectedProcess && quantity > 0 && !quantityError
  }
}

module.exports = {
  buildHomeProcessView,
  buildQuantityState,
  buildQuotaFromProcess,
  findProcessById
}
