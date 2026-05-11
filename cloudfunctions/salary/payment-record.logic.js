function buildSalaryPaymentDocId({ orgId, userId, month }) {
  return `${orgId}_${userId}_${month}`
}

function buildSalaryPaymentCreateData({ orgId, userId, userName, month, caller, serverDate }) {
  return {
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
}

module.exports = {
  buildSalaryPaymentDocId,
  buildSalaryPaymentCreateData
}
