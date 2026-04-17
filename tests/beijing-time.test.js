const test = require('node:test')
const assert = require('node:assert/strict')

const bjTime = require('../miniprogram/utils/beijing-time')

test('getBeijingToday returns YYYY-MM-DD format', () => {
  const today = bjTime.getBeijingToday()
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(today), `should be YYYY-MM-DD, got: ${today}`)
})

test('getBeijingMonth returns YYYY-MM format', () => {
  const month = bjTime.getBeijingMonth()
  assert.ok(/^\d{4}-\d{2}$/.test(month), `should be YYYY-MM, got: ${month}`)
})

test('getBeijingFields returns valid fields', () => {
  const f = bjTime.getBeijingFields()
  assert.ok(f.year >= 2024 && f.year <= 2100)
  assert.ok(f.month >= 1 && f.month <= 12)
  assert.ok(f.day >= 1 && f.day <= 31)
  assert.ok(f.hours >= 0 && f.hours <= 23)
  assert.ok(f.minutes >= 0 && f.minutes <= 59)
  assert.ok(f.seconds >= 0 && f.seconds <= 59)
})

test('getBeijingFields from a known UTC timestamp returns Beijing time', () => {
  // 2025-01-15 00:00:00 UTC → 2025-01-15 08:00:00 Beijing
  const ts = Date.UTC(2025, 0, 15, 0, 0, 0)
  const f = bjTime.getBeijingFields(ts)
  assert.equal(f.year, 2025)
  assert.equal(f.month, 1)
  assert.equal(f.day, 15)
  assert.equal(f.hours, 8)
  assert.equal(f.minutes, 0)
})

test('getBeijingFields handles midnight crossing: UTC 17:00 = Beijing 01:00 next day', () => {
  // 2025-03-10 17:00 UTC → 2025-03-11 01:00 Beijing
  const ts = Date.UTC(2025, 2, 10, 17, 0, 0)
  const f = bjTime.getBeijingFields(ts)
  assert.equal(f.year, 2025)
  assert.equal(f.month, 3)
  assert.equal(f.day, 11)
  assert.equal(f.hours, 1)
})

test('formatBeijingDate formats correctly', () => {
  const ts = Date.UTC(2025, 2, 10, 17, 0, 0) // Beijing 2025-03-11
  assert.equal(bjTime.formatBeijingDate(ts), '2025-03-11')
})

test('formatBeijingTime formats correctly', () => {
  const ts = Date.UTC(2025, 2, 10, 17, 30, 45) // Beijing 01:30:45
  assert.equal(bjTime.formatBeijingTime(ts), '01:30:45')
})

test('formatBeijingDateTime formats correctly', () => {
  const ts = Date.UTC(2025, 0, 1, 16, 0, 0) // Beijing 2025-01-02 00:00
  assert.equal(bjTime.formatBeijingDateTime(ts), '2025-01-02 00:00')
})

test('getBeijingMonthRange returns correct start and end', () => {
  const range = bjTime.getBeijingMonthRange('2025-03')
  assert.equal(range.startDate, '2025-03-01')
  assert.equal(range.endDate, '2025-04-01')
})

test('getBeijingMonthRange handles December correctly', () => {
  const range = bjTime.getBeijingMonthRange('2025-12')
  assert.equal(range.startDate, '2025-12-01')
  assert.equal(range.endDate, '2026-01-01')
})

test('getBeijingYearRange returns correct start and end', () => {
  const range = bjTime.getBeijingYearRange(2025)
  assert.equal(range.startDate, '2025-01-01')
  assert.equal(range.endDate, '2026-01-01')
})

test('isSameBeijingDay compares correctly across midnight UTC', () => {
  // 2025-03-10 17:00 UTC and 2025-03-10 23:00 UTC
  // Beijing: 2025-03-11 01:00 and 2025-03-11 07:00 → same day
  const ts1 = Date.UTC(2025, 2, 10, 17, 0, 0)
  const ts2 = Date.UTC(2025, 2, 10, 23, 0, 0)
  assert.equal(bjTime.isSameBeijingDay(ts1, ts2), true)
})

test('isSameBeijingDay detects different days', () => {
  // 2025-03-10 15:00 UTC → Beijing 23:00 March 10
  // 2025-03-10 17:00 UTC → Beijing 01:00 March 11
  const ts1 = Date.UTC(2025, 2, 10, 15, 0, 0)
  const ts2 = Date.UTC(2025, 2, 10, 17, 0, 0)
  assert.equal(bjTime.isSameBeijingDay(ts1, ts2), false)
})

test('toUTCTimestamp handles various input types', () => {
  // number passthrough
  assert.equal(bjTime.toUTCTimestamp(1000), 1000)

  // Date object
  const d = new Date('2025-01-15T00:00:00Z')
  assert.equal(bjTime.toUTCTimestamp(d), d.getTime())

  // ISO string
  assert.equal(bjTime.toUTCTimestamp('2025-01-15T00:00:00Z'), Date.UTC(2025, 0, 15))

  // null/undefined
  assert.equal(bjTime.toUTCTimestamp(null), 0)
  assert.equal(bjTime.toUTCTimestamp(undefined), 0)
})

test('calcHoursBetween returns correct hours', () => {
  const ts1 = Date.UTC(2025, 0, 1, 0, 0, 0)
  const ts2 = Date.UTC(2025, 0, 1, 8, 30, 0)
  assert.equal(bjTime.calcHoursBetween(ts1, ts2), 8.5)
})

test('getBeijingDayRange returns correct start and end timestamps', () => {
  const range = bjTime.getBeijingDayRange('2025-03-15')
  // Beijing 2025-03-15 00:00:00 = UTC 2025-03-14 16:00:00
  assert.equal(range.startUTC, Date.UTC(2025, 2, 14, 16, 0, 0))
  // Beijing 2025-03-16 00:00:00 = UTC 2025-03-15 16:00:00
  assert.equal(range.endUTC, Date.UTC(2025, 2, 15, 16, 0, 0))
})
