function getMonthKeyFromDate(dateStr) {
  if (!dateStr || typeof dateStr !== 'string' || dateStr.length < 7) return ''
  return dateStr.slice(0, 7)
}

function buildPaidMonthSet(payments = []) {
  const paidSet = new Set()
  payments.forEach((payment) => {
    if (!payment || payment.paid !== true || !payment.user_id || !payment.month) return
    paidSet.add(`${payment.user_id}::${payment.month}`)
  })
  return paidSet
}

function selectRepriceableWorklogs(worklogs = [], paidMonthSet) {
  return worklogs.filter((log) => {
    if (!log) return false

    const monthKey = getMonthKeyFromDate(log.date)
    if (!monthKey || !log.user_id) return true

    return !paidMonthSet.has(`${log.user_id}::${monthKey}`)
  })
}

module.exports = {
  getMonthKeyFromDate,
  buildPaidMonthSet,
  selectRepriceableWorklogs
}
