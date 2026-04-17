var bjTime = require('../../../utils/beijing-time')

function pad2(value) {
  return String(value).padStart(2, '0')
}

function getInitialPeriodState() {
  var f = bjTime.getBeijingFields()
  return {
    month: f.year + '-' + pad2(f.month),
    year: String(f.year),
    reportType: 'summary'
  }
}

function isPeriodMode(viewMode) {
  return viewMode === 'month' || viewMode === 'year'
}

function getPeriodDisplayLabel(viewMode, data) {
  if (viewMode === 'year') {
    return `${data.year}年`
  }

  return data.month
}

function getReportRequestParams(viewMode, data) {
  if (viewMode === 'year') {
    return {
      dimension: 'year',
      year: data.year,
      report_type: data.reportType || 'summary'
    }
  }

  return {
    dimension: 'month',
    month: data.month,
    report_type: data.reportType || 'summary'
  }
}

function getPeriodPathHint(viewMode, reportType, data) {
  const dimensionLabel = viewMode === 'year' ? '按年' : '按月'
  const reportLabel = reportType === 'detail' ? '明细表' : '汇总表'
  return `${dimensionLabel} -> ${reportLabel}（${getPeriodDisplayLabel(viewMode, data)}）`
}

function getEmptyTableState() {
  return {
    tableTitle: '',
    tableHeaders: [],
    tableRows: [],
    tableLoaded: false
  }
}

module.exports = {
  getInitialPeriodState,
  isPeriodMode,
  getPeriodDisplayLabel,
  getReportRequestParams,
  getPeriodPathHint,
  getEmptyTableState
}
