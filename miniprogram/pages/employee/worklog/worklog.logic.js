function normalizePrice(value) {
  if (value === null || value === undefined || value === '') return 0
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : 0
}

function normalizeAssignedProcessForEmployee(process) {
  const normalizedPrice = normalizePrice(process && process.current_price)
  const priceHidden = process && process.price_hidden === true

  return {
    ...process,
    current_price: normalizedPrice,
    display: priceHidden
      ? `${process.order_name} - ${process.process_name} (工价已隐藏)`
      : `${process.order_name} - ${process.process_name} (¥${normalizedPrice}/件)`
  }
}

module.exports = {
  normalizePrice,
  normalizeAssignedProcessForEmployee
}
