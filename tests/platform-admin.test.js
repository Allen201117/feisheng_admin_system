const test = require('node:test')
const assert = require('node:assert/strict')
const { createFakeDb, loadCloudFunction, platformSeed, ADMIN_AUTH } = require('./helpers/fake-cloud')

const DAY = 24 * 60 * 60 * 1000

function boss(id, extra) {
  return Object.assign({ _id: id, org_id: 'org_a', name: '老板' + id, phone: '1380000' + id.slice(-4).padStart(4, '0'), role: 'boss', status: 'active', session_token: 'live_' + id, created_at: new Date() }, extra)
}

function setup(extra) {
  const fake = createFakeDb(platformSeed(Object.assign({
    Organizations: [
      { _id: 'org_a', org_name: '甲厂', factory_code: 'JA01', status: 'active', billing_status: 'trial', plan_id: 'trial', trial_end: new Date(Date.now() + 5 * DAY), created_at: new Date('2026-09-01T00:00:00Z') },
      { _id: 'org_b', org_name: '乙厂', factory_code: 'old-code', status: 'active', billing_status: 'active', plan_id: 'standard_year', current_period_end: new Date(Date.now() + 200 * DAY), created_at: new Date('2026-08-01T00:00:00Z') },
      { _id: 'org_c', org_name: '丙厂', factory_code: 'BC03', status: 'disabled', created_at: new Date('2026-07-01T00:00:00Z') }
    ]
  }, extra)))
  const platform = loadCloudFunction('platform', fake)
  const call = (data) => platform.main(Object.assign({}, ADMIN_AUTH, data), {})
  return { fake, call }
}

test('listOrganizations：不含平台组织，带三分类汇总和到期文字', async () => {
  const { call } = setup()
  const res = await call({ action: 'listOrganizations' })
  assert.equal(res.code, 0, res.msg)
  assert.deepEqual(res.data.map(o => o._id).sort(), ['org_a', 'org_b', 'org_c'])
  assert.deepEqual(res.summary, { total: 3, normal: 1, trial: 1, disabled: 1 })
  const a = res.data.find(o => o._id === 'org_a')
  assert.equal(a.bucket_label, '试用中')
  assert.match(a.expiry_text, /^试用剩 \d+ 天$/)
  assert.equal(a.expiry_tone, 'warn')
  // 原始字段仍在（旧版前端兼容）
  assert.equal(a.factory_code, 'JA01')
  assert.equal(res.data.find(o => o._id === 'org_c').expiry_text, '全厂无法登录')
})

test('getOrganizationDetail：一次取齐老板账号（含已停用）、员工数、开通记录', async () => {
  const { call } = setup({
    Users: [
      boss('b0001'),
      boss('b0002', { status: 'disabled' }),
      { _id: 'e1', org_id: 'org_a', role: 'employee', status: 'active' },
      { _id: 'e2', org_id: 'org_a', role: 'qc', status: 'active' },
      { _id: 'e3', org_id: 'org_a', role: 'employee', status: 'disabled' },
      { _id: 'e4', org_id: 'org_b', role: 'employee', status: 'active' }
    ],
    BillingOrders: [{ _id: 'bo1', org_id: 'org_a', plan_name: '试用版', trial_days: 7, amount_cents: 0, payment_channel: 'gift', payment_status: 'paid', created_at: new Date() }]
  })
  const res = await call({ action: 'getOrganizationDetail', org_id: 'org_a' })
  assert.equal(res.code, 0, res.msg)
  assert.equal(res.data.organization.org_name, '甲厂')
  assert.equal(res.data.employee_count, 2)
  assert.deepEqual(res.data.admins.map(a => a.status), ['active', 'disabled'])
  assert.equal(res.data.active_admin_count, 1)
  assert.equal(res.data.admins[0].session_token, undefined, '不把 token 发给前端')
  assert.equal(res.data.billing_orders[0].payment_channel_label, '平台赠送')
  assert.equal(res.data.billing_orders[0].period_text, '7 天')

  assert.equal((await call({ action: 'getOrganizationDetail', org_id: 'org_platform' })).code, -1)
  assert.equal((await call({ action: 'getOrganizationDetail', org_id: 'nope' })).code, -1)
})

test('setFactoryAdminStatus：最后一个在用老板不能停；停用即踢下线；可恢复', async () => {
  const { fake, call } = setup({ Users: [boss('b0001'), boss('b0002')] })

  const r1 = await call({ action: 'setFactoryAdminStatus', user_id: 'b0001', status: 'disabled' })
  assert.equal(r1.code, 0, r1.msg)
  assert.equal(fake.get('Users', 'b0001').status, 'disabled')
  assert.equal(fake.get('Users', 'b0001').session_token, '', '停用后旧登录失效')

  const r2 = await call({ action: 'setFactoryAdminStatus', user_id: 'b0002', status: 'disabled' })
  assert.equal(r2.code, -1)
  assert.match(r2.msg, /最后一个/)
  assert.equal(fake.get('Users', 'b0002').status, 'active')

  const r3 = await call({ action: 'setFactoryAdminStatus', user_id: 'b0001', status: 'active' })
  assert.equal(r3.code, 0)
  assert.equal(fake.get('Users', 'b0001').status, 'active')
})

test('setFactoryAdminStatus：不能动员工账号、平台管理员、乱传状态', async () => {
  const { call } = setup({ Users: [{ _id: 'e1', org_id: 'org_a', role: 'employee', status: 'active' }] })
  assert.equal((await call({ action: 'setFactoryAdminStatus', user_id: 'e1', status: 'disabled' })).code, -1)
  assert.equal((await call({ action: 'setFactoryAdminStatus', user_id: 'u_admin', status: 'disabled' })).code, -1)
  assert.equal((await call({ action: 'setFactoryAdminStatus', user_id: 'e1', status: 'deleted' })).code, -1)
})

test('createOrganization：工厂码格式/重复校验，成功返回工厂视图', async () => {
  const { fake, call } = setup()
  assert.equal((await call({ action: 'createOrganization', org_name: '丁厂', factory_code: 'D-1' })).code, -1)
  const dup = await call({ action: 'createOrganization', org_name: '丁厂', factory_code: 'ja01' })
  assert.equal(dup.code, -1)
  assert.match(dup.msg, /已被其他工厂使用/)

  const ok = await call({ action: 'createOrganization', org_name: '丁厂', factory_code: 'dd04', contact_name: '丁' })
  assert.equal(ok.code, 0, ok.msg)
  assert.equal(ok.data.organization.factory_code, 'DD04')
  assert.equal(ok.data.organization.expiry_text, '未开通订阅')
  assert.ok(fake.get('factory_settings', ok.data.org_id), '同时建好工厂设置')
})

test('updateOrganization：存量不合规工厂码不改时照常保存（顺手转大写）；改码才校验并标记', async () => {
  const { fake, call } = setup()
  const keep = await call({ action: 'updateOrganization', org_id: 'org_b', org_name: '乙厂新名', factory_code: 'old-code' })
  assert.equal(keep.code, 0, keep.msg)
  assert.equal(keep.data.factory_code_changed, false, '只是大小写不同不算改码')
  // 登录把输入转大写后精确匹配，小写码本来登不进去；保存时统一大写，等于顺手修好
  assert.equal(fake.get('Organizations', 'org_b').factory_code, 'OLD-CODE')

  const bad = await call({ action: 'updateOrganization', org_id: 'org_b', org_name: '乙厂', factory_code: 'new-code' })
  assert.equal(bad.code, -1)

  const changed = await call({ action: 'updateOrganization', org_id: 'org_b', org_name: '乙厂', factory_code: 'yb02' })
  assert.equal(changed.code, 0)
  assert.equal(changed.data.factory_code_changed, true)
  assert.equal(changed.data.factory_code, 'YB02')
})

test('createFactoryAdmin：手机号/密码校验，已停用的同名账号提示去恢复', async () => {
  const { fake, call } = setup({ Users: [boss('b0009', { name: '王五', phone: '13900000009', status: 'disabled' })] })
  assert.match((await call({ action: 'createFactoryAdmin', org_id: 'org_a', name: '张三', phone: '123' })).msg, /手机号/)
  assert.match((await call({ action: 'createFactoryAdmin', org_id: 'org_a', name: '张三', phone: '13800001111', password: '123456' })).msg, /至少 8 位/)
  assert.match((await call({ action: 'createFactoryAdmin', org_id: 'org_a', name: '王五', phone: '13900000009' })).msg, /恢复/)
  assert.equal((await call({ action: 'createFactoryAdmin', org_id: 'org_c', name: '张三', phone: '13800001111' })).code, -1, '停用工厂不能加老板')

  const ok = await call({ action: 'createFactoryAdmin', org_id: 'org_a', name: '张三', phone: '13800001111' })
  assert.equal(ok.code, 0, ok.msg)
  const created = fake.get('Users', ok.data.user_id)
  assert.equal(created.role, 'boss')
  assert.equal(created.must_change_password, true)
})

test('自家工厂（org_home）的工厂码不能改，名字可以改', async () => {
  const { fake, call } = setup({ Organizations: [{ _id: 'org_home', org_name: '飞盛', factory_code: 'A001', status: 'active', billing_status: 'permanent', plan_id: 'standard_year', subscription_id: 'sub_org_home_permanent', created_at: new Date() }] })
  const res = await call({ action: 'updateOrganization', org_id: 'org_home', org_name: '飞盛', factory_code: 'B001' })
  assert.equal(res.code, -1)
  assert.match(res.msg, /不能改/)
  assert.equal(fake.get('Organizations', 'org_home').factory_code, 'A001')
  assert.equal((await call({ action: 'updateOrganization', org_id: 'org_home', org_name: '飞盛服饰', factory_code: 'a001' })).code, 0)
})

test('getOrganizationDetail：新环境还没有 BillingOrders 集合时按「没有记录」处理', async () => {
  const { call } = setup()
  const res = await call({ action: 'getOrganizationDetail', org_id: 'org_a' })
  assert.equal(res.code, 0, res.msg)
  assert.deepEqual(res.data.billing_orders, [])
})

test('停用平台组织/永久工厂被拒；停用普通工厂返回最新视图', async () => {
  const { fake, call } = setup()
  assert.equal((await call({ action: 'disableOrganization', org_id: 'org_platform' })).code, -1)
  const res = await call({ action: 'disableOrganization', org_id: 'org_a' })
  assert.equal(res.code, 0)
  assert.equal(res.data.bucket, 'disabled')
  assert.equal(fake.get('Organizations', 'org_a').status, 'disabled')
  assert.equal((await call({ action: 'disableOrganization', org_id: 'nope' })).code, -1)
})
