const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const {
  normalizePrice,
  normalizeAssignedProcessForEmployee,
  buildOrderProcessCards,
  filterEmployeeVisibleWorkLogs,
  buildWorklogHistoryView
} = require('../miniprogram/pages/employee/worklog/worklog.logic')

const root = path.join(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

test('normalizePrice returns zero for empty values', () => {
  assert.equal(normalizePrice(null), 0)
  assert.equal(normalizePrice(undefined), 0)
  assert.equal(normalizePrice(''), 0)
})

test('normalizePrice preserves numeric values', () => {
  assert.equal(normalizePrice(0), 0)
  assert.equal(normalizePrice(1.5), 1.5)
  assert.equal(normalizePrice('2.25'), 2.25)
})

test('normalizeAssignedProcessForEmployee shows zero price when price is unset', () => {
  const result = normalizeAssignedProcessForEmployee({
    _id: 'p1',
    order_name: '订单A',
    process_name: '缝制',
    current_price: null,
    price_hidden: false
  })

  assert.equal(result.current_price, 0)
  assert.equal(result.display, '订单A - 缝制 (¥0/件)')
})

test('normalizeAssignedProcessForEmployee keeps hidden-price copy while allowing zero snapshot', () => {
  const result = normalizeAssignedProcessForEmployee({
    _id: 'p2',
    order_name: '订单B',
    process_name: '包装',
    current_price: null,
    price_hidden: true
  })

  assert.equal(result.current_price, 0)
  assert.equal(result.display, '订单B - 包装 (工价已隐藏)')
})

test('filterEmployeeVisibleWorkLogs hides worklog details for completed orders', () => {
  const logs = [
    { _id: 'l1', order_id: 'o_active', process_name: '缝制', quantity: 10 },
    { _id: 'l2', order_id: 'o_done', process_name: '包装', quantity: 20 }
  ]
  const result = filterEmployeeVisibleWorkLogs(logs, {
    o_active: { status: 'active' },
    o_done: { status: 'completed' }
  })

  assert.deepEqual(result.map(item => item._id), ['l1'])
})

test('buildWorklogHistoryView groups historical logs into process overview cards', () => {
  const view = buildWorklogHistoryView([
    { _id: 'l1', order_id: 'o1', order_name: '订单A', process_id: 'p1', process_name: '缝制', quantity: 10, snapshot_price: 0.5, date: '2026-06-01' },
    { _id: 'l2', order_id: 'o1', order_name: '订单A', process_id: 'p1', process_name: '缝制', quantity: 15, snapshot_price: 0.5, date: '2026-06-03' },
    { _id: 'l3', order_id: 'o2', order_name: '订单B', process_id: 'p2', process_name: '包装', quantity: 8, snapshot_price: 0.2, price_hidden: true, date: '2026-06-02' }
  ])

  assert.equal(view.totalQuantity, 33)
  assert.equal(view.totalCount, 3)
  assert.equal(view.overviewCards.length, 2)
  assert.equal(view.overviewCards[0].process_name, '缝制')
  assert.equal(view.overviewCards[0].quantityText, '累计 25 件')
  assert.equal(view.overviewCards[0].amountText, '¥12.50')
  assert.equal(view.overviewCards[0].detailText, '2 条明细')
  assert.equal(view.overviewCards[0].lastText, '最近 2026-06-03')
  assert.equal(view.overviewCards[1].amountText, '金额已隐藏')
})

test('buildOrderProcessCards filters by order and keyword', () => {
  const processes = [
    { _id: 'p1', order_id: 'oA', order_name: '工装短裤', process_name: '车缝', order_total_quantity: 100, current_total: 40, user_current_total: 20, current_price: 2 },
    { _id: 'p2', order_id: 'oA', order_name: '工装短裤', process_name: '锁边', order_total_quantity: 100, current_total: 100, user_current_total: 50, current_price: 1.5 },
    { _id: 'p3', order_id: 'oB', order_name: '别的订单', process_name: '车缝', order_total_quantity: 80, current_total: 0, user_current_total: 0, current_price: 3 }
  ]
  // 仅订单 oA 的两道工序
  const all = buildOrderProcessCards(processes, 'oA', '')
  assert.equal(all.totalCount, 2)
  assert.equal(all.items.length, 2)
  // p2 已报满
  const p2 = all.items.find((x) => x._id === 'p2')
  assert.equal(p2.isComplete, true)
  assert.equal(p2.statusText, '已报满')
  // p1 未满 + 工价/剩余文案
  const p1 = all.items.find((x) => x._id === 'p1')
  assert.equal(p1.isComplete, false)
  assert.equal(p1.priceText, '¥2/件')
  assert.equal(p1.remainingText, '剩余可报 60 件')
  // 关键词搜索（工序名）
  const searched = buildOrderProcessCards(processes, 'oA', '锁边')
  assert.equal(searched.matchedCount, 1)
  assert.equal(searched.items[0]._id, 'p2')
})

test('employee worklog page is submit-only and history page is history-only', () => {
  const submitSource = read('miniprogram/pages/employee/worklog/worklog.wxml')
  const submitJs = read('miniprogram/pages/employee/worklog/worklog.js')
  const historySource = read('miniprogram/pages/employee/worklog-history/worklog-history.wxml')
  const pageConfig = read('miniprogram/pages/employee/worklog/worklog.json')
  const historyConfig = read('miniprogram/pages/employee/worklog-history/worklog-history.json')
  const appConfig = read('miniprogram/app.json')

  assert.match(pageConfig, /计件报工/)
  assert.match(submitSource, /提交报工/)
  assert.match(submitSource, /bindtap="onSubmit"/)
  // 工序卡片 + 搜索（点击工序卡直接报工，替代旧的 picker 选择）
  assert.match(submitSource, /bindtap="onSelectProcessCard"/)
  assert.match(submitSource, /bindinput="onSearchInput"/)
  assert.match(submitSource, /完成数量/)
  assert.doesNotMatch(submitSource, /报工总览/)
  assert.doesNotMatch(submitSource, /历史报工记录/)
  assert.doesNotMatch(submitJs, /getUserPayrollLogs/)
  assert.match(appConfig, /pages\/employee\/worklog-history\/worklog-history/)

  assert.match(historyConfig, /历史报工记录/)
  assert.match(historySource, /历史报工记录/)
  assert.match(historySource, /报工总览/)
  assert.match(historySource, /明细/)
  assert.match(historySource, /worklog-overview-card/)
  assert.match(historySource, /historyLogs/)
  assert.match(historySource, /bindtap="onEditLog"[\s\S]*编辑数量/)
  assert.match(historySource, /bindtap="onDeleteLog"[\s\S]*删除本条/)
  assert.doesNotMatch(historySource, /提交报工/)
  assert.doesNotMatch(historySource, /bindtap="onSubmit"/)
  assert.doesNotMatch(historySource, /range="\{\{processes\}\}"/)
  assert.doesNotMatch(historySource, /完成数量/)
  assert.doesNotMatch(historySource, /wx:if="\{\{item\.is_today && !item\.is_locked\}\}"/)
})

test('employee self delete worklog is not limited to today', () => {
  const source = read('cloudfunctions/worklog/index.js')

  assert.match(source, /删除历史报工/)
  assert.doesNotMatch(source, /仅支持撤销当日报工记录/)
})

test('employee worklog history follows payroll mode from settings', () => {
  const js = read('miniprogram/pages/employee/worklog-history/worklog-history.js')
  const wxml = read('miniprogram/pages/employee/worklog-history/worklog-history.wxml')
  const cloud = read('cloudfunctions/worklog/index.js')

  assert.match(js, /action:\s*'getUserPayrollLogs'/)
  assert.match(wxml, /\{\{historySummaryLabel\}\}/)
  assert.match(cloud, /salary_payroll_mode/)
  assert.match(cloud, /getUserPayrollLogs/)
})

test('worklog auth uses the strict shared guard with no openid fallback', () => {
  const source = read('cloudfunctions/worklog/index.js')

  // 统一鉴权后不允许任何 openid 回退路径（auth-guard 强制 token 严格匹配）
  assert.doesNotMatch(source, /return\s+matched\s*\|\|\s*fallbackUser/)
  assert.doesNotMatch(source, /openid:\s*wxContext\.OPENID/)
  assert.match(source, /require\('\.\/auth-guard'\)/)
})

test('manage worklog price join does not pass query options as limit', () => {
  const source = read('cloudfunctions/worklog/index.js')

  assert.doesNotMatch(
    source,
    /fetchAllDocs\('Processes',\s*\{[\s\S]*?\},\s*\{\s*field:/
  )
})
