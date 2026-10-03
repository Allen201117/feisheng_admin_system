// 云函数 - billing（订阅状态、人工收款开通、套餐管理）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const crypto = require('crypto')
// 订阅状态 / 到期日推算 / 金额校验的唯一真源（common/org-billing.logic.js 的副本）
const orgBilling = require('./org-billing.logic')

const BILLING_COLLECTIONS = ['Plans', 'Subscriptions', 'BillingOrders', 'UsageMonthly']
const PERMANENT_HOME_ORG_ID = 'org_home'
const PERMANENT_HOME_FACTORY_CODE = 'A001'
const ACTIVE_PLAN_IDS = ['trial', 'standard_year']
const DEPRECATED_PLAN_IDS = ['basic_year', 'pro_year']

// ⚠️ 套餐定义与 init/index.js 的 DEFAULT_BILLING_PLANS 是两份副本（两边都会 upsert 同一 Plans 集合，
// 谁后跑谁覆盖）。改价格/限额/特性时必须同步两处，否则套餐口径会随执行顺序翻转。
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

const toTimestamp = orgBilling.toTimestamp
const formatDate = orgBilling.formatBeijingDate

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
  return orgBilling.deriveBillingStatus(org, Date.now())
}

function getStatusLabel(status) {
  return orgBilling.getBillingStatusLabel(status)
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
    } catch (err) {
      console.error('[billing] 下架旧套餐失败', planId, err)
    }
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
  } catch (err) {
    // Plans 集合还没建（新环境）时会走到这里，回退内置套餐；记日志便于区分真故障
    console.error('[billing] 读取套餐失败，回退内置套餐', err)
  }
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
  } catch (err) {
    // 审计日志失败不阻断已完成的业务写入，但必须留痕
    console.error('[billing] 平台操作日志写入失败', actionType, targetOrgId, err)
  }
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
  } catch (err) {
    // Subscriptions 写入失败时不能继续把组织标记 permanent，否则两边状态不一致且无任何线索
    console.error('[billing] 永久订阅记录写入失败，中止 permanent 标记', org._id, err)
    return null
  }

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
  } catch (err) {
    console.error('[billing] ensurePermanentHomeFactory 按 doc 查询失败', err)
  }

  try {
    const codeRes = await db.collection('Organizations')
      .where({ factory_code: PERMANENT_HOME_FACTORY_CODE, status: 'active' })
      .limit(1)
      .get()
    if (codeRes.data && codeRes.data.length) {
      return await upsertPermanentSubscriptionForOrg(codeRes.data[0])
    }
  } catch (err) {
    console.error('[billing] ensurePermanentHomeFactory 按工厂码查询失败', err)
  }

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

  // 只读：以前每次打开平台页都会建 4 个集合 + 重写全部套餐 + 校正永久工厂，拖慢页面。
  // 这些写操作保留在 openSubscription（低频写路径）和 init 里；集合不存在时 getPlansFromDb 回退内置套餐。
  const plans = await getPlansFromDb()
  return { code: 0, data: plans }
}

// 同一 request_id 只对应一条收款记录：用它派生固定 _id，add 时撞 _id 即说明是重复提交（含并发）
function buildOpenRequestIds(orgId, requestId) {
  const digest = crypto.createHash('sha1').update(orgId + ':' + requestId).digest('hex').slice(0, 32)
  return { orderId: 'bo_' + digest, subscriptionId: 'sub_' + digest }
}

async function findBillingOrderById(orderId) {
  const res = await db.collection('BillingOrders').where({ _id: orderId }).limit(1).get()
  return (res.data && res.data[0]) || null
}

function buildOpenSubscriptionResult(order, deduplicated) {
  return {
    code: 0,
    msg: deduplicated ? '这笔开通已经生效过，没有重复续费' : '订阅已开通',
    data: {
      subscription_id: order.subscription_id,
      billing_order_id: order._id,
      end_at: order.end_at,
      end_at_text: formatDate(order.end_at),
      grace_until: order.grace_until,
      grace_until_text: formatDate(order.grace_until),
      deduplicated: !!deduplicated
    }
  }
}

// 把收款记录里冻结好的日期写到 Subscriptions / Organizations，最后把收款记录标记为已生效。
// 三步都是按固定 id 覆盖写，重跑结果相同（幂等）。
async function applyBillingOrder(order, caller) {
  const isTrial = !!order.is_trial
  await db.collection('Subscriptions').doc(order.subscription_id).set({
    data: {
      org_id: order.org_id,
      plan_id: order.plan_id,
      plan_name: order.plan_name,
      status: isTrial ? 'trial' : 'active',
      start_at: order.start_at,
      end_at: order.end_at,
      grace_until: order.grace_until,
      source: 'manual',
      billing_order_id: order._id,
      opened_by: order.verified_by || caller._id,
      opened_by_name: order.verified_by_name || caller.name || '',
      remark: order.remark || '',
      created_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  await db.collection('Organizations').doc(order.org_id).update({
    data: {
      billing_status: isTrial ? 'trial' : 'active',
      plan_id: order.plan_id,
      subscription_id: order.subscription_id,
      trial_end: isTrial ? order.end_at : '',
      current_period_start: order.start_at,
      current_period_end: order.end_at,
      grace_until: order.grace_until,
      billing_owner_user_id: order.billing_owner_user_id || '',
      billing_updated_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })

  await db.collection('BillingOrders').doc(order._id).update({
    data: {
      payment_status: 'paid',
      applied: true,
      paid_at: db.serverDate(),
      updated_at: db.serverDate()
    }
  })
}

function describeOrder(order) {
  const view = orgBilling.decorateBillingOrder(order)
  return (order.plan_name || '') + (view.period_text ? ' ' + view.period_text : '') + '，¥' + view.amount_yuan
}

// 先补完这家工厂挂着的「没写完」的开通，再谈新的：避免失败后关掉弹层重开（新 request_id）把同一笔钱续两次
async function findPendingOrderForOrg(orgId) {
  const res = await db.collection('BillingOrders')
    .where({ org_id: orgId, applied: false })
    .orderBy('created_at', 'asc')
    .limit(1)
    .get()
  return (res.data && res.data[0]) || null
}

const MAX_REMARK_LENGTH = 100

async function openSubscription(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orgId = normalizeText(event.org_id)
  const planId = normalizeText(event.plan_id) || 'standard_year'
  const paymentChannel = normalizeText(event.payment_channel) || 'manual_wechat'
  const remark = normalizeText(event.remark)
  const externalTradeNo = normalizeText(event.external_trade_no)
  const clientRequestId = normalizeText(event.request_id)

  if (!orgId) return { code: -1, msg: '缺少工厂ID' }
  if (clientRequestId && !orgBilling.isValidRequestId(clientRequestId)) {
    return { code: -1, msg: '请求编号无效，请关闭弹窗后重新提交' }
  }
  if (!orgBilling.isKnownPaymentChannel(paymentChannel)) return { code: -1, msg: '收款方式不对' }
  if (remark.length > MAX_REMARK_LENGTH || externalTradeNo.length > MAX_REMARK_LENGTH) {
    return { code: -1, msg: '备注最多 ' + MAX_REMARK_LENGTH + ' 个字' }
  }
  const amount = orgBilling.parseAmountYuan(event.amount_yuan)
  if (!amount.ok) return { code: -1, msg: amount.msg }

  // 新版前端每次打开续费弹层生成一个 request_id，callCloud 网络重试会原样带上它 → 服务端去重。
  // 旧版前端不传：服务端临时生成，仅保证本次调用内一致（无跨重试去重，与改造前相同）。
  const requestId = clientRequestId || ('srv_' + crypto.randomBytes(12).toString('hex'))
  const ids = buildOpenRequestIds(orgId, requestId)
  const fingerprint = orgBilling.buildOpenRequestFingerprint({
    plan_id: planId,
    period_months: event.period_months,
    trial_days: event.trial_days,
    amount_cents: amount.cents
  })

  try {
    // 新环境集合可能还没建：先建再查，否则查询直接报「集合不存在」
    await ensureBillingCollections()

    let order = await findBillingOrderById(ids.orderId)
    let replay = orgBilling.decideOpenSubscriptionReplay(order)
    let resumedPrevious = false

    if (order && order.request_fingerprint && order.request_fingerprint !== fingerprint) {
      return { code: -1, msg: '这次提交的内容和上次不一样。请关闭弹窗、刷新页面后重新打开续费' }
    }
    if (replay === 'done') return buildOpenSubscriptionResult(order, true)

    const orgRes = await db.collection('Organizations').doc(orgId).get()
    const org = orgRes.data
    if (!org) return { code: -1, msg: '工厂不存在' }

    if (replay === 'none') {
      const pending = await findPendingOrderForOrg(orgId)
      if (pending) {
        order = pending
        replay = 'resume'
        resumedPrevious = true
      }
    }

    if (replay === 'resume') {
      // 上次写到一半：只按收款记录里冻结的日期补完，绝不重新推算（否则会再顺延一次）
      const resumable = orgBilling.checkResumableOrder(org, order)
      if (!resumable.ok) {
        console.error('[billing] 未完成的开通记录不能自动补完', order._id, orgId, resumable.msg)
        return { code: -1, msg: resumable.msg }
      }
    } else {
      await seedPlans()
      await ensurePermanentHomeFactory()

      // 永久工厂校正可能刚改了 org，重新读一次再推算
      const freshOrgRes = await db.collection('Organizations').doc(orgId).get()
      const freshOrg = freshOrgRes.data || org
      if (freshOrg.status !== 'active') return { code: -1, msg: '工厂不存在或已停用' }

      const plans = await getPlansFromDb()
      const plan = plans.find(item => item.plan_id === planId)
      if (!plan) return { code: -1, msg: '套餐不存在或已下架' }

      const plannedWindow = orgBilling.planSubscriptionWindow({
        org: freshOrg,
        plan,
        periodMonths: event.period_months,
        trialDays: event.trial_days,
        graceDays: event.grace_days,
        nowTs: Date.now()
      })
      if (!plannedWindow.ok) return { code: -1, msg: plannedWindow.msg }

      const orderData = {
        _id: ids.orderId,
        org_id: orgId,
        subscription_id: ids.subscriptionId,
        request_id: requestId,
        request_fingerprint: fingerprint,
        plan_id: plan.plan_id,
        plan_name: plan.plan_name,
        is_trial: plannedWindow.is_trial,
        period_months: plannedWindow.period_months,
        trial_days: plannedWindow.trial_days,
        grace_days: plannedWindow.grace_days,
        start_at: plannedWindow.start_at,
        end_at: plannedWindow.end_at,
        grace_until: plannedWindow.grace_until,
        amount_cents: amount.cents,
        payment_channel: paymentChannel,
        payment_status: 'pending',
        applied: false,
        verified_by: auth.caller._id,
        verified_by_name: auth.caller.name || '',
        external_trade_no: externalTradeNo,
        billing_owner_user_id: normalizeText(event.billing_owner_user_id),
        remark,
        created_at: db.serverDate(),
        updated_at: db.serverDate()
      }

      try {
        await db.collection('BillingOrders').add({ data: orderData })
        order = orderData
      } catch (err) {
        // 并发的同一请求抢先写入了同 _id 的记录 → 按已有记录处理；不是这种情况就照常报错
        const raced = await findBillingOrderById(ids.orderId)
        if (!raced) throw err
        if (orgBilling.decideOpenSubscriptionReplay(raced) === 'done') return buildOpenSubscriptionResult(raced, true)
        const resumable = orgBilling.checkResumableOrder(org, raced)
        if (!resumable.ok) return { code: -1, msg: resumable.msg }
        order = raced
      }
    }

    await applyBillingOrder(order, auth.caller)

    await writePlatformLog(
      auth.caller,
      'open_subscription',
      orgId,
      `${org.factory_code || orgId}/${order.plan_name}/${order.is_trial ? order.trial_days + '天' : order.period_months + '个月'}/${order.amount_cents}分${replay === 'resume' ? '/补完' : ''}`
    )

    const result = buildOpenSubscriptionResult(order, false)
    if (resumedPrevious) {
      result.msg = '上次没完成的那笔开通（' + describeOrder(order) + '）已补上，到期 ' + result.data.end_at_text +
        '。这次的提交没有再续费，如果还要续，请重新打开续费。'
      result.data.resumed_previous = true
    }
    return result
  } catch (err) {
    console.error('[billing] 开通订阅失败', orgId, requestId, err)
    return { code: -1, msg: '开通订阅失败: ' + (err.message || '未知错误') + '。可以直接再点一次确认，不会重复续费' }
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
      data: list.map(item => orgBilling.decorateBillingOrder(item))
    }
  } catch (err) {
    console.error('[billing] 获取开通记录失败', orgId, err)
    return { code: -1, msg: '获取开通记录失败' }
  }
}

async function markManualPaymentPaid(event) {
  const auth = await requirePlatformAdmin(event)
  if (!auth.ok) return auth.response

  const orderId = normalizeText(event.billing_order_id)
  if (!orderId) return { code: -1, msg: '缺少收款记录ID' }

  try {
    const order = await findBillingOrderById(orderId)
    if (!order) return { code: -1, msg: '收款记录不存在' }
    // 没生效的开通记录（applied:false）如果在这里直接标成已收款，会被当成「已生效」而永远补不完
    if (order.applied === false) {
      return { code: -1, msg: '这笔开通还没生效，请回到工厂详情重新提交开通' }
    }
    await db.collection('BillingOrders').doc(orderId).update({
      data: {
        payment_status: 'paid',
        paid_at: db.serverDate(),
        verified_by: auth.caller._id,
        verified_by_name: auth.caller.name || '',
        updated_at: db.serverDate()
      }
    })
    await writePlatformLog(auth.caller, 'mark_manual_payment_paid', order.org_id || '', orderId)
    return { code: 0, msg: '已确认收款' }
  } catch (err) {
    console.error('[billing] 确认收款失败', orderId, err)
    return { code: -1, msg: '确认收款失败' }
  }
}
