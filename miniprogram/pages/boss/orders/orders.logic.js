function toNonNegativeInt(value) {
  const parsed = parseInt(value, 10)
  return Number.isNaN(parsed) || parsed < 0 ? 0 : parsed
}

function summarizeDeleteOrderTargets(counts = {}) {
  const summary = {
    processCount: toNonNegativeInt(counts.processCount),
    worklogCount: toNonNegativeInt(counts.worklogCount),
    adjustmentCount: toNonNegativeInt(counts.adjustmentCount),
    auditLogCount: toNonNegativeInt(counts.auditLogCount)
  }

  return {
    ...summary,
    totalCount: summary.processCount + summary.worklogCount + summary.adjustmentCount + summary.auditLogCount
  }
}

function buildDeleteOrderConfirmContent(orderName, counts = {}) {
  const summary = summarizeDeleteOrderTargets(counts)

  return [
    `删除订单“${orderName || '未命名订单'}”后，将一并删除：`,
    `- 订单工序 ${summary.processCount} 条`,
    `- 报工记录 ${summary.worklogCount} 条`,
    `- 订单奖惩 ${summary.adjustmentCount} 条`,
    `- 审计日志 ${summary.auditLogCount} 条`,
    '',
    '该操作不可恢复，请谨慎确认。'
  ].join('\n')
}

module.exports = {
  summarizeDeleteOrderTargets,
  buildDeleteOrderConfirmContent
}
