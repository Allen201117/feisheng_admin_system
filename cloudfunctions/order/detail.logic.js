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

module.exports = {
  normalizeAssignedUserIds,
  collectAssignedUserIds,
  buildUserNameMap,
  attachAssignedNamesToProcesses,
  findInvalidAssignedUserIdProcesses
}
