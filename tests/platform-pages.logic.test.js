const test = require('node:test')
const assert = require('node:assert/strict')

const list = require('../miniprogram/pages/platform/home/org-list.logic')
const detail = require('../miniprogram/pages/platform/org-detail/org-detail.logic')
const orgBilling = require('../miniprogram/utils/org-billing.logic')

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 9, 3, 4, 0, 0)

function view(org) {
  return orgBilling.buildOrgView(Object.assign({ status: 'active' }, org), NOW)
}

const ORGS = [
  view({ _id: 'a', org_name: '华锦服饰', factory_code: 'HJ01', billing_status: 'active', current_period_end: new Date(NOW + 166 * DAY), contact_name: '王建国', created_at: new Date(NOW - 30 * DAY) }),
  view({ _id: 'b', org_name: '永兴制衣', factory_code: 'YX02', billing_status: 'trial', trial_end: new Date(NOW + 4 * DAY), created_at: new Date(NOW - 3 * DAY) }),
  view({ _id: 'c', org_name: '盛达服装', factory_code: 'SD03', billing_status: 'active', current_period_end: new Date(NOW - 3 * DAY), created_at: new Date(NOW - 90 * DAY) }),
  view({ _id: 'd', org_name: '飞盛', factory_code: 'A001', billing_status: 'permanent', created_at: new Date(NOW - 400 * DAY) }),
  view({ _id: 'e', org_name: '恒丰针织', factory_code: 'HF05', status: 'disabled', created_at: new Date(NOW - 200 * DAY) }),
  view({ _id: 'f', org_name: '新华制衣', factory_code: 'XH06', contact_phone: '13500001006', created_at: new Date(NOW - 1 * DAY) })
]

test('总览：全部/正常/试用中/停用 四个数，选中态与切换', () => {
  const cards = list.buildOverviewCards(ORGS, 'trial')
  assert.deepEqual(cards.map(c => [c.key, c.value, c.active]), [
    ['all', 6, false], ['normal', 4, false], ['trial', 1, true], ['disabled', 1, false]
  ])
  assert.equal(list.nextFilter('trial', 'trial'), 'all', '再点一次回到全部')
  assert.equal(list.nextFilter('all', 'disabled'), 'disabled')
  assert.equal(list.nextFilter('all', 'bogus'), 'all')
})

test('排序：已过期最前，停用最后；新建排序按创建时间', () => {
  // 已过期 c → 剩 4 天 b → 剩 166 天 a → 没有到期概念的 d(永久)、f(未开通) 按名字 → 停用 e
  assert.deepEqual(list.sortOrgs(ORGS, 'due').map(o => o._id), ['c', 'b', 'a', 'd', 'f', 'e'])
  assert.deepEqual(list.sortOrgs(ORGS, 'created').map(o => o._id), ['f', 'b', 'a', 'c', 'e', 'd'])
})

test('筛选 + 搜索（名称/工厂码/联系人/电话/状态文字）', () => {
  assert.deepEqual(list.filterOrgs(ORGS, 'normal', '').map(o => o._id), ['a', 'c', 'd', 'f'])
  assert.deepEqual(list.filterOrgs(ORGS, 'all', 'hj01').map(o => o._id), ['a'])
  assert.deepEqual(list.filterOrgs(ORGS, 'all', '王建国').map(o => o._id), ['a'])
  assert.deepEqual(list.filterOrgs(ORGS, 'all', '1350000').map(o => o._id), ['f'])
  assert.deepEqual(list.filterOrgs(ORGS, 'all', '已过期').map(o => o._id), ['c'])
  assert.deepEqual(list.filterOrgs(ORGS, 'trial', '华锦').map(o => o._id), [])
})

test('行展示：状态徽章颜色、到期文字颜色、联系人兜底', () => {
  const rows = list.buildOrgRows(ORGS, { filter: 'all', keyword: '', sort: 'due' })
  const byId = id => rows.find(r => r._id === id)
  assert.equal(byId('c').expiry_text_class, 'text-red')
  assert.equal(byId('b').expiry_text_class, 'text-amber')
  assert.equal(byId('b').bucket_badge_class, 'badge-blue')
  assert.equal(byId('e').bucket_badge_class, 'badge-slate')
  assert.equal(byId('a').contact_text, '王建国')
  assert.equal(byId('d').contact_text, '未填联系人')
})

const PLANS = [
  { plan_id: 'trial', plan_name: '试用版', billing_period: 'trial', trial_days: 7, price_yuan: 0 },
  { plan_id: 'standard_year', plan_name: '标准版年付', billing_period: 'year', period_months: 12, price_yuan: 1999 }
]

test('续费弹层默认值：没开通过默认试用 7 天；已付费默认标准版 1 年', () => {
  const fresh = view({ billing_status: 'not_enabled' })
  assert.deepEqual(detail.defaultRenewSelection(fresh, PLANS), { planId: 'trial', duration: 7, amount: '0' })
  const paid = view({ billing_status: 'active', current_period_end: new Date(NOW + 10 * DAY) })
  assert.deepEqual(detail.defaultRenewSelection(paid, PLANS), { planId: 'standard_year', duration: 12, amount: '1999' })
  // 试用中的工厂，续费多半是转正
  assert.equal(detail.defaultRenewSelection(view({ billing_status: 'trial' }), PLANS).planId, 'standard_year')
  assert.equal(detail.defaultAmountYuan(PLANS[1], 6), '999.5')
  assert.equal(detail.defaultAmountYuan(PLANS[1], 24), '3998')
})

test('续费预览：日期与云函数同一套推算；付费工厂选试用直接给出原因', () => {
  const paid = view({ org_name: '华锦服饰', billing_status: 'active', current_period_end: new Date(Date.UTC(2027, 2, 17, 16)) })
  const v = detail.buildRenewView(paid, PLANS, { planId: 'standard_year', duration: 12, amount: '1999' }, NOW)
  assert.equal(v.canSubmit, true)
  assert.deepEqual(v.preview, { currentEndText: '2027-03-18', endText: '2028-03-18', graceText: '2028-03-25', periodText: '1 年', extendsCurrent: true })
  assert.equal(v.submitText, '确认已收款，续 1 年')
  assert.deepEqual(v.durationOptions.map(o => o.active), [false, true, false, false])
  assert.equal(
    detail.buildRenewConfirmContent(paid, PLANS[1], v, '1999'),
    '华锦服饰：标准版年付 1 年\n到期日 2027-03-18 → 2028-03-18\n收款 ¥1999'
  )

  const blocked = detail.buildRenewView(paid, PLANS, { planId: 'trial', duration: 7, amount: '0' }, NOW)
  assert.equal(blocked.canSubmit, false)
  assert.match(blocked.error, /不能改回试用/)
  assert.equal(blocked.isTrial, true)
  assert.deepEqual(blocked.durationOptions.map(o => o.label), ['7 天', '15 天', '30 天'])

  const badAmount = detail.buildRenewView(paid, PLANS, { planId: 'standard_year', duration: 12, amount: '-1' }, NOW)
  assert.equal(badAmount.canSubmit, false)
  assert.match(badAmount.error, /金额/)
})

test('老板账号表单：姓名必填、手机号格式；初始密码一律是手机号（不再收自设密码）', () => {
  assert.equal(detail.validateAdminForm({ name: '', phone: '13800001111' }).ok, false)
  assert.match(detail.validateAdminForm({ name: '张三', phone: '1380000' }).msg, /手机号/)
  assert.deepEqual(detail.validateAdminForm({ name: ' 张三 ', phone: '13800001111', password: 'ignored1' }), { ok: true, data: { name: '张三', phone: '13800001111' } })
})

test('编辑资料：只在改码时校验格式并标记，大小写不算改', () => {
  const same = detail.validateOrgForm({ org_name: '乙厂', factory_code: 'old-code' }, 'old-code')
  assert.equal(same.ok, true)
  assert.equal(same.codeChanged, false)
  assert.equal(same.data.factory_code, 'OLD-CODE', '保存时统一大写')
  assert.equal(detail.validateOrgForm({ org_name: '乙厂', factory_code: 'new-code' }, 'old-code').ok, false)
  const changed = detail.validateOrgForm({ org_name: '乙厂', factory_code: 'yb02' }, 'old-code')
  assert.equal(changed.codeChanged, true)
  assert.equal(changed.data.factory_code, 'YB02')
  // 新建（没有原码）也要校验格式
  assert.equal(detail.validateOrgForm({ org_name: '丁厂', factory_code: 'D' }, '').ok, false)
  assert.equal(detail.validateOrgForm({ org_name: '丁厂', factory_code: 'dd04' }, '').codeChanged, false)
})

test('主按钮文案 / 登录信息 / 请求编号', () => {
  assert.deepEqual(detail.buildSubscriptionAction(view({ billing_status: 'permanent' })), { text: '永久免费，无需续费', disabled: true, hint: '' })
  assert.equal(detail.buildSubscriptionAction(view({ status: 'disabled' })).disabled, true)
  assert.equal(detail.buildSubscriptionAction(view({})).text, '开通订阅')
  assert.equal(detail.buildSubscriptionAction(view({ billing_status: 'trial' })).text, '续费')

  const text = detail.buildLoginInfoText({ factory_code: 'HJ01' }, { name: '王建国', phone: '13800001001', must_change_password: true })
  assert.match(text, /工厂码：HJ01/)
  assert.match(text, /首次登录密码是手机号/)

  const rid = detail.createRequestId(NOW, 'a1b2-c3d4e5f6g7h8')
  assert.equal(orgBilling.isValidRequestId(rid), true, rid)
  assert.equal(orgBilling.isValidRequestId(detail.createRequestId(NOW, '')), true)
})
