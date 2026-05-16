const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const root = path.join(__dirname, '..')

function read(relativePath) {
  return fs.readFileSync(path.join(root, relativePath), 'utf8')
}

function loadProcessSearchLogic() {
  try {
    return require('../miniprogram/pages/boss/process-search.logic')
  } catch (err) {
    assert.fail(`process search logic should exist: ${err.message}`)
  }
}

test('filters processes by trimmed process-name keyword and preserves order', () => {
  const { filterProcessesByKeyword } = loadProcessSearchLogic()
  const processes = [
    { _id: 'p1', process_name: '订前斗，单线' },
    { _id: 'p2', process_name: '挖前兜布2个' },
    { _id: 'p3', process_name: '后片锁边' },
    { _id: 'p4', process_name: '' }
  ]

  assert.deepEqual(
    filterProcessesByKeyword(processes, ' 前 '),
    [processes[0], processes[1]]
  )
  assert.deepEqual(filterProcessesByKeyword(processes, ''), processes)
  assert.deepEqual(filterProcessesByKeyword(null, '前'), [])
})

test('builds paged order-detail process view from assignment filter plus search keyword', () => {
  const { buildProcessListView } = loadProcessSearchLogic()
  const processes = [
    { _id: 'p1', process_name: '订前斗', assigned_user_ids: ['u1'] },
    { _id: 'p2', process_name: '挖前兜布', assigned_user_ids: [] },
    { _id: 'p3', process_name: '后片锁边', assigned_user_ids: [] },
    { _id: 'p4', process_name: '前中缝', assigned_user_ids: [] }
  ]

  const view = buildProcessListView({
    processes,
    processFilter: 'unassigned',
    keyword: '前',
    page: 1,
    pageSize: 1
  })

  assert.deepEqual(view.filteredProcesses.map(item => item._id), ['p2', 'p4'])
  assert.deepEqual(view.displayedProcesses.map(item => item._id), ['p2'])
  assert.equal(view.processPage, 1)
  assert.equal(view.hasMoreProcesses, true)
})

test('order detail and worklog manage pages expose process search inputs', () => {
  const orderDetailWxml = read('miniprogram/pages/boss/order-detail/order-detail.wxml')
  const worklogManageWxml = read('miniprogram/pages/boss/worklog-manage/worklog-manage.wxml')

  assert.match(orderDetailWxml, /bindinput="onProcessSearchInput"/)
  assert.match(orderDetailWxml, /value="\{\{processSearchKeyword\}\}"/)
  assert.match(worklogManageWxml, /bindinput="onProgressProcessSearchInput"/)
  assert.match(worklogManageWxml, /wx:for="\{\{filteredProgressProcesses\}\}"/)
})

test('process search controls reuse global form and button styles', () => {
  const orderDetailWxml = read('miniprogram/pages/boss/order-detail/order-detail.wxml')
  const worklogManageWxml = read('miniprogram/pages/boss/worklog-manage/worklog-manage.wxml')

  for (const source of [orderDetailWxml, worklogManageWxml]) {
    assert.match(source, /class="field-input process-search-input"/)
    assert.match(source, /class="btn-sm btn-sm-secondary process-search-clear/)
    assert.match(source, /class="field-hint process-search-meta"/)
  }
})
