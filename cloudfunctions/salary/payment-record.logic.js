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

module.exports = {
  buildSalaryPaymentDocId,
  buildSalaryPaymentCreateData
}
