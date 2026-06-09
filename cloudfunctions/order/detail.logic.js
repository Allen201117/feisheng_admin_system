function normalizeAssignedUserIds(value) {
  if (!Array.isArray(value)) return []

  return value.filter((item) => typeof item === 'string' && item)
}

function collectAssignedUserIds(processes = []) {
  const idSet = new Set()

  ;(processes || []).forEach((process) => {
    normalizeAssignedUserIds(process && process.assigned_user_ids).forEach((id) => {
      idSet.add(id)
    })
  })

  return Array.from(idSet)
}

function buildUserNameMap(users = []) {
  return (users || []).reduce((map, user) => {
    if (user && user._id) {
      map[user._id] = user.name || ''
    }
    return map
  }, {})
}

function attachAssignedNamesToProcesses(processes = [], userNameMap = {}) {
  return (processes || []).map((process) => {
    const normalizedIds = normalizeAssignedUserIds(process && process.assigned_user_ids)
    const names = normalizedIds
      .map((id) => userNameMap[id])
      .filter((name) => !!name)

    return {
      ...process,
      assigned_user_ids: normalizedIds,
      assigned_names: names.length > 0 ? names.join('、') : '未分配'
    }
  })
}

function findInvalidAssignedUserIdProcesses(processes = []) {
  return (processes || [])
    .filter((process) => process && process.assigned_user_ids !== undefined && !Array.isArray(process.assigned_user_ids))
    .map((process) => ({
      _id: process._id,
      process_name: process.process_name,
      assigned_user_ids_type: Object.prototype.toString.call(process.assigned_user_ids)
    }))
}

function toTimestamp(input) {
  if (!input) return 0
  if (input instanceof Date) return input.getTime()
  if (typeof input === 'number') return input
  if (typeof input === 'string') {
    const t = new Date(input).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (input.$date) {
    const t = new Date(input.$date).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (input.seconds) {
    return Number(input.seconds) * 1000 + Math.floor((Number(input.nanoseconds) || 0) / 1000000)
  }
  return 0
}

function getProcessSortIndex(process) {
  if (!process || process.process_sort_index === undefined || process.process_sort_index === null) return null
  const parsed = Number(process.process_sort_index)
  return Number.isFinite(parsed) ? parsed : null
}

function sortProcessesForDetail(processes = []) {
  return (processes || []).slice().sort((a, b) => {
    const aIndex = getProcessSortIndex(a)
    const bIndex = getProcessSortIndex(b)
    if (aIndex !== null || bIndex !== null) {
      const indexDiff = (aIndex === null ? Number.MAX_SAFE_INTEGER : aIndex) -
        (bIndex === null ? Number.MAX_SAFE_INTEGER : bIndex)
      if (indexDiff !== 0) return indexDiff
    }

    const timeDiff = toTimestamp(a && (a.created_at || a.updated_at)) -
      toTimestamp(b && (b.created_at || b.updated_at))
    if (timeDiff !== 0) return timeDiff
    return String((a && a._id) || '').localeCompare(String((b && b._id) || ''))
  })
}

module.exports = {
  normalizeAssignedUserIds,
  collectAssignedUserIds,
  buildUserNameMap,
  attachAssignedNamesToProcesses,
  findInvalidAssignedUserIdProcesses,
  sortProcessesForDetail
}
