function parseOrderQuantity(value) {
  const quantity = parseInt(value, 10)
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0
}

function normalizeOrderQuantity(order) {
  if (!order) return 0
  const totalQuantity = parseOrderQuantity(order.total_quantity)
  if (totalQuantity > 0) return totalQuantity
  return parseOrderQuantity(order.order_total_quantity)
}

function shouldCheckProcessQuantityLimit(currentTotalQuantity, nextTotalQuantity) {
  return parseOrderQuantity(currentTotalQuantity) !== parseOrderQuantity(nextTotalQuantity)
}

function buildExceededProcessQuantities({ processes, worklogs, nextTotalQuantity }) {
  const processQuantityMap = {}
  ;(worklogs || []).forEach((worklog) => {
    const processId = worklog && worklog.process_id
    if (!processId) return
    if (!processQuantityMap[processId]) processQuantityMap[processId] = 0
    processQuantityMap[processId] += Number(worklog.quantity) || 0
  })

  return (processes || []).reduce((result, process) => {
    const currentSum = processQuantityMap[process._id] || 0
    if (currentSum > nextTotalQuantity) {
      result.push({
        process_name: process.process_name,
        current_sum: currentSum
      })
    }
    return result
  }, [])
}

module.exports = {
  normalizeOrderQuantity,
  shouldCheckProcessQuantityLimit,
  buildExceededProcessQuantities
}
