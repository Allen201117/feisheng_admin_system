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

module.exports = {
  buildSalaryPaymentDocId,
  buildSalaryPaymentCreateData,
  isOrderFullyPaid
}
