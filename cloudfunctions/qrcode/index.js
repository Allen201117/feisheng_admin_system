// 云函数 - qrcode (二维码管理)
const cloud = require('wx-server-sdk')
const crypto = require('crypto')
const QRCode = require('qrcode')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()

const QR_COLLECTION = 'qr_codes'


const authGuard = require('./auth-guard')

// 统一鉴权（见 auth-guard.js）：必须携带有效 token，工厂 status=active，失败一律拒绝。
async function getCallerUserByEvent(event, wxContext) {
  return await authGuard.getCallerUserByEvent(db, event)
}

function getOrgId(user) {
  return user && user.org_id ? user.org_id : ''
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

async function ensureWritableEntitlement(caller) {
  const orgId = getOrgId(caller)
  if (!orgId || caller.platform_role === 'platform_admin') return { ok: true }

  try {
    const orgRes = await db.collection('Organizations').doc(orgId).get()
    const org = orgRes.data
    if (!org || org.status !== 'active') return { ok: false, msg: '工厂已停用，请联系平台管理员' }
    const billingStatus = org.billing_status || 'not_enabled'
    if (billingStatus === 'not_enabled') return { ok: true }
    if (billingStatus === 'disabled' || billingStatus === 'expired') {
      return { ok: false, msg: '工厂服务已到期，请联系平台管理员开通' }
    }

    const now = Date.now()
    const endTs = toTimestamp(org.current_period_end || org.trial_end)
    const graceTs = toTimestamp(org.grace_until)
    if (endTs && now > endTs && (!graceTs || now > graceTs)) {
      return { ok: false, msg: '工厂服务已到期，请联系平台管理员开通' }
    }
    return { ok: true }
  } catch (err) {
    return { ok: false, msg: '服务状态校验失败，请稍后重试' }
  }
}

exports.main = async (event, context) => {
  const wxContext = cloud.getWXContext()
  const { action } = event

  switch (action) {
    case 'generate': return await generateQRCode(event, wxContext)
    case 'getLatest': return await getLatest(event, wxContext)
    case 'verify': return await verifyQRCode(event)
    case 'revoke': return await revokeQRCode(event, wxContext)
    default: return { code: -1, msg: '未知操作' }
  }
}

function buildShortQrId() {
  // scene 最大 32 字符，qrId 必须短且唯一
  return `${Date.now().toString(36)}${crypto.randomBytes(4).toString('hex')}`
}

async function writeAudit(action, details, orgId) {
  try {
    await db.collection('audit_logs').add({
      data: {
        org_id: orgId || '',
        action,
        details,
        created_at: db.serverDate()
      }
    })
  } catch (e) {
    // ignore audit write failures
  }
}

async function generateSchemeByEnv(qrId, envVersion) {
  const query = `source=scan&q=${encodeURIComponent(qrId)}`
  const schemeRes = await cloud.openapi.urlscheme.generate({
    jump_wxa: {
      path: 'pages/login/login',
      query,
      env_version: envVersion
    },
    is_expire: false
  })

  const openLink = schemeRes && schemeRes.openlink ? schemeRes.openlink : ''
  if (!openLink) {
    const e = new Error('URL Scheme 生成失败')
    e.errCode = schemeRes && schemeRes.errCode
    throw e
  }

  return { openLink, envVersion }
}

// 体验版优先降级方案：生成 URL Scheme 并转为普通二维码，微信扫一扫可直接跳转小程序
async function generateSchemeQR({ qrId, scene, nonce, expireAt, expireDays, caller, wxContext, errInfo }) {
  let schemeData = null
  let lastErr = null
  const envVersions = ['trial', 'develop']

  for (const envVersion of envVersions) {
    try {
      schemeData = await generateSchemeByEnv(qrId, envVersion)
      break
    } catch (e) {
      lastErr = e
    }
  }

  if (!schemeData) {
    throw lastErr || new Error('URL Scheme 不可用')
  }

  const qrBuffer = await QRCode.toBuffer(schemeData.openLink, {
    type: 'png',
    width: 430,
    margin: 2,
    color: { dark: '#1890FF', light: '#FFFFFF' }
  })

  const uploadRes = await cloud.uploadFile({
    cloudPath: `qrcodes/attend_scheme_${qrId}.png`,
    fileContent: qrBuffer
  })

  await db.collection(QR_COLLECTION).add({
    data: {
      qr_id: qrId,
      org_id: getOrgId(caller),
      token: qrId,
      scene,
      page: 'pages/login/login',
      nonce,
      qr_type: 'scheme',
      scheme_url: schemeData.openLink,
      scheme_env: schemeData.envVersion,
      file_id: uploadRes.fileID,
      expire_at: expireAt.toISOString(),
      status: 'active',
      generated_by: caller._id,
      generated_env: wxContext.ENV || '',
      created_at: db.serverDate()
    }
  })

  const urlRes = await cloud.getTempFileURL({
    fileList: [uploadRes.fileID]
  })
  const tempUrl = urlRes.fileList[0].tempFileURL

  await writeAudit('qrcode_generate_scheme', `qr_id=${qrId}; wxacodeErr=${errInfo || ''}; schemeEnv=${schemeData.envVersion}`, getOrgId(caller))

  return {
    code: 0,
    msg: '已生成考勤二维码（微信扫一扫可直接跳转小程序）',
    data: {
      qr_id: qrId,
      org_id: getOrgId(caller),
      token: qrId,
      scene,
      file_id: uploadRes.fileID,
      temp_url: tempUrl,
      expire_at: expireAt.toISOString(),
      expire_days: expireDays,
      qr_type: 'scheme',
      scheme_env: schemeData.envVersion,
      scheme_url: schemeData.openLink
    }
  }
}

// 体验版/开发版降级方案：用 qrcode npm 生成标准二维码图片
async function generateFallbackQR({ qrId, scene, nonce, expireAt, expireDays, caller, wxContext, errInfo }) {
  // 生成标准二维码图片 Buffer，内容为 scene 字符串
  const qrBuffer = await QRCode.toBuffer(scene, {
    type: 'png',
    width: 430,
    margin: 2,
    color: { dark: '#1890FF', light: '#FFFFFF' }
  })

  // 上传到云存储
  const uploadRes = await cloud.uploadFile({
    cloudPath: `qrcodes/attend_${qrId}.png`,
    fileContent: qrBuffer
  })

  // 保存记录（qr_type 设为 'fallback'，正式版生成的是 'image'）
  // org_id 不能省：attendance.validateQrToken 按 {org_id, token} 校验，缺了会导致降级码扫码签到必被拒
  await db.collection(QR_COLLECTION).add({
    data: {
      qr_id: qrId,
      token: qrId,
      org_id: getOrgId(caller),
      scene,
      page: 'pages/login/login',
      nonce,
      qr_type: 'fallback',
      file_id: uploadRes.fileID,
      expire_at: expireAt.toISOString(),
      status: 'active',
      generated_by: caller._id,
      generated_env: wxContext.ENV || '',
      created_at: db.serverDate()
    }
  })

  // 获取临时 URL
  const urlRes = await cloud.getTempFileURL({
    fileList: [uploadRes.fileID]
  })
  const tempUrl = urlRes.fileList[0].tempFileURL

  await writeAudit('qrcode_generate_fallback', `qr_id=${qrId}; errCode=${errInfo}; type=image_fallback`, getOrgId(caller))

  return {
    code: 0,
    msg: '已生成考勤二维码（体验版模式：员工需在小程序内使用"扫码打卡"）',
    data: {
      qr_id: qrId,
      token: qrId,
      scene,
      file_id: uploadRes.fileID,
      temp_url: tempUrl,
      expire_at: expireAt.toISOString(),
      expire_days: expireDays,
      qr_type: 'fallback'
    }
  }
}

async function generateQRCode(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足，仅管理员可生成' }
  }

  const entitlement = await ensureWritableEntitlement(caller)
  if (!entitlement.ok) return { code: -1, msg: entitlement.msg }

  try {
    // 获取过期时间配置（天）；与 attendance 同口径：org 文档缺失时回退遗留 'main' 文档
    let expireDays = 1
    try {
      let settings = null
      try {
        const res = await db.collection('factory_settings').doc(getOrgId(caller)).get()
        settings = res.data || null
      } catch (e) {
        settings = null
      }
      if (!settings) {
        const mainRes = await db.collection('factory_settings').doc('main').get()
        settings = mainRes.data || null
      }
      if (settings) {
        if (settings.qrcode_expire_days) {
          expireDays = settings.qrcode_expire_days
        } else if (settings.qrcode_expire_hours) {
          expireDays = Math.round(settings.qrcode_expire_hours / 24) || 1
        }
      }
    } catch (e) {
      console.error('[qrcode] 读取二维码有效期配置失败，使用默认 1 天', e)
    }

    const now = new Date()
    const qrId = buildShortQrId()
    const nonce = crypto.randomBytes(2).toString('hex')
    const expireAt = new Date(now.getTime() + expireDays * 24 * 60 * 60 * 1000)

    // 使用小程序码API生成
    const scene = `q=${qrId}&n=${nonce}`
    let result
    try {
      result = await cloud.openapi.wxacode.getUnlimited({
        scene,
        page: 'pages/login/login',
        width: 430,
        autoColor: false,
        lineColor: { r: 24, g: 144, b: 255 }
      })
    } catch (apiErr) {
      // 体验版优先用 URL Scheme 二维码（微信扫一扫可直接跳转小程序）
      try {
        return await generateSchemeQR({ qrId, scene, nonce, expireAt, expireDays, caller, wxContext, errInfo: apiErr.errCode || '' })
      } catch (schemeErr) {
        // URL Scheme 不可用时，退回普通二维码（需小程序内扫码）
        return await generateFallbackQR({ qrId, scene, nonce, expireAt, expireDays, caller, wxContext, errInfo: `${apiErr.errCode || ''}/${schemeErr.errCode || ''}` })
      }
    }

    if (result.errCode !== 0 && result.errCode !== undefined) {
      try {
        return await generateSchemeQR({ qrId, scene, nonce, expireAt, expireDays, caller, wxContext, errInfo: result.errCode || '' })
      } catch (schemeErr) {
        return await generateFallbackQR({ qrId, scene, nonce, expireAt, expireDays, caller, wxContext, errInfo: `${result.errCode || ''}/${schemeErr.errCode || ''}` })
      }
    }

    // 上传到云存储
    const uploadRes = await cloud.uploadFile({
      cloudPath: `qrcodes/attend_${qrId}.png`,
      fileContent: result.buffer
    })

    // 保存记录
    await db.collection(QR_COLLECTION).add({
      data: {
        qr_id: qrId,
        org_id: getOrgId(caller),
        token: qrId,
        scene,
        page: 'pages/login/login',
        nonce,
        qr_type: 'image',
        file_id: uploadRes.fileID,
        expire_at: expireAt.toISOString(),
        status: 'active',
        generated_by: caller._id,
        generated_env: wxContext.ENV || '',
        created_at: db.serverDate()
      }
    })

    // 获取临时URL
    const urlRes = await cloud.getTempFileURL({
      fileList: [uploadRes.fileID]
    })

    const tempUrl = urlRes.fileList[0].tempFileURL

    return {
      code: 0,
      msg: '二维码生成成功',
      data: {
        qr_id: qrId,
        token: qrId,
        scene,
        file_id: uploadRes.fileID,
        temp_url: tempUrl,
        expire_at: expireAt.toISOString(),
        expire_days: expireDays,
        qr_type: 'image'
      }
    }
  } catch (err) {
    await writeAudit('qrcode_generate_failed', `err=${err.message || err.errMsg || 'unknown'}`, getOrgId(caller))
    return { code: -1, msg: '生成失败: ' + (err.message || err.errMsg || '未知错误') }
  }
}

async function getLatest(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足' }
  }

  try {
    const res = await db.collection(QR_COLLECTION)
      .where({ org_id: getOrgId(caller) })
      .orderBy('created_at', 'desc')
      .limit(1)
      .get()

    if (res.data.length === 0) {
      return { code: 0, data: null }
    }

    const qr = res.data[0]
    const now = new Date()
    const expireAt = new Date(qr.expire_at)
    const isExpired = now > expireAt

    let tempUrl = ''
    if (qr.file_id && !isExpired) {
      try {
        const urlRes = await cloud.getTempFileURL({
          fileList: [qr.file_id]
        })
        tempUrl = urlRes.fileList[0].tempFileURL
      } catch (e) {}
    }

    return {
      code: 0,
      data: {
        ...qr,
        temp_url: tempUrl,
        is_expired: isExpired
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取失败' }
  }
}

async function verifyQRCode(event) {
  const token = event.token || event.qr_id
  if (!token) {
    return { code: -1, msg: '无效的二维码' }
  }

  try {
    const res = await db.collection(QR_COLLECTION).where({ token }).limit(1).get()
    if (res.data.length === 0) {
      return { code: -1, msg: '二维码不存在' }
    }

    const qr = res.data[0]
    if (qr.status !== 'active') {
      return { code: -1, msg: '二维码已作废' }
    }
    const now = new Date()
    const expireAt = new Date(qr.expire_at)

    if (now > expireAt) {
      return { code: -1, msg: '二维码已过期' }
    }

    await writeAudit('qrcode_verify', `qr_id=${qr.qr_id || qr.token}; ok=1`, qr.org_id || '')

    return {
      code: 0,
      msg: '验证通过',
      data: {
        source: 'qrcode',
        qr_id: qr.qr_id || qr.token,
        expire_at: qr.expire_at
      }
    }
  } catch (err) {
    await writeAudit('qrcode_verify_failed', `token=${token}; err=${err.message || 'unknown'}`)
    return { code: -1, msg: '验证失败' }
  }
}

async function revokeQRCode(event, wxContext) {
  const caller = await getCallerUserByEvent(event, wxContext)
  if (!caller || caller.role !== 'boss') {
    return { code: -1, msg: '权限不足，仅管理员可作废' }
  }

  try {
    const qrId = event.qr_id || event.token
    if (!qrId) {
      const latest = await db.collection(QR_COLLECTION).where({ org_id: getOrgId(caller) }).orderBy('created_at', 'desc').limit(1).get()
      if (!latest.data.length) return { code: -1, msg: '暂无可作废二维码' }
      await db.collection(QR_COLLECTION).doc(latest.data[0]._id).update({
        data: {
          status: 'revoked',
          revoked_at: db.serverDate(),
          revoked_by: caller._id
        }
      })
      await writeAudit('qrcode_revoke', `qr_id=${latest.data[0].qr_id || latest.data[0].token}`, getOrgId(caller))
      return { code: 0, msg: '已作废最新二维码' }
    }

    const found = await db.collection(QR_COLLECTION).where({ org_id: getOrgId(caller), token: qrId }).limit(1).get()
    if (!found.data.length) return { code: -1, msg: '二维码不存在' }
    await db.collection(QR_COLLECTION).doc(found.data[0]._id).update({
      data: {
        status: 'revoked',
        revoked_at: db.serverDate(),
        revoked_by: caller._id
      }
    })
    await writeAudit('qrcode_revoke', `qr_id=${found.data[0].qr_id || found.data[0].token}`, getOrgId(caller))
    return { code: 0, msg: '二维码已作废' }
  } catch (err) {
    return { code: -1, msg: '作废失败' }
  }
}
