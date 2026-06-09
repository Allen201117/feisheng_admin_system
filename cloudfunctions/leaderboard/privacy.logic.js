function filterRankListForViewer(rankList, options = {}) {
  const source = Array.isArray(rankList) ? rankList : []
  const caller = options.caller || {}
  const isPublic = options.leaderboardVisible === true

  if (caller.role === 'boss') {
    return {
      list: source,
      total_employees: source.length,
      visibility: 'boss'
    }
  }

  if (isPublic) {
    return {
      list: source,
      total_employees: source.length,
      visibility: 'public'
    }
  }

  const ownId = String(caller._id || '')
  return {
    list: source.filter((item) => String(item && item.user_id) === ownId),
    total_employees: source.length,
    visibility: 'self'
  }
}

module.exports = {
  filterRankListForViewer
}
