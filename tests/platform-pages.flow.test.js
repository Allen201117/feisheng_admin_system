// 平台管理两页的端到端流程：页面 JS → callCloud → 真实 platform/billing 云函数入口 → 内存数据库。
// 只验证 JS 行为与前后端契约；WXML 渲染需在微信开发者工具里预览确认。
const test = require('node:test')
const assert = require('node:assert/strict')
const { createFakeDb, platformSeed } = require('./helpers/fake-cloud')
const { installMiniProgram, flush, tap, input } = require('./helpers/fake-miniprogram')

const DAY = 24 * 60 * 60 * 1000

function seed() {
  return platformSeed({
    Organizations: [
      { _id: 'org_a', org_name: '华锦服饰', factory_code: 'HJ01', status: 'active', billing_status: 'active', plan_id: 'standard_year', current_period_end: new Date(Date.now() + 100 * DAY), contact_name: '王建国', created_at: new Date(Date.now() - 50 * DAY) },
      { _id: 'org_b', org_name: '永兴制衣', factory_code: 'YX02', status: 'active', billing_status: 'trial', plan_id: 'trial', trial_end: new Date(Date.now() + 4 * DAY), created_at: new Date(Date.now() - 3 * DAY) },
      { _id: 'org_c', org_name: '恒丰针织', factory_code: 'HF05', status: 'disabled', created_at: new Date(Date.now() - 200 * DAY) }
    ],
    Users: [
      { _id: 'boss_a1', org_id: 'org_a', name: '王建国', phone: '13800001001', role: 'boss', status: 'active', session_token: 's1', must_change_password: true, created_at: new Date() },
      { _id: 'emp_a1', org_id: 'org_a', name: '员工甲', role: 'employee', status: 'active' }
    ]
  })
}

function addMonthsTs(ts, months) {
  const d = new Date(ts)
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.getTime()
}

test('列表页：加载 → 三分类总览 → 点数字筛选/再点取消 → 搜索 → 进详情', async () => {
  const fake = createFakeDb(seed())
  const mp = installMiniProgram({ fake })
  const page = mp.loadPage('pages/platform/home/home')
  page.onLoad()
  await flush()

  assert.equal(page.data.loading, false)
  assert.equal(page.data.loadError, '')
  assert.deepEqual(page.data.overviewCards.map(c => c.label + c.value), ['全部3', '正常1', '试用中1', '停用1'])
  // 默认快到期在前：试用剩 4 天 → 华锦 → 停用
  assert.deepEqual(page.data.rows.map(r => r._id), ['org_b', 'org_a', 'org_c'])
  assert.equal(page.data.rows[0].expiry_text_class, 'text-amber')

  page.onOverviewTap(tap({ key: 'trial' }))
  assert.deepEqual(page.data.rows.map(r => r._id), ['org_b'])
  page.onOverviewTap(tap({ key: 'trial' }))
  assert.equal(page.data.activeFilter, 'all')

  page.onOrgSearchInput(input('hj01'))
  assert.deepEqual(page.data.rows.map(r => r._id), ['org_a'])
  page.clearOrgSearch()
  assert.equal(page.data.rows.length, 3)

  page.toggleSort()
  assert.equal(page.data.sortLabel, '新建的在前')
  assert.equal(page.data.rows[0]._id, 'org_b')

  page.openOrg(tap({ id: 'org_a' }))
  assert.deepEqual(mp.calls.navigateTo, ['/pages/platform/org-detail/org-detail?id=org_a'])
})

test('列表页：没登录或不是平台管理员直接回登录页，不调云函数', async () => {
  const fake = createFakeDb(seed())
  const mp = installMiniProgram({ fake, user: { _id: 'boss_a1', role: 'boss', session_token: 's1' } })
  const page = mp.loadPage('pages/platform/home/home')
  page.onLoad()
  await flush()
  assert.deepEqual(mp.calls.reLaunch, ['/pages/login/login'])
  assert.deepEqual(mp.calls.cloud, [])
})

test('列表页：新建工厂先在本地拦住错工厂码，填对后创建并带 fresh=1 进详情', async () => {
  const fake = createFakeDb(seed())
  const mp = installMiniProgram({ fake })
  const page = mp.loadPage('pages/platform/home/home')
  page.onLoad()
  await flush()

  page.openCreate()
  page.onCreateInput(input('丁厂', { field: 'org_name' }))
  page.onCreateInput(input('d-1', { field: 'factory_code' }))
  await page.submitCreate()
  assert.match(page.data.createError, /工厂码/)
  assert.equal(mp.cloudActions().filter(a => a === 'platform.createOrganization').length, 0)

  page.onCreateInput(input('dd04', { field: 'factory_code' }))
  await page.submitCreate()
  await flush()
  assert.equal(page.data.showCreate, false)
  const created = fake.all('Organizations').find(o => o.factory_code === 'DD04')
  assert.ok(created)
  assert.deepEqual(mp.calls.navigateTo, ['/pages/platform/org-detail/org-detail?id=' + created._id + '&fresh=1'])

  // 工厂码撞车：报错并提示可能刚建过
  page.openCreate()
  page.onCreateInput(input('戊厂', { field: 'org_name' }))
  page.onCreateInput(input('DD04', { field: 'factory_code' }))
  await page.submitCreate()
  await flush()
  assert.match(page.data.createError, /已被其他工厂使用.*列表里/)
})

test('详情页：一次加载齐；续费 → 确认弹窗写清前后到期日 → 只顺延一次；同编号重放不再续', async () => {
  const fake = createFakeDb(seed())
  const endBefore = fake.get('Organizations', 'org_a').current_period_end.getTime()
  const mp = installMiniProgram({ fake })
  const page = mp.loadPage('pages/platform/org-detail/org-detail')
  page.onLoad({ id: 'org_a' })
  await flush()

  assert.equal(page.data.org.org_name, '华锦服饰')
  assert.equal(page.data.employeeCount, 1)
  assert.equal(page.data.activeAdminCount, 1)
  assert.equal(page.data.subAction.text, '续费')
  assert.equal(page.data.plans.length, 2)
  assert.equal(mp.cloudActions().filter(a => a === 'platform.getOrganizationDetail').length, 1)

  await page.openRenew()
  assert.equal(page.data.renew.planId, 'standard_year')
  assert.equal(page.data.renew.amount, '1999')
  assert.equal(page.data.renewView.canSubmit, true)
  page.onRenewDurationTap(tap({ value: 24 }))
  assert.equal(page.data.renew.amount, '3998')
  page.onRenewRemarkInput(input('微信已收款'))
  const requestId = page._renewRequestId

  page.submitRenew()
  await flush()
  const modal = mp.calls.modals[mp.calls.modals.length - 1]
  assert.equal(modal.title, '确认已收款')
  assert.match(modal.content, /标准版年付 2 年/)
  assert.match(modal.content, /→/)
  assert.match(modal.content, /¥3998/)

  const expected = addMonthsTs(endBefore, 24)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), expected)
  assert.equal(page.data.showRenew, false)
  assert.match(mp.calls.toasts[mp.calls.toasts.length - 1], /^已生效，到期 \d{4}-\d{2}-\d{2}$/)
  const order = fake.all('BillingOrders')[0]
  assert.equal(order.remark, '微信已收款')
  assert.equal(order.payment_channel, 'manual_wechat')

  // 模拟网络超时后 callCloud 用同一个请求编号重发
  page._renewRequestId = requestId
  await page.doRenew(page.data.renewView)
  await flush()
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), expected, '同一编号不会再续')
  assert.equal(fake.all('BillingOrders').length, 1)
})

test('详情页：续费失败 → 刷新详情、锁住内容；再点按原内容补完；关掉重开会先补上次那笔并弹窗说明', async () => {
  const fake = createFakeDb(seed())
  const endBefore = fake.get('Organizations', 'org_a').current_period_end.getTime()
  const mp = installMiniProgram({ fake })
  const page = mp.loadPage('pages/platform/org-detail/org-detail')
  page.onLoad({ id: 'org_a' })
  await flush()
  const detailCalls = () => mp.cloudActions().filter(a => a === 'platform.getOrganizationDetail').length

  await page.openRenew()
  fake.failNext('Organizations', 'update')
  page.submitRenew()
  await flush()
  assert.equal(page.data.renewLocked, true)
  assert.match(page.data.renewError, /不会重复续费/)
  assert.equal(detailCalls(), 2, '失败后刷新详情')

  // 锁定后改不了内容
  page.onRenewDurationTap(tap({ value: 36 }))
  page.onRenewAmountInput(input('5997'))
  assert.equal(page.data.renew.duration, 12)
  assert.equal(page.data.renew.amount, '1999')

  // 再点：不再弹确认，直接按原内容补完
  const modalsBefore = mp.calls.modals.length
  page.submitRenew()
  await flush()
  assert.equal(mp.calls.modals.length, modalsBefore)
  assert.equal(page.data.showRenew, false)
  assert.equal(page.data.renewLocked, false)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), addMonthsTs(endBefore, 12))

  // 再来一次失败，然后关掉重开（新编号、改成 2 年）
  await page.openRenew()
  fake.failNext('BillingOrders', 'update')
  page.submitRenew()
  await flush()
  const afterSecond = fake.get('Organizations', 'org_a').current_period_end.getTime()
  assert.equal(afterSecond, addMonthsTs(addMonthsTs(endBefore, 12), 12), '第二笔其实已写进工厂')
  page.closeRenew()
  await page.openRenew()
  page.onRenewDurationTap(tap({ value: 24 }))
  page.submitRenew()
  await flush()
  const modal = mp.calls.modals[mp.calls.modals.length - 1]
  assert.equal(modal.title, '补上了上次那笔')
  assert.match(modal.content, /没有再续费/)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), afterSecond, '没有续两次')
})

test('详情页：付费工厂选试用 → 按钮不可点并说明原因，点了也不发请求', async () => {
  const fake = createFakeDb(seed())
  const mp = installMiniProgram({ fake })
  const page = mp.loadPage('pages/platform/org-detail/org-detail')
  page.onLoad({ id: 'org_a' })
  await flush()
  await page.openRenew()
  page.onRenewPlanTap(tap({ id: 'trial' }))
  assert.equal(page.data.renewView.canSubmit, false)
  assert.match(page.data.renewView.error, /不能改回试用/)
  page.submitRenew()
  await flush()
  assert.equal(mp.calls.modals.length, 0)
  assert.equal(mp.cloudActions().filter(a => a === 'billing.openSubscription').length, 0)
})

test('详情页：新工厂默认开试用，0 元记「平台赠送」', async () => {
  const fake = createFakeDb(seed())
  await fake.db.collection('Organizations').add({ data: { _id: 'org_new', org_name: '新厂', factory_code: 'XC09', status: 'active', billing_status: 'not_enabled', created_at: new Date() } })
  const mp = installMiniProgram({ fake })
  const page = mp.loadPage('pages/platform/org-detail/org-detail')
  page.onLoad({ id: 'org_new', fresh: '1' })
  await flush()
  assert.equal(page.data.fresh, true)
  assert.equal(page.data.subAction.text, '开通订阅')
  await page.openRenew()
  assert.equal(page.data.renew.planId, 'trial')
  page.onRenewDurationTap(tap({ value: 15 }))
  page.submitRenew()
  await flush()
  const org = fake.get('Organizations', 'org_new')
  assert.equal(org.billing_status, 'trial')
  assert.equal(fake.all('BillingOrders')[0].payment_channel, 'gift')
  assert.equal(fake.all('BillingOrders')[0].trial_days, 15)
})

test('详情页：老板账号 添加（本地校验→成功）/ 复制登录方式 / 停最后一个被拒', async () => {
  const fake = createFakeDb(seed())
  const mp = installMiniProgram({ fake })
  const page = mp.loadPage('pages/platform/org-detail/org-detail')
  page.onLoad({ id: 'org_a' })
  await flush()

  page.copyLoginInfo(tap({ index: 0 }))
  assert.match(mp.calls.clipboard[0], /工厂码：HJ01/)
  assert.match(mp.calls.clipboard[0], /手机号：13800001001/)

  page.toggleAdminStatus(tap({ index: 0 }))
  await flush()
  assert.match(mp.calls.toasts[mp.calls.toasts.length - 1], /最后一个/)
  assert.equal(fake.get('Users', 'boss_a1').status, 'active')

  page.openAdmin()
  page.onAdminInput(input('李秀英', { field: 'name' }))
  page.onAdminInput(input('1390000', { field: 'phone' }))
  await page.submitAdmin()
  assert.match(page.data.adminError, /手机号/)
  page.onAdminInput(input('13900002002', { field: 'phone' }))
  await page.submitAdmin()
  await flush()
  assert.equal(page.data.showAdmin, false)
  assert.equal(page.data.activeAdminCount, 2)

  // 现在有两个了，可以停掉第一个
  const target = page.data.admins.findIndex(a => a._id === 'boss_a1')
  page.toggleAdminStatus(tap({ index: target }))
  await flush()
  assert.equal(fake.get('Users', 'boss_a1').status, 'disabled')
  assert.equal(fake.get('Users', 'boss_a1').session_token, '')
})

test('详情页：改工厂码先弹确认（写明影响人数），取消就不保存', async () => {
  const fake = createFakeDb(seed())
  const mp = installMiniProgram({ fake })
  const page = mp.loadPage('pages/platform/org-detail/org-detail')
  page.onLoad({ id: 'org_a' })
  await flush()

  page.openEdit()
  page.onEditInput(input('hj99', { field: 'factory_code' }))
  assert.equal(page.data.editCodeChanged, true)
  assert.equal(page.data.editNewCode, 'HJ99')

  mp.setModalAnswer(false)
  page.submitEdit()
  await flush()
  assert.match(mp.calls.modals[0].content, /全厂 2 个账号/)
  assert.equal(fake.get('Organizations', 'org_a').factory_code, 'HJ01')

  mp.setModalAnswer(true)
  page.submitEdit()
  await flush()
  assert.equal(fake.get('Organizations', 'org_a').factory_code, 'HJ99')
  assert.equal(page.data.showEdit, false)

  // 只改名字不弹确认
  const before = mp.calls.modals.length
  page.openEdit()
  page.onEditInput(input('华锦服饰二厂', { field: 'org_name' }))
  page.submitEdit()
  await flush()
  assert.equal(mp.calls.modals.length, before)
  assert.equal(fake.get('Organizations', 'org_a').org_name, '华锦服饰二厂')
})

test('详情页：停用工厂要确认；自家工厂不给停用入口', async () => {
  const fake = createFakeDb(platformSeed({
    Organizations: [
      { _id: 'org_a', org_name: '华锦服饰', factory_code: 'HJ01', status: 'active', created_at: new Date() },
      { _id: 'org_home', org_name: '飞盛', factory_code: 'A001', status: 'active', billing_status: 'permanent', plan_id: 'standard_year', subscription_id: 'sub_org_home_permanent', created_at: new Date() }
    ]
  }))
  const mp = installMiniProgram({ fake })
  const page = mp.loadPage('pages/platform/org-detail/org-detail')
  page.onLoad({ id: 'org_a' })
  await flush()
  mp.setModalAnswer(false)
  page.toggleOrgStatus()
  await flush()
  assert.equal(fake.get('Organizations', 'org_a').status, 'active')
  mp.setModalAnswer(true)
  page.toggleOrgStatus()
  await flush()
  assert.equal(fake.get('Organizations', 'org_a').status, 'disabled')
  assert.equal(page.data.subAction.disabled, true)

  const home = mp.loadPage('pages/platform/org-detail/org-detail')
  home.onLoad({ id: 'org_home' })
  await flush()
  assert.equal(home.data.canToggleOrg, false)
  assert.equal(home.data.subAction.text, '永久免费，无需续费')
})
