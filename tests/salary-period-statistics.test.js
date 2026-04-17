const test = require('node:test')
const assert = require('node:assert/strict')

const {
  resolvePeriodRange,
  buildSalaryPeriodSummary,
  buildPaidStatusMap
} = require('../cloudfunctions/salary/period-statistics')

test('resolvePeriodRange returns natural year boundaries and month keys', () => {
  const result = resolvePeriodRange({ year: '2025' })

  assert.deepEqual(result, {
    startDate: '2025-01-01',
    endDate: '2026-01-01',
    periodKey: '2025',
    monthKeys: [
      '2025-01',
      '2025-02',
      '2025-03',
      '2025-04',
      '2025-05',
      '2025-06',
      '2025-07',
      '2025-08',
      '2025-09',
      '2025-10',
      '2025-11',
      '2025-12'
    ]
  })
})

test('buildSalaryPeriodSummary aggregates yearly salary and paid status by active months', () => {
  const users = [
    { _id: 'u1', name: 'Alice', role: 'employee' },
    { _id: 'u2', name: 'Bob', role: 'qc' }
  ]
  const logs = [
    { user_id: 'u1', date: '2025-01-05', quantity: 10, snapshot_price: 2 },
    { user_id: 'u1', date: '2025-02-05', quantity: 5, snapshot_price: 3 },
    { user_id: 'u2', date: '2025-02-11', quantity: 4, snapshot_price: 5 }
  ]
  const adjustments = [
    { user_id: 'u1', month: '2025-01', type: 'reward', amount: 30 },
    { user_id: 'u1', month: '2025-02', type: 'penalty', amount: 5 },
    { user_id: 'u2', month: '2025-02', type: 'reward', amount: 10 }
  ]
  const attendances = [
    { user_id: 'u1', date: '2025-01-06', hours: 8, clock_in_time: '2025-01-06T08:00:00.000Z' },
    { user_id: 'u1', date: '2025-02-07', hours: 7.5, clock_in_time: '2025-02-07T08:00:00.000Z' },
    { user_id: 'u2', date: '2025-02-11', hours: 9, clock_in_time: '2025-02-11T08:00:00.000Z' }
  ]
  const payments = [
    { user_id: 'u1', month: '2025-01', paid: true },
    { user_id: 'u1', month: '2025-02', paid: true },
    { user_id: 'u2', month: '2025-02', paid: true }
  ]

  const period = resolvePeriodRange({ year: '2025' })
  const result = buildSalaryPeriodSummary({
    users,
    logs,
    adjustments,
    attendances,
    payments,
    monthKeys: period.monthKeys
  })

  assert.equal(result.employee_count, 2)
  assert.equal(result.total_expenditure, 90)
  assert.deepEqual(result.list, [
    {
      user_id: 'u1',
      user_name: 'Alice',
      role: 'employee',
      piece_rate: 35,
      reward: 30,
      penalty: 5,
      total: 60,
      attend_days: 2,
      total_hours: 15.5,
      paid: true,
      active_months: ['2025-01', '2025-02']
    },
    {
      user_id: 'u2',
      user_name: 'Bob',
      role: 'qc',
      piece_rate: 20,
      reward: 10,
      penalty: 0,
      total: 30,
      attend_days: 1,
      total_hours: 9,
      paid: true,
      active_months: ['2025-02']
    }
  ])
})

test('buildPaidStatusMap only marks yearly paid when all active months are paid', () => {
  const paidMap = buildPaidStatusMap({
    salaryList: [
      { user_id: 'u1', active_months: ['2025-01', '2025-02'] },
      { user_id: 'u2', active_months: ['2025-02'] },
      { user_id: 'u3', active_months: [] }
    ],
    payments: [
      { user_id: 'u1', month: '2025-01', paid: true },
      { user_id: 'u2', month: '2025-02', paid: true },
      { user_id: 'u3', month: '2025-03', paid: true }
    ]
  })

  assert.deepEqual(paidMap, {
    u1: { paid: false },
    u2: { paid: true },
    u3: { paid: false }
  })
})
