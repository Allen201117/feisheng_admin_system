// 工厂订阅口径唯一真源（纯函数，不碰 wx / db）。
// 云函数按目录独立部署、无法跨目录 require，同 auth-guard.js / beijing-time.js 模式：
// 本文件在 billing/、platform/、miniprogram/utils/ 各有一份字节相同的副本，
// 改动必须同步全部副本，tests/org-billing.logic.test.js 会校验一致性。
//
// 口径：
//   - 订阅状态（deriveBillingStatus）：billing 老板端订阅页与平台管理页同一套判断。
//   - 平台列表只分三类（getOrgBucket）：停用 / 试用中 / 正常；到期信息单独一行文字（buildExpiryInfo）。
//   - 开通/续费的日期（planSubscriptionWindow）：从「当前到期日（未过期时）」往后顺延，
//     宽限期 = 到期后 graceDays 天。已开过正式套餐的工厂禁止改回试用（试用版有员工上限）。

const DAY_MS = 24 * 60 * 60 * 1000
const BEIJING_OFFSET_MS = 8 * 60 * 60 * 1000

const PLATFORM_ORG_ID = 'org_platform'
const DEFAULT_GRACE_DAYS = 7
const MAX_PERIOD_MONTHS = 120
const MAX_TRIAL_DAYS = 30
const EXPIRY_WARN_DAYS = 30

// 老板端订阅页沿用的状态文案（billing.getMySubscription 返回给老板看）
const BILLING_STATUS_LABELS = {
  not_enabled: '未启用订阅',
  trial: '试用中',
  active: '正常使用中',
  permanent: '永久免费',
  grace: '宽限期内',
  expired: '已到期',
  disabled: '已停用',
  unknown: '未知'
}

const ORG_BUCKET_LABELS = {
  normal: '正常',
  trial: '试用中',
  disabled: '停用'
}

const PAYMENT_CHANNEL_LABELS = {
  manual_wechat: '微信收款',
  manual_alipay: '支付宝收款',
  manual_bank: '银行转账',
  manual_cash: '现金',
  gift: '平台赠送'
}

const PAYMENT_STATUS_LABELS = {
  paid: '已收款',
  pending: '未完成'
}

// 已开过正式套餐（或永久）的工厂，原始 billing_status 会是这些值之一
const TRIAL_ALLOWED_RAW_STATUS = ['not_enabled', 'trial', '']

const FACTORY_CODE_RE = /^[A-Z0-9]{2,12}$/
const MOBILE_RE = /^1[3-9]\d{9}$/

function toTimestamp(input) {
  if (!input) return 0
  if (input instanceof Date) {
    const t = input.getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (typeof input === 'number') return Number.isFinite(input) ? input : 0
  if (typeof input === 'string') {
    const t = new Date(input).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (input.$date) {
    const t = new Date(input.$date).getTime()
    return Number.isNaN(t) ? 0 : t
  }
  if (input.seconds) {
    return Number(input.seconds) * 1000 + Math.floor((Number(input.nanoseconds) || 0) / 1000000)
  }
  return 0
}

function pad2(n) {
  return String(n).padStart(2, '0')
}

// 北京时间 YYYY-MM-DD；无效输入返回 ''
function formatBeijingDate(input) {
  const ts = toTimestamp(input)
  if (!ts) return ''
  const d = new Date(ts + BEIJING_OFFSET_MS)
  return d.getUTCFullYear() + '-' + pad2(d.getUTCMonth() + 1) + '-' + pad2(d.getUTCDate())
}

// 北京时间的「第几天」序号，用来算自然日差
function beijingDayIndex(ts) {
  return Math.floor((ts + BEIJING_OFFSET_MS) / DAY_MS)
}

function addDays(date, days) {
  return new Date(date.getTime() + days * DAY_MS)
}

function addMonths(date, months) {
  const d = new Date(date.getTime())
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

function getOrgEndTs(org) {
  return toTimestamp(org && (org.current_period_end || org.trial_end))
}

function deriveBillingStatus(org, nowTs) {
  if (!org) return 'unknown'
  if (org.status === 'disabled' || org.billing_status === 'disabled') return 'disabled'

  const rawStatus = org.billing_status || 'not_enabled'
  if (rawStatus === 'not_enabled') return 'not_enabled'
  if (rawStatus === 'permanent') return 'permanent'

  const now = typeof nowTs === 'number' ? nowTs : Date.now()
  const endTs = getOrgEndTs(org)
  const graceTs = toTimestamp(org.grace_until)

  if ((rawStatus === 'trial' || rawStatus === 'active') && endTs && now > endTs) {
    if (graceTs && now <= graceTs) return 'grace'
    return 'expired'
  }

  if (rawStatus === 'grace' && graceTs && now > graceTs) return 'expired'
  return rawStatus
}

function getBillingStatusLabel(status) {
  return BILLING_STATUS_LABELS[status] || status
}

// 平台列表三分类：停用 / 试用中 / 正常（老板确认 2026-10-03，总览不再细分到期/宽限）
function getOrgBucket(org) {
  if (!org) return 'normal'
  if (org.status === 'disabled' || org.billing_status === 'disabled') return 'disabled'
  if (org.billing_status === 'trial') return 'trial'
  return 'normal'
}

// 每家工厂一行到期说明。tone: ok 正常 / warn 30 天内到期 / over 已过期 / muted 无到期概念
function buildExpiryInfo(org, nowTs) {
  const now = typeof nowTs === 'number' ? nowTs : Date.now()
  const bucket = getOrgBucket(org)
  const rawStatus = (org && org.billing_status) || 'not_enabled'
  const endTs = getOrgEndTs(org)
  const graceTs = toTimestamp(org && org.grace_until)

  if (bucket === 'disabled') {
    // 工厂停用 = 全厂登录被拒（auth-guard 校验 Organizations.status）；只停订阅时登录还在，只是不能新增
    const text = org.status === 'disabled' ? '全厂无法登录' : '订阅已停用'
    return { tone: 'muted', text, days_remaining: null, end_date_text: formatBeijingDate(endTs) }
  }
  if (rawStatus === 'permanent') {
    return { tone: 'muted', text: '永久免费', days_remaining: null, end_date_text: '' }
  }
  if (rawStatus === 'not_enabled') {
    return { tone: 'muted', text: '未开通订阅', days_remaining: null, end_date_text: '' }
  }
  if (!endTs) {
    return { tone: 'muted', text: '未设置到期日', days_remaining: null, end_date_text: '' }
  }

  const endDateText = formatBeijingDate(endTs)
  const dayDiff = beijingDayIndex(endTs) - beijingDayIndex(now)

  if (now > endTs) {
    const overdue = Math.max(0, -dayDiff)
    const inGrace = graceTs && now <= graceTs
    const base = overdue === 0 ? '今天已到期' : '已过期 ' + overdue + ' 天'
    return {
      tone: 'over',
      text: inGrace ? base + '，宽限中' : base,
      days_remaining: -overdue,
      end_date_text: endDateText
    }
  }

  const prefix = rawStatus === 'trial' ? '试用剩 ' : '剩 '
  if (dayDiff <= 0) {
    return { tone: 'warn', text: rawStatus === 'trial' ? '试用今天到期' : '今天到期', days_remaining: 0, end_date_text: endDateText }
  }
  if (dayDiff <= EXPIRY_WARN_DAYS) {
    return { tone: 'warn', text: prefix + dayDiff + ' 天', days_remaining: dayDiff, end_date_text: endDateText }
  }
  return { tone: 'ok', text: endDateText + ' 到期', days_remaining: dayDiff, end_date_text: endDateText }
}

function getPlanDisplayName(org, plans) {
  if (!org || !org.plan_id) return '未开通'
  const plan = (plans || []).find(item => item.plan_id === org.plan_id)
  const name = plan ? plan.plan_name : (org.plan_id === 'trial' ? '试用版' : org.plan_id === 'standard_year' ? '标准版年付' : org.plan_id)
  return org.billing_status === 'permanent' ? name + '（永久免费）' : name
}

// 平台管理页每家工厂的展示视图。保留原始字段（旧版前端仍自己推导状态），只追加字段。
function buildOrgView(org, nowTs, plans) {
  const now = typeof nowTs === 'number' ? nowTs : Date.now()
  const status = deriveBillingStatus(org, now)
  const bucket = getOrgBucket(org)
  const expiry = buildExpiryInfo(org, now)
  return Object.assign({}, org, {
    bucket,
    bucket_label: ORG_BUCKET_LABELS[bucket],
    billing_status_view: status,
    billing_status_label: getBillingStatusLabel(status),
    plan_name_view: getPlanDisplayName(org, plans),
    expiry_tone: expiry.tone,
    expiry_text: expiry.text,
    days_remaining: expiry.days_remaining,
    end_date_text: expiry.end_date_text,
    grace_until_text: status === 'permanent' ? '' : formatBeijingDate(org && org.grace_until),
    created_date_text: formatBeijingDate(org && org.created_at),
    can_open_trial: TRIAL_ALLOWED_RAW_STATUS.includes((org && org.billing_status) || '')
  })
}

function summarizeOrgBuckets(orgs) {
  const summary = { total: 0, normal: 0, trial: 0, disabled: 0 }
  for (const org of orgs || []) {
    summary.total += 1
    summary[getOrgBucket(org)] += 1
  }
  return summary
}

function isPlatformOrg(org) {
  return !!org && (org._id === PLATFORM_ORG_ID || org.platform_role === 'platform_admin')
}

function toPositiveInt(value) {
  if (typeof value === 'number') return Number.isInteger(value) ? value : NaN
  const text = typeof value === 'string' ? value.trim() : ''
  if (!/^\d+$/.test(text)) return NaN
  return parseInt(text, 10)
}

// 开通/续费的到期日推算（云函数落库与前端预览同一份）。
// input: { org, plan, periodMonths, trialDays, graceDays, nowTs }
// 返回 { ok:true, is_trial, start_at, end_at, grace_until, period_months, trial_days, grace_days } 或 { ok:false, msg }
function planSubscriptionWindow(input) {
  const org = input && input.org
  const plan = input && input.plan
  if (!org) return { ok: false, msg: '工厂不存在' }
  if (!plan) return { ok: false, msg: '套餐不存在' }
  if (isPlatformOrg(org)) return { ok: false, msg: '平台组织不需要开通订阅' }
  if (org.status === 'disabled') return { ok: false, msg: '工厂已停用，请先启用再开通' }
  if (org.billing_status === 'permanent') return { ok: false, msg: '该工厂已是永久免费，无需开通' }

  const isTrial = plan.plan_id === 'trial' || plan.billing_period === 'trial'
  const rawStatus = org.billing_status || ''
  if (isTrial && !TRIAL_ALLOWED_RAW_STATUS.includes(rawStatus)) {
    return { ok: false, msg: '该工厂已开通过正式套餐，不能改回试用（试用版有员工人数上限）。要延期请选标准版' }
  }

  let periodMonths = 0
  let trialDays = 0
  if (isTrial) {
    const requested = input.trialDays === undefined || input.trialDays === null || input.trialDays === ''
      ? toPositiveInt(plan.trial_days || 7)
      : toPositiveInt(input.trialDays)
    if (!(requested >= 1 && requested <= MAX_TRIAL_DAYS)) {
      return { ok: false, msg: '试用天数要在 1 到 ' + MAX_TRIAL_DAYS + ' 天之间' }
    }
    trialDays = requested
  } else {
    const requested = input.periodMonths === undefined || input.periodMonths === null || input.periodMonths === ''
      ? toPositiveInt(plan.period_months || 12)
      : toPositiveInt(input.periodMonths)
    if (!(requested >= 1 && requested <= MAX_PERIOD_MONTHS)) {
      return { ok: false, msg: '开通月数要在 1 到 ' + MAX_PERIOD_MONTHS + ' 个月之间' }
    }
    periodMonths = requested
  }

  const graceInput = input.graceDays === undefined || input.graceDays === null ? DEFAULT_GRACE_DAYS : toPositiveInt(input.graceDays)
  const graceDays = graceInput >= 0 && graceInput <= 90 ? graceInput : DEFAULT_GRACE_DAYS

  const now = typeof input.nowTs === 'number' ? input.nowTs : Date.now()
  const currentEndTs = getOrgEndTs(org)
  const startAt = new Date(currentEndTs && currentEndTs > now ? currentEndTs : now)
  const endAt = isTrial ? addDays(startAt, trialDays) : addMonths(startAt, periodMonths)
  const graceUntil = addDays(endAt, graceDays)

  return {
    ok: true,
    is_trial: isTrial,
    start_at: startAt,
    end_at: endAt,
    grace_until: graceUntil,
    period_months: periodMonths,
    trial_days: trialDays,
    grace_days: graceDays,
    extends_current: !!(currentEndTs && currentEndTs > now),
    current_end_text: currentEndTs ? formatBeijingDate(currentEndTs) : '',
    end_at_text: formatBeijingDate(endAt),
    grace_until_text: formatBeijingDate(graceUntil),
    period_text: isTrial ? trialDays + ' 天' : formatPeriodMonths(periodMonths)
  }
}

function formatPeriodMonths(months) {
  if (months % 12 === 0) return (months / 12) + ' 年'
  return months + ' 个月'
}

// 收款金额（元）→ 分。空串按 0；负数、非数字、超过 100 万一律拒绝，不再静默当 0。
function parseAmountYuan(value) {
  if (value === undefined || value === null || value === '') return { ok: true, cents: 0 }
  const text = typeof value === 'number' ? String(value) : String(value).trim()
  if (!/^\d+(\.\d{1,2})?$/.test(text)) return { ok: false, msg: '收款金额格式不对，最多两位小数' }
  const cents = Math.round(Number(text) * 100)
  if (!Number.isFinite(cents) || cents < 0 || cents > 100000000) return { ok: false, msg: '收款金额超出范围' }
  return { ok: true, cents }
}

function normalizeFactoryCode(value) {
  return typeof value === 'string' ? value.trim().toUpperCase() : ''
}

function validateFactoryCode(value) {
  const code = normalizeFactoryCode(value)
  if (!code) return { ok: false, msg: '请填写工厂码' }
  if (!FACTORY_CODE_RE.test(code)) return { ok: false, msg: '工厂码只能用字母和数字，2 到 12 位' }
  return { ok: true, code }
}

function validateMobile(value) {
  const phone = typeof value === 'string' ? value.trim() : ''
  if (!phone) return { ok: false, msg: '请填写手机号' }
  if (!MOBILE_RE.test(phone)) return { ok: false, msg: '手机号格式不对，需要 11 位手机号' }
  return { ok: true, phone }
}

function decorateBillingOrder(order) {
  const item = order || {}
  let periodText = ''
  if (item.trial_days) periodText = item.trial_days + ' 天'
  else if (item.period_months) periodText = formatPeriodMonths(item.period_months)
  return Object.assign({}, item, {
    amount_yuan: Number(item.amount_cents || 0) / 100,
    paid_at_text: formatBeijingDate(item.paid_at || item.created_at),
    period_text: periodText,
    payment_channel_label: PAYMENT_CHANNEL_LABELS[item.payment_channel] || item.payment_channel || '',
    payment_status_label: PAYMENT_STATUS_LABELS[item.payment_status] || item.payment_status || ''
  })
}

// 开通请求幂等：同一 request_id 的收款记录已存在时怎么处理
//   none   → 新建流程
//   done   → 已完整生效，直接返回原结果（网络重试/重复点击）
//   resume → 上次写到一半（收款记录建了但订阅/工厂没更新完），按记录里冻结的日期补完，不重新推算
function decideOpenSubscriptionReplay(existingOrder) {
  if (!existingOrder) return 'none'
  if (existingOrder.payment_status === 'paid' && existingOrder.applied !== false) return 'done'
  return 'resume'
}

const REQUEST_ID_RE = /^[A-Za-z0-9_-]{8,64}$/

function isValidRequestId(value) {
  return typeof value === 'string' && REQUEST_ID_RE.test(value)
}

// 同一个 request_id 只能对应同一份提交内容：网络重试原样重发 → 指纹相同；
// 弹层失败后改了套餐/时长/金额再提交 → 指纹不同，必须拒绝（否则会悄悄按旧内容生效）
function buildOpenRequestFingerprint(input) {
  const norm = value => (value === undefined || value === null ? '' : String(value).trim())
  return [norm(input.plan_id), norm(input.period_months), norm(input.trial_days), norm(input.amount_cents)].join('|')
}

function isKnownPaymentChannel(value) {
  return Object.prototype.hasOwnProperty.call(PAYMENT_CHANNEL_LABELS, value)
}

// 补完一笔没写完的开通前的保护：只有工厂在这笔开通之后没被别的操作改过，才按冻结日期补写
function checkResumableOrder(org, order) {
  if (!org || !order) return { ok: false, msg: '工厂或开通记录不存在' }
  if (org.status !== 'active') return { ok: false, msg: '工厂已停用，这笔开通暂未生效，请先启用工厂再重试' }
  if (org.billing_status === 'permanent') return { ok: false, msg: '工厂已是永久免费，这笔开通不再生效，请联系开发核对收款' }
  if (org.subscription_id === order.subscription_id) return { ok: true }
  // 下单时新周期从「当时的到期日」或「当时」开始；工厂到期日如果已经晚于这个起点，说明之后被别的操作改过
  const orgEndTs = getOrgEndTs(org)
  if (orgEndTs > toTimestamp(order.start_at)) {
    return { ok: false, msg: '这笔开通上次没完成，之后工厂订阅又被改过，系统不自动覆盖，请联系开发核对' }
  }
  return { ok: true }
}

module.exports = {
  DAY_MS,
  PLATFORM_ORG_ID,
  DEFAULT_GRACE_DAYS,
  MAX_PERIOD_MONTHS,
  MAX_TRIAL_DAYS,
  EXPIRY_WARN_DAYS,
  BILLING_STATUS_LABELS,
  ORG_BUCKET_LABELS,
  PAYMENT_CHANNEL_LABELS,
  PAYMENT_STATUS_LABELS,
  toTimestamp,
  formatBeijingDate,
  addDays,
  addMonths,
  deriveBillingStatus,
  getBillingStatusLabel,
  getOrgBucket,
  buildExpiryInfo,
  getPlanDisplayName,
  buildOrgView,
  summarizeOrgBuckets,
  isPlatformOrg,
  planSubscriptionWindow,
  formatPeriodMonths,
  parseAmountYuan,
  normalizeFactoryCode,
  validateFactoryCode,
  validateMobile,
  decorateBillingOrder,
  decideOpenSubscriptionReplay,
  isValidRequestId,
  buildOpenRequestFingerprint,
  isKnownPaymentChannel,
  checkResumableOrder
}
