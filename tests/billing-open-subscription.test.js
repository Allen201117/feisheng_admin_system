const test = require('node:test')
const assert = require('node:assert/strict')
const { createFakeDb, loadCloudFunction, platformSeed, ADMIN_AUTH } = require('./helpers/fake-cloud')

const DAY = 24 * 60 * 60 * 1000

function seedWithFactory(org) {
  return platformSeed({
    Organizations: [Object.assign({ _id: 'org_a', org_name: '甲厂', factory_code: 'JA01', status: 'active' }, org)]
  })
}

function setup(org) {
  const fake = createFakeDb(seedWithFactory(org))
  const billing = loadCloudFunction('billing', fake)
  const call = (data) => billing.main(Object.assign({}, ADMIN_AUTH, data), {})
  return { fake, call }
}

const futureEnd = () => new Date(Date.now() + 100 * DAY)

function renew(extra) {
  return Object.assign({
    action: 'openSubscription',
    org_id: 'org_a',
    plan_id: 'standard_year',
    period_months: 12,
    amount_yuan: '1999',
    request_id: 'req_renew_0001'
  }, extra)
}

function expectedEnd(fromDate, months) {
  const d = new Date(fromDate.getTime())
  d.setUTCMonth(d.getUTCMonth() + months)
  return d.getTime()
}

test('续费：从当前到期日顺延 12 个月，记 1 条已生效收款记录', async () => {
  const end = futureEnd()
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: end })
  const res = await call(renew())
  assert.equal(res.code, 0, res.msg)
  const org = fake.get('Organizations', 'org_a')
  assert.equal(org.current_period_end.getTime(), expectedEnd(end, 12))
  assert.equal(org.billing_status, 'active')
  const orders = fake.all('BillingOrders')
  assert.equal(orders.length, 1)
  assert.equal(orders[0].payment_status, 'paid')
  assert.equal(orders[0].applied, true)
  assert.equal(orders[0].amount_cents, 199900)
  assert.equal(orders[0].period_months, 12)
  assert.equal(fake.all('Subscriptions').length, 1)
  assert.equal(org.subscription_id, orders[0].subscription_id)
})

test('同一 request_id 提交两次（网络重试）：只续一次', async () => {
  const end = futureEnd()
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: end })
  assert.equal((await call(renew())).code, 0)
  const second = await call(renew())
  assert.equal(second.code, 0)
  assert.equal(second.data.deduplicated, true)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), expectedEnd(end, 12))
  assert.equal(fake.all('BillingOrders').length, 1)
  assert.equal(fake.all('Subscriptions').length, 1)
})

test('不同 request_id 是两次真实续费：各续一次', async () => {
  const end = futureEnd()
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: end })
  assert.equal((await call(renew())).code, 0)
  assert.equal((await call(renew({ request_id: 'req_renew_0002' }))).code, 0)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), expectedEnd(new Date(expectedEnd(end, 12)), 12))
  assert.equal(fake.all('BillingOrders').length, 2)
})

test('写到一半（工厂没更新成）失败后重试：按冻结日期补完，不会续两次', async () => {
  const end = futureEnd()
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: end })
  fake.failNext('Organizations', 'update')
  const first = await call(renew())
  assert.equal(first.code, -1)
  assert.match(first.msg, /不会重复续费/)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), end.getTime(), '失败时工厂到期日不变')
  assert.equal(fake.all('BillingOrders')[0].payment_status, 'pending')

  const retry = await call(renew())
  assert.equal(retry.code, 0, retry.msg)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), expectedEnd(end, 12))
  const orders = fake.all('BillingOrders')
  assert.equal(orders.length, 1)
  assert.equal(orders[0].payment_status, 'paid')
  assert.equal(orders[0].applied, true)
})

test('工厂已更新、收款记录没标完就失败：重试不会再顺延', async () => {
  const end = futureEnd()
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: end })
  // 第一次 update 是 Organizations；让 BillingOrders 的「标记已生效」那次 update 失败
  fake.failNext('BillingOrders', 'update')
  assert.equal((await call(renew())).code, -1)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), expectedEnd(end, 12))

  assert.equal((await call(renew())).code, 0)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), expectedEnd(end, 12), '重试后仍只续一次')
  assert.equal(fake.all('BillingOrders')[0].applied, true)
})

test('同一编号改了内容再提交：拒绝，不会悄悄按旧内容生效', async () => {
  const end = futureEnd()
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: end })
  fake.failNext('Organizations', 'update')
  assert.equal((await call(renew())).code, -1)
  const changed = await call(renew({ period_months: 24, amount_yuan: '3998' }))
  assert.equal(changed.code, -1)
  assert.match(changed.msg, /内容和上次不一样/)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), end.getTime())
})

test('失败后关掉弹层重开（新编号）：先补完上次那笔并说明，不会续两次', async () => {
  const end = futureEnd()
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: end })
  // 工厂已更新、但收款记录没标完 —— 客户端看到的是失败
  fake.failNext('BillingOrders', 'update')
  assert.equal((await call(renew())).code, -1)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), expectedEnd(end, 12))

  const reopened = await call(renew({ request_id: 'req_renew_0002', period_months: 24, amount_yuan: '3998' }))
  assert.equal(reopened.code, 0, reopened.msg)
  assert.equal(reopened.data.resumed_previous, true)
  assert.match(reopened.msg, /上次没完成的那笔开通（标准版年付 1 年，¥1999）已补上/)
  assert.match(reopened.msg, /没有再续费/)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), expectedEnd(end, 12), '仍只续了一次')
  assert.equal(fake.all('BillingOrders').length, 1)
  assert.equal(fake.all('BillingOrders')[0].applied, true)

  // 补完之后再提交才是真正的新续费
  assert.equal((await call(renew({ request_id: 'req_renew_0003' }))).code, 0)
  assert.equal(fake.get('Organizations', 'org_a').current_period_end.getTime(), expectedEnd(new Date(expectedEnd(end, 12)), 12))
})

test('没写完的开通，工厂后来变成永久免费：不自动补完', async () => {
  const end = futureEnd()
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: end })
  fake.failNext('Organizations', 'update')
  assert.equal((await call(renew())).code, -1)
  await fake.db.collection('Organizations').doc('org_a').update({ data: { billing_status: 'permanent', current_period_end: '' } })
  const res = await call(renew())
  assert.equal(res.code, -1)
  assert.match(res.msg, /永久免费/)
  assert.equal(fake.get('Organizations', 'org_a').billing_status, 'permanent')
})

test('收款方式乱填、备注超长：拒绝', async () => {
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: futureEnd() })
  assert.equal((await call(renew({ payment_channel: 'bitcoin' }))).code, -1)
  assert.equal((await call(renew({ remark: 'x'.repeat(101) }))).code, -1)
  assert.equal(fake.all('BillingOrders').length, 0)
})

test('已开过标准版的工厂选试用：拒绝且不写库', async () => {
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: futureEnd() })
  const res = await call(renew({ plan_id: 'trial', trial_days: 7 }))
  assert.equal(res.code, -1)
  assert.match(res.msg, /不能改回试用/)
  assert.equal(fake.all('BillingOrders').length, 0)
  assert.equal(fake.get('Organizations', 'org_a').plan_id, 'standard_year')
})

test('新工厂开试用：填多少天就给多少天', async () => {
  const { fake, call } = setup({ billing_status: 'not_enabled' })
  const before = Date.now()
  const res = await call(renew({ plan_id: 'trial', trial_days: 15, amount_yuan: '0', period_months: undefined }))
  assert.equal(res.code, 0, res.msg)
  const org = fake.get('Organizations', 'org_a')
  assert.equal(org.billing_status, 'trial')
  const days = (org.trial_end.getTime() - before) / DAY
  assert.ok(days >= 14.99 && days <= 15.01, 'trial days = ' + days)
  assert.equal(fake.all('BillingOrders')[0].trial_days, 15)
})

test('收款金额乱填直接拒绝（以前会静默记成 0 元）', async () => {
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: futureEnd() })
  const res = await call(renew({ amount_yuan: '-5' }))
  assert.equal(res.code, -1)
  assert.equal(fake.all('BillingOrders').length, 0)
})

test('套餐不存在不再悄悄按标准版开', async () => {
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: futureEnd() })
  const res = await call(renew({ plan_id: 'pro_year' }))
  assert.equal(res.code, -1)
  assert.equal(fake.all('BillingOrders').length, 0)
})

test('非平台管理员调用被拒', async () => {
  const fake = createFakeDb(seedWithFactory({ billing_status: 'not_enabled' }))
  const billing = loadCloudFunction('billing', fake)
  const res = await billing.main(Object.assign(renew(), { auth_user_id: 'u_admin', auth_session_token: 'wrong' }), {})
  assert.equal(res.code, -1)
  assert.equal(fake.all('BillingOrders').length, 0)
})

test('listPlans 只读：打开页面不再建集合、不写套餐', async () => {
  const { fake, call } = setup({ billing_status: 'not_enabled' })
  const res = await call({ action: 'listPlans' })
  assert.equal(res.code, 0)
  assert.deepEqual(res.data.map(p => p.plan_id), ['trial', 'standard_year'])
  assert.deepEqual(fake.writes, [])
})

test('markManualPaymentPaid 不能把没生效的开通记录标成已收款', async () => {
  const { fake, call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: futureEnd() })
  fake.failNext('Organizations', 'update')
  await call(renew())
  const pending = fake.all('BillingOrders')[0]
  const res = await call({ action: 'markManualPaymentPaid', billing_order_id: pending._id })
  assert.equal(res.code, -1)
  assert.equal(fake.get('BillingOrders', pending._id).payment_status, 'pending')
})

test('listBillingOrders 返回中文渠道和状态', async () => {
  const { call } = setup({ billing_status: 'active', plan_id: 'standard_year', current_period_end: futureEnd() })
  await call(renew({ remark: '微信已收款' }))
  const res = await call({ action: 'listBillingOrders', org_id: 'org_a' })
  assert.equal(res.code, 0)
  assert.equal(res.data[0].payment_channel_label, '微信收款')
  assert.equal(res.data[0].payment_status_label, '已收款')
  assert.equal(res.data[0].period_text, '1 年')
  assert.equal(res.data[0].amount_yuan, 1999)
})
