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
  const myReported = toNumber(normalized.user_current_total)
  const assignedUserCount = Math.max(0, toNumber(normalized.assigned_user_count))
  const isMultiAssigned = assignedUserCount > 1
  const progressPercent = total > 0 ? clampPercent((current / total) * 100) : 0
  const isComplete = remaining <= 0 && total > 0

  return {
    ...normalized,
    order_total_quantity: total,
    current_total: current,
    remaining_quantity: remaining,
    user_current_total: myReported,
    assigned_user_count: assignedUserCount,
    isMultiAssigned,
    progressPercent,
    isComplete,
    actionText: '进入报工',
    priceText: normalized.price_hidden ? '工价已隐藏' : `¥${normalized.current_price}/件`,
    multiAssignedText: isMultiAssigned ? `多人负责 ${assignedUserCount}人` : '',
    quotaText: total > 0 ? `剩余 ${remaining} 件` : '未设置总量',
    myReportedText: `我的已报 ${myReported} 件`,
    progressText: total > 0 ? `总进度 ${current}/${total} 件` : `总进度 ${current} 件`,
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

// 按订单分组：首页先展示订单卡片，点进订单再看该订单下「我负责的工序」
function buildHomeOrderView(processes, limit = 5) {
  const source = Array.isArray(processes) ? processes : []
  const cards = source.map((process) => buildProcessCard(process))
  const orderMap = {}
  const orderIds = []
  cards.forEach((card) => {
    const oid = String(card.order_id || '')
    if (!orderMap[oid]) {
      orderMap[oid] = []
      orderIds.push(oid)
    }
    orderMap[oid].push(card)
  })

  const orders = orderIds.map((oid) => {
    const procs = orderMap[oid]
    const processCount = procs.length
    const incompleteCount = procs.filter((p) => !p.isComplete).length
    const myReportedTotal = procs.reduce((sum, p) => sum + toNumber(p.user_current_total), 0)
    const isAllComplete = incompleteCount === 0
    return {
      order_id: oid,
      order_name: procs[0].order_name || '未命名订单',
      processCount,
      incompleteCount,
      isAllComplete,
      processCountText: `负责 ${processCount} 道工序`,
      statusText: isAllComplete ? '已全部报满' : `${incompleteCount} 道待报工`,
      myReportedText: `累计已报 ${myReportedTotal} 件`
    }
  })

  const safeLimit = Math.max(1, toNumber(limit, 5))
  const items = orders.slice(0, safeLimit)
  return {
    items,
    totalCount: orders.length,
    visibleCount: items.length,
    hasMore: orders.length > items.length
  }
}

function buildHomeRankCard(rankData = {}) {
  const rank = toNumber(rankData.rank)
  const total = toNumber(rankData.total_employees)
  const visibility = rankData.visibility || 'self'
  const valueText = rankData.displayValue || (
    rankData.total_salary !== undefined
      ? `¥${Number(rankData.total_salary || 0).toFixed(2)}`
      : String(rankData.rank_value || 0)
  )

  return {
    rankText: rank > 0 ? `第 ${rank} 名` : '暂无排名',
    valueText,
    totalText: total > 0 ? `共 ${total} 人` : '暂无参评',
    scopeText: visibility === 'public' || visibility === 'boss' ? '全员榜公开' : '仅自己可见'
  }
}

function pickHomeRankItem(rankList, userId) {
  const source = Array.isArray(rankList) ? rankList : []
  const targetId = String(userId || '')
  return source.find((item) => String(item && item.user_id) === targetId) || source[0] || {}
}

module.exports = {
  buildHomeProcessView,
  buildHomeOrderView,
  buildHomeRankCard,
  pickHomeRankItem
}
