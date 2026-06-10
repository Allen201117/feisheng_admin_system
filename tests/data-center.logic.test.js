const test = require('node:test')
const assert = require('node:assert/strict')

const {
  getInitialPeriodState,
  isPeriodMode,
  getReportRequestParams,
  getPeriodDisplayLabel,
  getPeriodPathHint,
  getEmptyTableState
} = require('../miniprogram/pages/boss/data-center/data-center.logic')

test('getInitialPeriodState derives current Beijing month/year and default report type', () => {
  const state = getInitialPeriodState()

  // Should return a valid month YYYY-MM and year YYYY from Beijing time
  assert.ok(/^\d{4}-\d{2}$/.test(state.month), `month should match YYYY-MM, got: ${state.month}`)
  assert.ok(/^\d{4}$/.test(state.year), `year should match YYYY, got: ${state.year}`)
  assert.equal(state.reportType, 'summary')
  assert.equal(state.month.slice(0, 4), state.year)
})

test('isPeriodMode only matches month and year', () => {
  assert.equal(isPeriodMode('month'), true)
  assert.equal(isPeriodMode('year'), true)
  assert.equal(isPeriodMode('order'), false)
})

test('getReportRequestParams maps month and year modes to export table parameters', () => {
  assert.deepEqual(
    getReportRequestParams('month', {
      month: '2025-11',
      year: '2025',
      reportType: 'summary'
    }),
    {
      dimension: 'month',
      month: '2025-11',
      report_type: 'summary'
    }
  )

  assert.deepEqual(
    getReportRequestParams('year', {
      month: '2025-11',
      year: '2025',
      reportType: 'detail'
    }),
    {
      dimension: 'year',
      year: '2025',
      report_type: 'detail'
    }
  )
})

test('getPeriodDisplayLabel renders month and natural year text', () => {
  assert.equal(
    getPeriodDisplayLabel('month', { month: '2025-11', year: '2025' }),
    '2025-11'
  )
  assert.equal(
    getPeriodDisplayLabel('year', { month: '2025-11', year: '2025' }),
    '2025\u5e74'
  )
})

test('getPeriodPathHint renders export-like path hint for month/year report preview', () => {
  assert.equal(
    getPeriodPathHint('month', 'summary', { month: '2025-11', year: '2025' }),
    '\u6309\u6708 -> \u6c47\u603b\u8868\uff082025-11\uff09'
  )
  assert.equal(
    getPeriodPathHint('year', 'detail', { month: '2025-11', year: '2025' }),
    '\u6309\u5e74 -> \u660e\u7ec6\u8868\uff082025\u5e74\uff09'
  )
})

test('getEmptyTableState clears table preview state', () => {
  assert.deepEqual(getEmptyTableState(), {
    tableTitle: '',
    tableHeaders: [],
    tableRows: [],
    tableColMeta: [],
    tableLoaded: false
  })
})
