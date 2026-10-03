// 平台工厂详情：续费弹层、老板账号、编辑资料的表单与预览（纯函数，不碰 wx）
const orgBilling = require('../../../utils/org-billing.logic')

const STANDARD_DURATIONS = [
  { value: 6, label: '半年' },
  { value: 12, label: '1 年' },
  { value: 24, label: '2 年' },
  { value: 36, label: '3 年' }
]

const TRIAL_DURATIONS = [
  { value: 7, label: '7 天' },
  { value: 15, label: '15 天' },
  { value: 30, label: '30 天' }
]

function isTrialPlan(plan) {
  return !!plan && (plan.plan_id === 'trial' || plan.billing_period === 'trial')
}

function findPlan(plans, planId) {
  return (plans || []).find(item => item.plan_id === planId) || null
}

// 金额默认值 = 年价 × 月数 / 12（保留两位小数，去掉多余的 0）
function defaultAmountYuan(plan, months) {
  if (!plan || isTrialPlan(plan)) return '0'
  const yearly = Number(plan.price_yuan || 0)
  const amount = Math.round(yearly * months / 12 * 100) / 100
  return String(amount)
}

// 打开续费弹层时的默认选择：没开通过 → 试用 7 天；其余 → 标准版 1 年
function defaultRenewSelection(org, plans) {
  const trial = (plans || []).find(isTrialPlan)
  const standard = (plans || []).find(plan => !isTrialPlan(plan))
  const useTrial = !!trial && !!org && org.billing_status !== 'trial' && org.can_open_trial
  const plan = useTrial ? trial : (standard || trial)
  if (!plan) return null
  const trialPlan = isTrialPlan(plan)
  const duration = trialPlan ? Number(plan.trial_days || 7) : 12
  return {
    planId: plan.plan_id,
    duration,
    amount: trialPlan ? '0' : defaultAmountYuan(plan, duration)
  }
}

function buildRenewView(org, plans, selection, nowTs) {
  const plan = findPlan(plans, selection && selection.planId)
  const trialPlan = isTrialPlan(plan)
  const options = trialPlan ? TRIAL_DURATIONS : STANDARD_DURATIONS
  const duration = selection ? Number(selection.duration) : 0

  const planTabs = (plans || []).map(item => ({
    plan_id: item.plan_id,
    label: item.plan_name,
    active: !!plan && item.plan_id === plan.plan_id
  }))
  const durationOptions = options.map(item => ({
    value: item.value,
    label: item.label,
    active: item.value === duration
  }))

  const windowResult = orgBilling.planSubscriptionWindow({
    org,
    plan,
    periodMonths: trialPlan ? undefined : duration,
    trialDays: trialPlan ? duration : undefined,
    nowTs
  })
  const amount = orgBilling.parseAmountYuan(selection ? selection.amount : '')

  let error = ''
  if (!windowResult.ok) error = windowResult.msg
  else if (!amount.ok) error = amount.msg

  return {
    planTabs,
    durationOptions,
    isTrial: trialPlan,
    preview: windowResult.ok ? {
      currentEndText: windowResult.current_end_text,
      endText: windowResult.end_at_text,
      graceText: windowResult.grace_until_text,
      periodText: windowResult.period_text,
      extendsCurrent: windowResult.extends_current
    } : null,
    error,
    canSubmit: !error,
    submitText: error
      ? '暂不能提交'
      : (trialPlan ? '开通试用 ' : '确认已收款，续 ') + windowResult.period_text
  }
}

function formatAmountText(amountYuan) {
  const parsed = orgBilling.parseAmountYuan(amountYuan)
  if (!parsed.ok) return ''
  return '¥' + (parsed.cents / 100)
}

function buildRenewConfirmContent(org, plan, view, amountYuan) {
  if (!view || !view.preview) return ''
  const lines = [
    (org.org_name || '') + '：' + (plan ? plan.plan_name : '') + ' ' + view.preview.periodText,
    view.preview.currentEndText && view.preview.extendsCurrent
      ? '到期日 ' + view.preview.currentEndText + ' → ' + view.preview.endText
      : '到期日 ' + view.preview.endText,
    '收款 ' + formatAmountText(amountYuan)
  ]
  return lines.join('\n')
}

function trimText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

// 初始密码一律是手机号：login 在「没改过密码」时本来就接受手机号，自设初始密码起不到保护作用，
// 不再提供这个输入，免得让人误以为有保护。老板首次登录会被强制改密码。
function validateAdminForm(form) {
  const name = trimText(form && form.name)
  if (!name) return { ok: false, msg: '请填写姓名' }
  const phoneCheck = orgBilling.validateMobile(trimText(form && form.phone))
  if (!phoneCheck.ok) return { ok: false, msg: phoneCheck.msg }
  return { ok: true, data: { name, phone: phoneCheck.phone } }
}

function validateOrgForm(form, originalCode) {
  const orgName = trimText(form && form.org_name)
  if (!orgName) return { ok: false, msg: '请填写工厂名称' }
  const code = orgBilling.normalizeFactoryCode(form && form.factory_code)
  // 只是大小写不同不算改码；保存时统一大写（登录把输入转大写匹配）
  const codeChanged = !originalCode || code !== orgBilling.normalizeFactoryCode(originalCode)
  if (codeChanged) {
    const codeCheck = orgBilling.validateFactoryCode(code)
    if (!codeCheck.ok) return { ok: false, msg: codeCheck.msg }
  }
  return {
    ok: true,
    codeChanged: !!originalCode && codeChanged,
    data: {
      org_name: orgName,
      factory_code: code,
      contact_name: trimText(form && form.contact_name),
      contact_phone: trimText(form && form.contact_phone)
    }
  }
}

// 主按钮文案：永久 / 停用 / 未开通 / 续费
function buildSubscriptionAction(org) {
  if (!org) return { text: '续费', disabled: true, hint: '' }
  if (org.status === 'disabled') return { text: '工厂已停用', disabled: true, hint: '先启用工厂才能开通或续费' }
  if (org.billing_status === 'permanent') return { text: '永久免费，无需续费', disabled: true, hint: '' }
  if (!org.billing_status || org.billing_status === 'not_enabled') return { text: '开通订阅', disabled: false, hint: '' }
  return { text: '续费', disabled: false, hint: '' }
}

// 给老板发登录方式（复制到剪贴板）
function buildLoginInfoText(org, admin) {
  return [
    '飞盛小程序登录方式',
    '工厂码：' + ((org && org.factory_code) || ''),
    '姓名：' + ((admin && admin.name) || ''),
    '手机号：' + ((admin && admin.phone) || ''),
    admin && admin.must_change_password
      ? '首次登录密码是手机号，登录后按提示修改'
      : '密码：用你自己改过的密码'
  ].join('\n')
}

// 一次续费弹层一个编号：网络重试、失败后再点确认都带同一个，服务端据此去重
function createRequestId(nowTs, randomPart) {
  const rand = String(randomPart || '').replace(/[^A-Za-z0-9]/g, '').slice(0, 12) || '0'
  return 'rq_' + Number(nowTs || 0).toString(36) + '_' + rand
}

module.exports = {
  STANDARD_DURATIONS,
  TRIAL_DURATIONS,
  isTrialPlan,
  findPlan,
  defaultAmountYuan,
  defaultRenewSelection,
  buildRenewView,
  buildRenewConfirmContent,
  validateAdminForm,
  validateOrgForm,
  buildSubscriptionAction,
  buildLoginInfoText,
  createRequestId
}
