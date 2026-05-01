// 云函数 - billing（订阅状态、人工收款开通、套餐管理）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command

const BILLING_COLLECTIONS = ['Plans', 'Subscriptions', 'BillingOrders', 'UsageMonthly']
const PERMANENT_HOME_ORG_ID = 'org_home'
const PERMANENT_HOME_FACTORY_CODE = 'A001'
const ACTIVE_PLAN_IDS = ['trial', 'standard_year']
const DEPRECATED_PLAN_IDS = ['basic_year', 'pro_year']

const DEFAULT_PLANS = [
  {
    plan_id: 'trial',
    plan_name: '试用版',
    status: 'active',
    price_cents: 0,
    billing_period: 'trial',
    period_months: 0,
    trial_days: 7,
    employee_limit: 10,
    order_limit_per_month: 30,
    features: ['orders', 'worklogs', 'attendance']
  },
  {
    plan_id: 'standard_year',
    plan_name: '标准版年付',
    status: 'active',
    price_cents: 199900,
    billing_period: 'year',
    period_months: 12,
    employee_limit: 0,
    order_limit_per_month: 0,
    features: ['all']
  }
]

function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function toInt(value, fallback) {
  const n = parseInt(value, 10)
  return Number.isFinite(n) ? n : fallback
}

function toAmountCents(value) {
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return 0
  return Math.round(n * 100)
}

function toTimestamp(input) {
  if (!input) return 0
  if (input instanceof Date) return input.getTime()
  if (typeof input === 'number') return input
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

function addDays(date, days) {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000)
}

function addMonths(date, months) {
  const d = new Date(date.getTime())
  d.setUTCMonth(d.getUTCMonth() + months)
  return d
}

function formatDate(input) {
  const ts = toTimestamp(input)
  if (!ts) return ''
  const d = new Date(ts + 8 * 60 * 60 * 1000)
  return d.getUTCFullYear() + '-' +
    String(d.getUTCMonth() + 1).padStart(2, '0') + '-' +
    String(d.getUTCDate()).padStart(2, '0')
}

function daysUntil(input) {
  const ts = toTimestamp(input)
  if (!ts) return null
  const diff = ts - Date.now()
  return Math.ceil(diff / (24 * 60 * 60 * 1000))
}

function getPlanById(planId, plans) {
  return (plans || DEFAULT_PLANS).find(item => item.plan_id === planId) || DEFAULT_PLANS.find(item => item.plan_id === 'standard_year')
}

function decoratePlan(plan) {
  const amount = Number(plan.price_cents || 0) / 100
  return Object.assign({}, plan, {
    price_yuan: amount,
    price_label: amount > 0 ? amount.toFixed(0) + '元' : '免费'
  })
}

function deriveBillingStatus(org) {
  if (!org) return 'unknown'
  if (org.status === 'disabled' || org.billing_status === 'disabled') return 'disabled'

  const rawStatus = org.billing_status || 'not_enabled'
  if (rawStatus === 'not_enabled') return 'not_enabled'
  if (rawStatus === 'permanent') return 'permanent'

  const now = Date.now()
  const endTs = toTimestamp(org.current_period_end || org.trial_end)
  const graceTs = toTimestamp(org.grace_until)

  if ((rawStatus === 'trial' || rawStatus === 'active') && endTs && now > endTs) {
    if (graceTs && now <= graceTs) return 'grace'
    return 'expired'
  }

  if (rawStatus === 'grace' && graceTs && now > graceTs) return 'expired'
  return rawStatus
}

function getStatusLabel(status) {
  const map = {
    not_enabled: '未启用订阅',
    trial: '试用中',
    active: '正常使用中',
    permanent: '永久免费',
    grace: '宽限期内',
    expired: '已到期',
    disabled: '已停用',
    unknown: '未知'
  }
  return map[status] || status
}

function isCollectionAlreadyExistsError(err) {
  const text = String((err && (err.message || err.errMsg)) || '')
  return !!(err && (
    err.errCode === -502005 ||
    err.errCode === -501001 ||
    text.includes('already exists') ||
    text.includes('Table exist') ||
    text.includes('ResourceExist') ||
    text.includes('DATABASE_COLLECTION_ALREADY_EXIST')
  ))
}

async function safeCreateCollection(name) {
  try {
    await db.createCollection(name)
  } catch (err) {
    if (isCollectionAlreadyExistsError(err)) return
    throw err
  }
}

async function ensureBillingCollections() {
  for (const name of BILLING_COLLECTIONS) {
    await safeCreateCollection(name)
  }
}

async function seedPlans() {
  const results = []
  for (const plan of DEFAULT_PLANS) {
    const payload = Object.assign({}, plan, {
      updated_at: db.serverDate()
    })
    try {
      const existing = await db.collection('Plans').where({ plan_id: plan.plan_id }).limit(1).get()
      if (existing.data && existing.data.length) {
        await db.collection('Plans').doc(existing.data[0]._id).update({ data: payload })
        results.push({ plan_id: plan.plan_id, status: 'updated' })
      } else {
        await db.collection('Plans').add({
          data: Object.assign({}, payload, { created_at: db.serverDate() })
        })
        results.push({ plan_id: plan.plan_id, status: 'created' })
      }
    } catch (err) {
      results.push({ plan_id: plan.plan_id, status: 'failed', msg: err.message || '' })
    }
  }
  for (const planId of DEPRECATED_PLAN_IDS) {
    try {
      const existing = await db.collection('Plans').where({ plan_id: planId }).limit(1).get()
      if (existing.data && existing.data.length) {
        await db.collection('Plans').doc(existing.data[0]._id).update({
          data: { status: 'disabled', updated_at: db.serverDate() }
        })
        results.push({ plan_id: planId, status: 'disabled' })
      }
    } catch (err) {}
  }
  return results
}

async function getPlansFromDb() {
  try {
    const res = await db.collection('Plans').where({ status: 'active' }).limit(100).get()
    if (res.data && res.data.length) {
      const plans = res.data
        .filter(plan => ACTIVE_PLAN_IDS.includes(plan.plan_id))
        .sort((a, b) => ACTIVE_PLAN_IDS.indexOf(a.plan_id) - ACTIVE_PLAN_IDS.indexOf(b.plan_id))
      if (plans.length) return plans.map(decoratePlan)
    }
  } catch (err) {}
  return DEFAULT_PLANS.map(decoratePlan)
}

async function getCaller(event) {
  const userId = normalizeText(event && event.auth_user_id)
  const token = normalizeText(event && event.auth_session_token)
  if (!userId || !token) return null

  try {
    const res = await db.collection('Users').where({
      _id: userId,
      session_token: token,
      status: 'active'
    }).limit(1).get()
    const user = res.data && res.data[0]
    if (!user) return null

    if (user.org_id) {
      const orgRes = await db.collection('Organizations').doc(user.org_id).get()
      if (!orgRes.data || orgRes.data.status !== 'active') return null
      user._organization = orgRes.data
    }

    return user
  } catch (err) {
    return null
  }
}

async function requireBoss(event) {
  const caller = await getCaller(event)
  if (!caller || caller.role !== 'boss') {
    return { ok: false, response: { code: -1, msg: '权限不足，仅管理员可查看服务状态' } }
  }
  return { ok: true, caller }
}

async function requirePlatformAdmin(event) {
  const caller = await getCaller(event)
  if (!caller || caller.platform_role !== 'platform_admin') {
    return { ok: false, response: { code: -1, msg: '权限不足，仅平台管理员可操作' } }
  }
  return { ok: true, caller }
}

async function writePlatformLog(caller, actionType, targetOrgId, payloadSummary) {
  try {
    await db.collection('PlatformOperationLogs').add({
      data: {
        platform_operator_id: caller._id,
        platform_operator_name: caller.name || '',
        action_type: actionType,
        target_org_id: targetOrgId || '',
        payload_summary: payloadSummary || '',
        timestamp: db.serverDate()
      }
    })
  } catch (err) {}
}

async function upsertPermanentSubscriptionForOrg(org) {
  if (!org || org._id === 'org_platform') return null
  const subscriptionId = `sub_${org._id}_permanent`
  const now = new Date()
  if (
    org.billing_status === 'permanent' &&
    org.plan_id === 'standard_year' &&
    org.subscription_id === subscriptionId &&
    !org.current_period_end
  ) return subscriptionId

  try {
    await db.collection('Subscriptions').doc(subscriptionId).set({
      data: {
        org_id: org._id,
        plan_id: 'standard_year',
        plan_name: '标准版年付',
        status: 'permanent',
        start_at: org.current_period_start || now,
        end_at: '',
        grace_until: '',
        source: 'owner_factory_grant',
        opened_by: 'system',
        opened_by_name: '系统',
        remark: '飞盛自家工厂 A001 永久免费',
        created_at: org.current_period_start || db.serverDate(),
        updated_at: db.serverDate()
      }
    })
  } catch (err) {}

  await db.collection('Organizations').doc(org._id).update({
    data: {
      billing_status: 'permanent',
      plan_id: 'standard_year',
      subscription_id: subscriptionId,
      trial_end: '',
      current_period_start: org.current_period_start || now,
      current_period_end: '',
      grace_until: '',
      billing_owner_user_id: '',
      billing_updated_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  return subscriptionId
}

async function ensurePermanentHomeFactory() {
  try {
    const homeRes = await db.collection('Organizations').doc(PERMANENT_HOME_ORG_ID).get()
    if (homeRes.data && homeRes.data.status === 'active') {
      if (homeRes.data.factory_code === PERMANENT_HOME_FACTORY_CODE || homeRes.data.org_name === '飞盛') {
        return await upsertPermanentSubscriptionForOrg(homeRes.data)
      }
    }
  } catch (err) {}

  try {
    const codeRes = await db.collection('Organizations')
      .where({ factory_code: PERMANENT_HOME_FACTORY_CODE, status: 'active' })
      .limit(1)
      .get()
    if (codeRes.data && codeRes.data.length) {
      return await upsertPermanentSubscriptionForOrg(codeRes.data[0])
    }
  } catch (err) {}

  return null
}

function buildSubscriptionView(org, plan) {
  const status = deriveBillingStatus(org)
  const endAt = org.current_period_end || org.trial_end || null
  const graceUntil = org.grace_until || null
  return {
    org_id: org._id,
    org_name: org.org_name || '',
    factory_code: org.factory_code || '',
    contact_name: org.contact_name || '',
    contact_phone: org.contact_phone || '',
    billing_status: status,
    billing_status_label: getStatusLabel(status),
    raw_billing_status: org.billing_status || 'not_enabled',
    plan_id: org.plan_id || '',
    plan_name: status === 'permanent' && plan ? plan.plan_name + '（永久免费）' : (plan ? plan.plan_name : '未开通'),
    current_period_end: endAt || '',
    current_period_end_text: status === 'permanent' ? '永久免费' : formatDate(endAt),
    grace_until: graceUntil || '',
    grace_until_text: status === 'permanent' ? '无需宽限' : formatDate(graceUntil),
    days_remaining: daysUntil(endAt),
    can_use: !['expired', 'disabled'].includes(status)
  }
}

exports.main = async (event, context) => {
  const action = event.action
  switch (action) {
    case 'getMySubscription': return await getMySubscription(event)
    case 'getOpenRequestInfo': return await getOpenRequestInfo(event)
    case 'listPlans': return await listPlans(event)
    case 'openSubscription': return await openSubscription(event)
    case 'extendSubscription': return await openSubscription(event)
    case 'changePlan': return await openSubscription(event)
    case 'listBillingOrders': return await listBillingOrders(event)
    case 'markManualPaymentPaid': return await markManualPaymentPaid(event)
    default: return { code: -1, msg: '未知操作' }
  }
}

async function getMySubscription(event) {
  const auth = await requireBoss(event)
  if (!auth.ok) return auth.response

  const org = auth.caller._organization
  const plans = await getPlansFromDb()
  const plan = getPlanById(org.plan_id, plans)
  const subscription = buildSubscriptionView(org, plan)
  const requestInfo = buildOpenRequestInfo(auth.caller, subscription)

  return {
    code: 0,
    data: {
      subscription,
      request_info_text: requestInfo,
      support: {
        title: '联系平台管理员开通服务',
        note: '付款完成后，由平台管理员为工厂手动开通或延期。'
      }
    }
  }
}

async function getOpenRequestInfo(event) {
  const auth = await requireBoss(event)
  if (!auth.ok) return auth.response

  const org = auth.caller._organization
  const plans = await getPlansFromDb()
  const plan = getPlanById(org.plan_id, plans)
  const subscription = buildSubscriptionView(org, plan)

  return { code: 0, data: { text: buildOpenRequestInfo(auth.caller, subscription) } }
}

function buildOpenRequestInfo(caller, subscription) {
  return [
    '开通/续费服务',
    '工厂名称：' + (subscription.org_name || ''),
    '工厂码：' + (subscription.factory_code || ''),
    '联系人：' + (caller.name || subscription.contact_name || ''),
    '手机号：' + (caller.phone || subscription.contact_phone || ''),
    '当前套餐：' + (subscription.plan_name || '未开通'),
    '当前状态：' + (subscription.billing_status_label || ''),
    '到期时间：' + (subscription.current_period_end_text || '未设置'),
    '希望开通：标准版 / 1年'
  ].join('\n')
}

async function listPlans(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  try {
    await ensureBillingCollections()
    await seedPlans()
    await ensurePermanentHomeFactory()
  } catch (err) {
    return { code: 0, data: DEFAULT_PLANS.map(decoratePlan) }
  }

  const plans = await getPlansFromDb()
  return { code: 0, data: plans }
}

async function openSubscription(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  const planId = normalizeText(event.plan_id) || 'standard_year'
  const requestedPeriodMonths = Math.max(1, Math.min(toInt(event.period_months, 12), 120))
  const requestedTrialDays = Math.max(1, Math.min(toInt(event.trial_days, 7), 30))
  const graceDays = Math.max(0, Math.min(toInt(event.grace_days, 7), 90))
  const amountCents = toAmountCents(event.amount_yuan)
  const paymentChannel = normalizeText(event.payment_channel) || 'manual_wechat'
  const remark = normalizeText(event.remark)

  if (!orgId) return { code: -1, msg: '缺少工厂ID' }

  try {
    await ensureBillingCollections()
    await seedPlans()
    await ensurePermanentHomeFactory()

    const orgRes = await db.collection('Organizations').doc(orgId).get()
    const org = orgRes.data
    if (!org || org.status !== 'active') return { code: -1, msg: '工厂不存在或已停用' }
    if (org.platform_role === 'platform_admin' || orgId === 'org_platform') return { code: -1, msg: '平台组织不需要开通订阅' }
    if (org.billing_status === 'permanent') return { code: -1, msg: '该工厂已是永久免费，无需重复开通' }

    const plans = await getPlansFromDb()
    const plan = getPlanById(planId, plans)
    if (!plan) return { code: -1, msg: '套餐不存在' }

    const now = new Date()
    const currentEndTs = toTimestamp(org.current_period_end || org.trial_end)
    const startAt = currentEndTs && currentEndTs > now.getTime() ? new Date(currentEndTs) : now
    const isTrial = plan.plan_id === 'trial' || plan.billing_period === 'trial'
    const periodMonths = isTrial ? 0 : requestedPeriodMonths
    const trialDays = isTrial ? Math.min(toInt(plan.trial_days, requestedTrialDays), 30) : 0
    const endAt = isTrial ? addDays(startAt, trialDays) : addMonths(startAt, periodMonths)
    const graceUntil = addDays(endAt, graceDays)

    const subscriptionRes = await db.collection('Subscriptions').add({
      data: {
        org_id: orgId,
        plan_id: plan.plan_id,
        plan_name: plan.plan_name,
        status: isTrial ? 'trial' : 'active',
        start_at: startAt,
        end_at: endAt,
        grace_until: graceUntil,
        source: 'manual',
        opened_by: auth.caller._id,
        opened_by_name: auth.caller.name || '',
        remark,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })

    const orderRes = await db.collection('BillingOrders').add({
      data: {
        org_id: orgId,
        subscription_id: subscriptionRes._id,
        plan_id: plan.plan_id,
        plan_name: plan.plan_name,
        amount_cents: amountCents,
        payment_channel: paymentChannel,
        payment_status: 'paid',
        paid_at: db.serverDate(),
        verified_by: auth.caller._id,
        verified_by_name: auth.caller.name || '',
        external_trade_no: normalizeText(event.external_trade_no),
        remark,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })

    await db.collection('Organizations').doc(orgId).update({
      data: {
        billing_status: isTrial ? 'trial' : 'active',
        plan_id: plan.plan_id,
        subscription_id: subscriptionRes._id,
        trial_end: isTrial ? endAt : '',
        current_period_start: startAt,
        current_period_end: endAt,
        grace_until: graceUntil,
        billing_owner_user_id: normalizeText(event.billing_owner_user_id),
        billing_updated_at: db.serverDate(),
        updated_at: db.serverDate()
      }
    })

    await writePlatformLog(
      auth.caller,
      'open_subscription',
      orgId,
      `${org.factory_code || orgId}/${plan.plan_name}/${isTrial ? trialDays + '天' : periodMonths + '个月'}/${amountCents}分`
    )

    return {
      code: 0,
      msg: '订阅已开通',
      data: {
        subscription_id: subscriptionRes._id,
        billing_order_id: orderRes._id,
        end_at: endAt,
        end_at_text: formatDate(endAt),
        grace_until: graceUntil,
        grace_until_text: formatDate(graceUntil)
      }
    }
  } catch (err) {
    return { code: -1, msg: '开通订阅失败: ' + (err.message || '未知错误') }
  }
}

async function listBillingOrders(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  if (!orgId) return { code: -1, msg: '缺少工厂ID' }

  try {
    const list = []
    let batchLen = 0
    do {
      const res = await db.collection('BillingOrders')
        .where({ org_id: orgId })
        .orderBy('created_at', 'desc')
        .skip(list.length)
        .limit(100)
        .get()
      batchLen = (res.data || []).length
      list.push(...(res.data || []))
    } while (batchLen === 100)

    return {
      code: 0,
      data: list.map(item => Object.assign({}, item, {
        amount_yuan: Number(item.amount_cents || 0) / 100,
        paid_at_text: formatDate(item.paid_at || item.created_at)
      }))
    }
  } catch (err) {
    return { code: -1, msg: '获取开通记录失败' }
  }
}

async function markManualPaymentPaid(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orderId = normalizeText(event.billing_order_id)
  if (!orderId) return { code: -1, msg: '缺少收款记录ID' }

  try {
    await db.collection('BillingOrders').doc(orderId).update({
      data: {
        payment_status: 'paid',
        paid_at: db.serverDate(),
        verified_by: auth.caller._id,
        verified_by_name: auth.caller.name || '',
        updated_at: db.serverDate()
      }
    })
    await writePlatformLog(auth.caller, 'mark_manual_payment_paid', '', orderId)
    return { code: 0, msg: '已确认收款' }
  } catch (err) {
    return { code: -1, msg: '确认收款失败' }
  }
}
