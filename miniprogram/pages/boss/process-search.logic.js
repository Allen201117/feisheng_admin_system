function normalizeProcessKeyword(value) {
  return String(value || '').trim().toLowerCase()
}

function filterProcessesByKeyword(processes, keyword) {
  const list = Array.isArray(processes) ? processes : []
  const normalizedKeyword = normalizeProcessKeyword(keyword)
  if (!normalizedKeyword) return list

  return list.filter((process) => {
    const name = String((process && process.process_name) || '').toLowerCase()
    return name.includes(normalizedKeyword)
  })
}

function hasAssignedUsers(process) {
  return Array.isArray(process && process.assigned_user_ids) && process.assigned_user_ids.length > 0
}

function filterProcessesByAssignment(processes, processFilter) {
  const list = Array.isArray(processes) ? processes : []
  if (processFilter === 'unassigned') {
    return list.filter((process) => !hasAssignedUsers(process))
  }
  if (processFilter === 'assigned') {
    return list.filter(hasAssignedUsers)
  }
  return list
}

function buildProcessListView(options = {}) {
  const pageSize = Math.max(1, Number(options.pageSize) || 30)
  const processPage = Math.max(1, Number(options.page) || 1)
  const statusFiltered = filterProcessesByAssignment(options.processes, options.processFilter)
  const filteredProcesses = filterProcessesByKeyword(statusFiltered, options.keyword)
  const displayedProcesses = filteredProcesses.slice(0, processPage * pageSize)

  return {
    filteredProcesses,
    displayedProcesses,
    processPage,
    hasMoreProcesses: filteredProcesses.length > displayedProcesses.length
  }
}

module.exports = {
  normalizeProcessKeyword,
  filterProcessesByKeyword,
  buildProcessListView
}
