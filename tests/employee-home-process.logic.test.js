const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  buildHomeProcessView
} = require('../miniprogram/pages/employee/home/home.logic')

const root = path.join(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('buildHomeProcessView prepares direct-to-worklog process cards', () => {
  const processes = [
    { _id: 'p1', process_name: '订前斗，单线', order_name: '8号1楼', current_price: 0.4, order_total_quantity: 100, current_total: 20, remaining_quantity: 80 },
    { _id: 'p2', process_name: '挖前兜布2个', order_name: '8号1楼', current_price: 0.26, order_total_quantity: 100, current_total: 100, remaining_quantity: 0, price_hidden: true },
    { _id: 'p3', process_name: '订后斗盖粘扣2个', order_name: '9号2楼', current_price: 0.08, order_total_quantity: 50, current_total: 10, remaining_quantity: 40 }
  ]

  const view = buildHomeProcessView(processes, 2)

  assert.equal(view.totalCount, 3)
  assert.equal(view.visibleCount, 2)
  assert.equal(view.hasMore, true)
  assert.equal(view.items[0].priceText, '¥0.4/件')
  assert.equal(view.items[0].quotaText, '剩余 80 件')
  assert.equal(view.items[0].progressPercent, 20)
  assert.equal(view.items[1].priceText, '工价已隐藏')
  assert.equal(view.items[1].statusText, '已报满')
  assert.equal(view.items[1].actionText, '进入报工')
})

test('employee homepage puts clocking before worklog and process cards navigate away', () => {
  const source = read('miniprogram/pages/employee/home/home.wxml')
  const clockIndex = source.indexOf('class="clock-section')
  const processIndex = source.indexOf('class="home-process-section')

  assert.ok(clockIndex >= 0, 'clock section should exist')
  assert.ok(processIndex >= 0, 'process section should exist')
  assert.ok(clockIndex < processIndex, 'clock section should be above assigned processes')
  assert.match(source, /class="home-process-card[^"]*"[\s\S]*bindtap="goToWorklog"[\s\S]*data-id="\{\{item\._id\}\}"/)
  assert.doesNotMatch(source, /\bhome-report-panel\b/)
  assert.doesNotMatch(source, /\bhome-qty-input\b/)
  assert.doesNotMatch(source, /\bonSelectHomeProcess\b/)
  assert.doesNotMatch(source, /\bonSubmitHomeWorklog\b/)
})

test('employee homepage moves payroll summary into the workbench hero', () => {
  const wxml = read('miniprogram/pages/employee/home/home.wxml')
  const wxss = read('miniprogram/pages/employee/home/home.wxss')

  assert.match(wxml, /\bhome-hero-metrics\b/)
  assert.match(wxml, /\bhome-hero-primary\b/)
  assert.match(wxml, /今日预估工资/)
  assert.match(wxml, /本月累计工时/)
  assert.match(wxml, /入厂时间/)
  assert.doesNotMatch(wxml, /今日状态/)
  assert.doesNotMatch(wxml, /\bhome-summary-grid\b/)
  assert.doesNotMatch(wxml, /&#x276F;|&amp;#x276F;/)
  assert.match(wxss, /\.home-hero-primary\s*\{[^}]*justify-content:\s*center[^}]*font-variant-numeric:\s*tabular-nums/s)
})

test('employee homepage keeps attendance compact above worklog', () => {
  const wxml = read('miniprogram/pages/employee/home/home.wxml')
  const wxss = read('miniprogram/pages/employee/home/home.wxss')

  assert.match(wxml, /class="clock-section home-clock-compact"/)
  assert.match(wxss, /\.home-clock-compact\s*\{[^}]*padding:\s*22rpx/s)
  assert.match(wxss, /\.home-clock-compact \.clock-btn\s*\{[^}]*min-height:\s*112rpx/s)
})
