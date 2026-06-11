// 发薪锁 + 订单完成锁判定（纯函数，无 wx/db 副作用）
// 业务口径见 CLAUDE.md §2.2/2.3/2.4：
//   - 工资按 quantity*snapshot_price 结算；已发薪报工不可被改价/删除/清空。
//   - 已发薪检测兼容「按月发薪」(SalaryPayments.month) 与「按订单发薪」(SalaryPayments.order_id) 两种模式。
//   - completed 订单禁止删改任何相关数据。

function getMonthKey(dateStr) {
  if (!dateStr || typeof dateStr !== 'string' || dateStr.length < 7) return ''
  return dateStr.slice(0, 7)
}

// 从 SalaryPayments(paid:true) 构造按月 + 按订单两套已发薪集合
// 关键：按订单发薪记录也带发薪当月 month（见 salary 的 buildSalaryPaymentCreateData），
// 但其锁定范围只是该订单，不是整月。若把它的 month 也收进 monthSet，会导致同一员工同月
// 在「发薪后新建/复制的未发薪订单」上的报工被按月误锁（薪资管理显示未发薪、改价却被拦截）。
// 因此：有 order_id 的记录只进 orderSet；只有纯按月发薪记录（无 order_id）才进 monthSet。
function buildPaidSets(payments) {
  const monthSet = new Set() // `${user_id}::${month}`
  const orderSet = new Set() // `${user_id}::${order_id}`
  ;(payments || []).forEach((p) => {
    if (!p || p.paid !== true || !p.user_id) return
    if (p.order_id) {
      orderSet.add(`${p.user_id}::${p.order_id}`)
    } else if (p.month) {
      monthSet.add(`${p.user_id}::${p.month}`)
    }
  })
  return { monthSet, orderSet }
}

// 单条报工是否已发薪（按月或按订单任一命中即锁定）
function isWorklogPaid(log, sets) {
  if (!log || !log.user_id || !sets) return false
  const monthKey = getMonthKey(log.date)
  if (monthKey && sets.monthSet && sets.monthSet.has(`${log.user_id}::${monthKey}`)) return true
  if (log.order_id && sets.orderSet && sets.orderSet.has(`${log.user_id}::${log.order_id}`)) return true
  return false
}

// 返回命中已发薪的报工冲突（按 user + 月/订单 去重），供拒绝改价/删除时预览
function findPaidWorklogs(worklogs, sets) {
  const seen = new Set()
  const conflicts = []
  ;(worklogs || []).forEach((log) => {
    if (!isWorklogPaid(log, sets)) return
    const monthKey = getMonthKey(log.date)
    const key = `${log.user_id}::${monthKey || log.order_id || ''}`
    if (seen.has(key)) return
    seen.add(key)
    conflicts.push({
      worklog_id: log._id || '',
      user_id: log.user_id,
      user_name: log.user_name || '',
      month: monthKey,
      order_id: log.order_id || ''
    })
  })
  return conflicts
}

function isOrderCompleted(order) {
  return !!(order && order.status === 'completed')
}

// 已发薪冲突预览文案（最多列 3 条）
function buildPaidConflictPreview(conflicts) {
  const list = conflicts || []
  const preview = list.slice(0, 3)
    .map(item => `${item.user_name || item.user_id}${item.month ? ' ' + item.month : ''}`)
    .join('、')
  const suffix = list.length > 3 ? ` 等 ${list.length} 个已发薪记录` : ''
  return `${preview}${suffix}`
}

module.exports = {
  getMonthKey,
  buildPaidSets,
  isWorklogPaid,
  findPaidWorklogs,
  isOrderCompleted,
  buildPaidConflictPreview
}
