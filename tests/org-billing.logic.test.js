const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')

const logic = require('../cloudfunctions/common/org-billing.logic')

const ROOT = path.join(__dirname, '..')
const COPIES = [
  'cloudfunctions/billing/org-billing.logic.js',
  'cloudfunctions/platform/org-billing.logic.js',
  'miniprogram/utils/org-billing.logic.js'
]

// 北京时间 2026-10-03 12:00
const NOW = Date.UTC(2026, 9, 3, 4, 0, 0)
// 北京时间某天 00:00 对应的 UTC 时间戳
function bj(y, m, d, h) {
  return Date.UTC(y, m - 1, d, (h || 0) - 8, 0, 0)
}

const STANDARD = { plan_id: 'standard_year', plan_name: '标准版年付', billing_period: 'year', period_months: 12 }
const TRIAL = { plan_id: 'trial', plan_name: '试用版', billing_period: 'trial', trial_days: 7 }

test('org-billing.logic 各副本与 common 真源字节一致', () => {
  const canonical = fs.readFileSync(path.join(ROOT, 'cloudfunctions/common/org-billing.logic.js'), 'utf8')
  for (const copy of COPIES) {
    const full = path.join(ROOT, copy)
    assert.ok(fs.existsSync(full), `${copy} 缺失`)
    assert.equal(fs.readFileSync(full, 'utf8'), canonical, `${copy} 与 common/org-billing.logic.js 不一致`)
  }
})

test('deriveBillingStatus 覆盖停用/未开通/永久/到期/宽限', () => {
  const end = new Date(bj(2026, 10, 1))
  assert.equal(logic.deriveBillingStatus(null, NOW), 'unknown')
  assert.equal(logic.deriveBillingStatus({ status: 'disabled', billing_status: 'active' }, NOW), 'disabled')
  assert.equal(logic.deriveBillingStatus({ status: 'active' }, NOW), 'not_enabled')
  assert.equal(logic.deriveBillingStatus({ status: 'active', billing_status: 'permanent' }, NOW), 'permanent')
  assert.equal(logic.deriveBillingStatus({ status: 'active', billing_status: 'active', current_period_end: new Date(bj(2027, 1, 1)) }, NOW), 'active')
  assert.equal(logic.deriveBillingStatus({ status: 'active', billing_status: 'active', current_period_end: end, grace_until: new Date(bj(2026, 10, 8)) }, NOW), 'grace')
  assert.equal(logic.deriveBillingStatus({ status: 'active', billing_status: 'active', current_period_end: end, grace_until: new Date(bj(2026, 10, 2)) }, NOW), 'expired')
  assert.equal(logic.deriveBillingStatus({ status: 'active', billing_status: 'trial', trial_end: end }, NOW), 'expired')
})

test('getOrgBucket 只分 正常/试用中/停用 三类', () => {
  assert.equal(logic.getOrgBucket({ status: 'disabled', billing_status: 'trial' }), 'disabled')
  assert.equal(logic.getOrgBucket({ status: 'active', billing_status: 'disabled' }), 'disabled')
  assert.equal(logic.getOrgBucket({ status: 'active', billing_status: 'trial' }), 'trial')
  // 过期试用仍归「试用中」，到期由行内文字提示
  assert.equal(logic.getOrgBucket({ status: 'active', billing_status: 'trial', trial_end: new Date(bj(2026, 9, 1)) }), 'trial')
  for (const raw of [undefined, 'not_enabled', 'active', 'permanent', 'grace']) {
    assert.equal(logic.getOrgBucket({ status: 'active', billing_status: raw }), 'normal', String(raw))
  }
  assert.deepEqual(
    logic.summarizeOrgBuckets([
      { status: 'active', billing_status: 'active' },
      { status: 'active', billing_status: 'trial' },
      { status: 'disabled' },
      { status: 'active' }
    ]),
    { total: 4, normal: 2, trial: 1, disabled: 1 }
  )
})

test('buildExpiryInfo 到期文字：过期/今天/30 天内/远期/无到期', () => {
  const active = (endTs, extra) => Object.assign({ status: 'active', billing_status: 'active', current_period_end: new Date(endTs) }, extra)

  assert.deepEqual(
    pick(logic.buildExpiryInfo(active(bj(2026, 9, 30)), NOW)),
    { tone: 'over', text: '已过期 3 天', days_remaining: -3 }
  )
  assert.deepEqual(
    pick(logic.buildExpiryInfo(active(bj(2026, 9, 30), { grace_until: new Date(bj(2026, 10, 7)) }), NOW)),
    { tone: 'over', text: '已过期 3 天，宽限中', days_remaining: -3 }
  )
  // 今天 00:00 已过 → 今天已到期
  assert.equal(logic.buildExpiryInfo(active(bj(2026, 10, 3)), NOW).text, '今天已到期')
  // 今天 23:00 还没到
  assert.equal(logic.buildExpiryInfo(active(bj(2026, 10, 3, 23)), NOW).text, '今天到期')
  assert.deepEqual(pick(logic.buildExpiryInfo(active(bj(2026, 10, 24)), NOW)), { tone: 'warn', text: '剩 21 天', days_remaining: 21 })
  assert.deepEqual(
    pick(logic.buildExpiryInfo({ status: 'active', billing_status: 'trial', trial_end: new Date(bj(2026, 10, 7)) }, NOW)),
    { tone: 'warn', text: '试用剩 4 天', days_remaining: 4 }
  )
  // 第 30 天仍提醒，第 31 天显示日期
  assert.equal(logic.buildExpiryInfo(active(bj(2026, 11, 2)), NOW).text, '剩 30 天')
  assert.deepEqual(pick(logic.buildExpiryInfo(active(bj(2027, 3, 18)), NOW)), { tone: 'ok', text: '2027-03-18 到期', days_remaining: 166 })

  assert.equal(logic.buildExpiryInfo({ status: 'active', billing_status: 'permanent' }, NOW).text, '永久免费')
  assert.equal(logic.buildExpiryInfo({ status: 'active' }, NOW).text, '未开通订阅')
  assert.equal(logic.buildExpiryInfo({ status: 'disabled', billing_status: 'active' }, NOW).text, '全厂无法登录')
  assert.equal(logic.buildExpiryInfo({ status: 'active', billing_status: 'disabled' }, NOW).text, '订阅已停用')
  assert.equal(logic.buildExpiryInfo({ status: 'active', billing_status: 'active' }, NOW).text, '未设置到期日')
})

function pick(info) {
  return { tone: info.tone, text: info.text, days_remaining: info.days_remaining }
}

test('buildOrgView 只追加字段、保留原始字段（旧版前端兼容）', () => {
  const org = { _id: 'o1', org_name: '甲厂', factory_code: 'JC01', status: 'active', billing_status: 'trial', plan_id: 'trial', trial_end: new Date(bj(2026, 10, 7)), created_at: new Date(bj(2026, 9, 1)) }
  const view = logic.buildOrgView(org, NOW, [TRIAL, STANDARD])
  for (const key of Object.keys(org)) assert.equal(view[key], org[key], key)
  assert.equal(view.bucket, 'trial')
  assert.equal(view.bucket_label, '试用中')
  assert.equal(view.plan_name_view, '试用版')
  assert.equal(view.expiry_text, '试用剩 4 天')
  assert.equal(view.created_date_text, '2026-09-01')
  assert.equal(view.can_open_trial, true)
  assert.equal(logic.buildOrgView({ status: 'active', billing_status: 'active', plan_id: 'standard_year' }, NOW).can_open_trial, false)
  assert.equal(logic.buildOrgView({ status: 'active', billing_status: 'permanent', plan_id: 'standard_year' }, NOW).plan_name_view, '标准版年付（永久免费）')
})

test('planSubscriptionWindow：未过期从当前到期日顺延，已过期从现在算', () => {
  const future = { _id: 'o1', status: 'active', billing_status: 'active', current_period_end: new Date(bj(2027, 3, 18)) }
  const r1 = logic.planSubscriptionWindow({ org: future, plan: STANDARD, periodMonths: 12, nowTs: NOW })
  assert.equal(r1.ok, true)
  assert.equal(r1.extends_current, true)
  assert.equal(r1.current_end_text, '2027-03-18')
  assert.equal(r1.end_at_text, '2028-03-18')
  assert.equal(r1.grace_until_text, '2028-03-25')
  assert.equal(r1.period_text, '1 年')

  const expired = { _id: 'o2', status: 'active', billing_status: 'active', current_period_end: new Date(bj(2026, 9, 1)) }
  const r2 = logic.planSubscriptionWindow({ org: expired, plan: STANDARD, periodMonths: '6', nowTs: NOW })
  assert.equal(r2.ok, true)
  assert.equal(r2.extends_current, false)
  assert.equal(r2.start_at.getTime(), NOW)
  assert.equal(r2.period_months, 6)
  assert.equal(r2.period_text, '6 个月')
})

test('planSubscriptionWindow：试用天数按填写值生效（以前被套餐默认 7 天覆盖）', () => {
  const fresh = { _id: 'o3', status: 'active', billing_status: 'not_enabled' }
  const r = logic.planSubscriptionWindow({ org: fresh, plan: TRIAL, trialDays: 15, nowTs: NOW })
  assert.equal(r.ok, true)
  assert.equal(r.trial_days, 15)
  assert.equal(r.end_at.getTime(), NOW + 15 * logic.DAY_MS)
  // 不填用套餐默认
  assert.equal(logic.planSubscriptionWindow({ org: fresh, plan: TRIAL, nowTs: NOW }).trial_days, 7)
  // 越界拒绝，不再静默改值
  assert.equal(logic.planSubscriptionWindow({ org: fresh, plan: TRIAL, trialDays: 31, nowTs: NOW }).ok, false)
  assert.equal(logic.planSubscriptionWindow({ org: fresh, plan: TRIAL, trialDays: '0', nowTs: NOW }).ok, false)
  assert.equal(logic.planSubscriptionWindow({ org: fresh, plan: TRIAL, trialDays: '7.5', nowTs: NOW }).ok, false)
})

test('planSubscriptionWindow：开过正式套餐的工厂不能改回试用', () => {
  for (const raw of ['active', 'grace', 'expired']) {
    const r = logic.planSubscriptionWindow({ org: { _id: 'o', status: 'active', billing_status: raw }, plan: TRIAL, trialDays: 7, nowTs: NOW })
    assert.equal(r.ok, false, raw)
    assert.match(r.msg, /不能改回试用/)
  }
  // 试用中的工厂续试用允许
  assert.equal(logic.planSubscriptionWindow({ org: { _id: 'o', status: 'active', billing_status: 'trial' }, plan: TRIAL, trialDays: 7, nowTs: NOW }).ok, true)
})

test('planSubscriptionWindow：拒绝非法月数、停用/永久/平台组织', () => {
  const org = { _id: 'o', status: 'active', billing_status: 'active' }
  for (const bad of [0, '0', 121, 'abc', '1.5', -1]) {
    assert.equal(logic.planSubscriptionWindow({ org, plan: STANDARD, periodMonths: bad, nowTs: NOW }).ok, false, String(bad))
  }
  assert.equal(logic.planSubscriptionWindow({ org, plan: STANDARD, periodMonths: 120, nowTs: NOW }).ok, true)
  assert.equal(logic.planSubscriptionWindow({ org: { _id: 'o', status: 'disabled' }, plan: STANDARD, nowTs: NOW }).ok, false)
  assert.equal(logic.planSubscriptionWindow({ org: { _id: 'o', status: 'active', billing_status: 'permanent' }, plan: STANDARD, nowTs: NOW }).ok, false)
  assert.equal(logic.planSubscriptionWindow({ org: { _id: 'org_platform', status: 'active' }, plan: STANDARD, nowTs: NOW }).ok, false)
  assert.equal(logic.planSubscriptionWindow({ org, plan: null, nowTs: NOW }).ok, false)
})

test('parseAmountYuan：负数/乱填拒绝，空按 0', () => {
  assert.deepEqual(logic.parseAmountYuan(''), { ok: true, cents: 0 })
  assert.deepEqual(logic.parseAmountYuan('1999'), { ok: true, cents: 199900 })
  assert.deepEqual(logic.parseAmountYuan(999.5), { ok: true, cents: 99950 })
  assert.deepEqual(logic.parseAmountYuan('0.01'), { ok: true, cents: 1 })
  for (const bad of ['-1', 'abc', '1.234', '1e3', '2000000']) {
    assert.equal(logic.parseAmountYuan(bad).ok, false, bad)
  }
})

test('validateFactoryCode / validateMobile', () => {
  assert.deepEqual(logic.validateFactoryCode(' hj01 '), { ok: true, code: 'HJ01' })
  assert.equal(logic.validateFactoryCode('PLATFORM').ok, true)
  for (const bad of ['', 'A', 'HJ-01', '华锦', 'ABCDEFGHIJKLM']) {
    assert.equal(logic.validateFactoryCode(bad).ok, false, bad)
  }
  assert.deepEqual(logic.validateMobile('13800001001'), { ok: true, phone: '13800001001' })
  for (const bad of ['', '1380000100', '23800001001', '138 0000 1001', '12800001001']) {
    assert.equal(logic.validateMobile(bad).ok, false, bad)
  }
})

test('decorateBillingOrder 把渠道/状态翻译成中文，补时长', () => {
  const view = logic.decorateBillingOrder({ amount_cents: 199900, payment_channel: 'manual_wechat', payment_status: 'paid', period_months: 24, paid_at: new Date(bj(2026, 3, 18, 10)) })
  assert.equal(view.amount_yuan, 1999)
  assert.equal(view.payment_channel_label, '微信收款')
  assert.equal(view.payment_status_label, '已收款')
  assert.equal(view.period_text, '2 年')
  assert.equal(view.paid_at_text, '2026-03-18')
  assert.equal(logic.decorateBillingOrder({ trial_days: 7, payment_status: 'pending' }).period_text, '7 天')
  assert.equal(logic.decorateBillingOrder({ payment_status: 'pending' }).payment_status_label, '未完成')
  // 老数据没有时长字段：不瞎编
  assert.equal(logic.decorateBillingOrder({ payment_channel: 'other_x' }).period_text, '')
  assert.equal(logic.decorateBillingOrder({ payment_channel: 'other_x' }).payment_channel_label, 'other_x')
})

test('decideOpenSubscriptionReplay：重试不重复续费', () => {
  assert.equal(logic.decideOpenSubscriptionReplay(null), 'none')
  assert.equal(logic.decideOpenSubscriptionReplay({ payment_status: 'paid', applied: true }), 'done')
  // 老记录没有 applied 字段，视为已生效
  assert.equal(logic.decideOpenSubscriptionReplay({ payment_status: 'paid' }), 'done')
  assert.equal(logic.decideOpenSubscriptionReplay({ payment_status: 'pending', applied: false }), 'resume')
  assert.equal(logic.isValidRequestId('req_abc12345'), true)
  for (const bad of ['', 'short', 'has space 123', 'x'.repeat(65), null]) {
    assert.equal(logic.isValidRequestId(bad), false, String(bad))
  }
})
