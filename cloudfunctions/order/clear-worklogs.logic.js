function getWorklogMonthKey(worklog) {
  const date = worklog && worklog.date
  if (!date || typeof date !== 'string' || date.length < 7) return ''
  return date.slice(0, 7)
}

function collectClearableWorklogIds(worklogs) {
  return (worklogs || [])
    .map(worklog => worklog && worklog._id)
    .filter(Boolean)
}

function findPaidWorklogConflicts({ worklogs, paidMonthSet }) {
  const seen = new Set()
  const conflicts = []

  ;(worklogs || []).forEach((worklog) => {
    const month = getWorklogMonthKey(worklog)
    const userId = worklog && worklog.user_id
    if (!month || !userId) return
    if (!paidMonthSet.has(`${userId}::${month}`)) return

    const key = `${userId}::${month}`
    if (seen.has(key)) return
    seen.add(key)
    conflicts.push({
      worklog_id: worklog._id || '',
      user_id: userId,
      user_name: worklog.user_name || '',
      month
    })
  })

  return conflicts
}

function buildClearOrderWorklogsDetails({ orderName, removedCount }) {
  return `清空订单“${orderName || '未命名订单'}”关联报工 ${removedCount} 条`
}

module.exports = {
  getWorklogMonthKey,
  collectClearableWorklogIds,
  findPaidWorklogConflicts,
  buildClearOrderWorklogsDetails
}
