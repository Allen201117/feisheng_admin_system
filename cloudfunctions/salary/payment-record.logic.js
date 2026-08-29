function buildSalaryPaymentDocId({ orgId, userId, month, orderId }) {
  if (orderId) return `${orgId}_${userId}_order_${orderId}`
  return `${orgId}_${userId}_${month}`
}

function buildSalaryPaymentCreateData({ orgId, userId, userName, month, orderId, orderName, totalAmount, caller, serverDate }) {
  const data = {
    org_id: orgId,
    user_id: userId,
    user_name: userName || '',
    month,
    paid: true,
    paid_at: serverDate(),
    operator_id: caller._id,
    operator_name: caller.name,
    created_at: serverDate()
  }
  if (orderId) {
    data.order_id = orderId
    data.order_name = orderName || ''
    data.payroll_type = 'order'
  }
  if (totalAmount !== undefined) {
    data.total_amount = Math.round((Number(totalAmount) || 0) * 100) / 100
  }
  return data
}

// 订单是否已全员发薪（CLAUDE.md §2.3 发薪即完成）：
// participantUserIds = 该订单所有报工过的员工；paidUserIds = 该订单已标记发薪的员工。
function isOrderFullyPaid({ participantUserIds, paidUserIds }) {
  const participants = (participantUserIds || []).filter(Boolean)
  if (participants.length === 0) return false
  const paidSet = new Set((paidUserIds || []).map(String))
  return participants.every(id => paidSet.has(String(id)))
}

// 奖惩记录「是否已发薪锁定」的查询条件（CLAUDE.md §2.3）。
// 必须和 getUserMonthlySalaryByBoss 里 is_paid 的口径完全一致：
//  - 订单奖惩（带 order_id）：只看该订单那一笔发薪记录；
//  - 月度奖惩：只看「纯按月」发薪记录 —— markPaid 给按订单发薪的 SalaryPayments
//    也写了 month 字段，不用 order_id 不存在把它排掉，就会把「这个月其实没按月发薪」
//    误判成已锁定，删除奖惩被改走冲正，老板看到「已删除」但记录还在明细里。
// command 传云数据库的 db.command（只用到 exists），便于纯函数单测。
function buildAdjustmentPayLockWhere({ orgId, adjustment, command }) {
  const adj = adjustment || {}
  const where = {
    org_id: orgId,
    user_id: adj.user_id,
    paid: true
  }
  if (adj.order_id) {
    where.order_id = adj.order_id
  } else {
    where.month = adj.month
    where.order_id = command.exists(false)
  }
  return where
}

// 冲正/更正记录必须继承原记录的订单归属，否则订单模式的工资详情
// （calcUserOrderSalary 按 order_id 查奖惩）根本查不到这条冲正，
// 表现为「删了但原记录还在、金额一分没少」。
function inheritAdjustmentScope(adjustment) {
  const adj = adjustment || {}
  if (!adj.order_id) return {}
  return { order_id: adj.order_id, order_name: adj.order_name || '' }
}

module.exports = {
  buildSalaryPaymentDocId,
  buildAdjustmentPayLockWhere,
  inheritAdjustmentScope,
  buildSalaryPaymentCreateData,
  isOrderFullyPaid
}
