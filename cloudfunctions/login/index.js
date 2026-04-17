// 云函数 - login（含首次登录强制改密、登录限流、会话token）
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const crypto = require('crypto')
const {
  normalizeText,
  validateLoginAttempt,
  pickLoginUser
} = require('./login.logic')

const CONSENT_VERSION = '2026-03-05-v1'
const CONSENT_POLICY_HASH = 'privacy-policy-hash-20260305-v1'

function hashPassword(password, salt) {
  return crypto.createHash('sha256').update(password + salt).digest('hex')
}
function generateSalt() {
  return crypto.randomBytes(16).toString('hex')
}
function generateToken() {
  return crypto.randomBytes(32).toString('hex')
}

// 密码强度校验：长度 >= 8，至少包含字母和数字
function isStrongPassword(pwd, phone) {
  if (!pwd || pwd.length < 8) return false
  if (pwd === phone) return false
  if (!/[a-zA-Z]/.test(pwd)) return false
  if (!/[0-9]/.test(pwd)) return false
  return true
}

// 登录限流：5分钟内同一姓名最多10次失败
async function checkLoginRateLimit(name, phone) {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
  try {
    const res = await db.collection('audit_logs').where({
      action: 'login_failed',
      details: _.regex(new RegExp(name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$')),
      created_at: _.gte(fiveMinAgo)
    }).count()
    return res.total < 10
  } catch (e) {
    return true
  }
}

exports.main = async (event, context) => {
  const { action } = event
  const wxContext = cloud.getWXContext()

  switch (action) {
    case 'login': return await login(event, wxContext)
    case 'changePassword': return await changePassword(event, wxContext)
    case 'verifyToken': return await verifyToken(event, wxContext)
    case 'getConsentStatus': return await getConsentStatus(event, wxContext)
    case 'recordConsent': return await recordConsent(event, wxContext)
    default: return { code: -1, msg: '未知操作' }
  }
}

async function hasCurrentConsent(openid) {
  if (!openid) return false
  const c = await db.collection('privacy_consents').where({
    openid,
    consent_version: CONSENT_VERSION,
    consent_status: 'agreed'
  }).limit(1).get()
  return !!(c.data && c.data.length)
}

async function getConsentStatus(event, wxContext) {
  try {
    const agreed = await hasCurrentConsent(wxContext.OPENID)
    return {
      code: 0,
      data: {
        consent_version: CONSENT_VERSION,
        policy_hash: CONSENT_POLICY_HASH,
        has_consent: agreed
      }
    }
  } catch (err) {
    return { code: -1, msg: '获取同意状态失败' }
  }
}

async function recordConsent(event, wxContext) {
  const agreed = !!event.agreed
  if (!agreed) {
    return { code: -1, msg: '需同意协议后方可继续' }
  }

  try {
    const openid = wxContext.OPENID
    const userRes = await db.collection('Users').where({ openid }).limit(1).get()
    const user = userRes.data && userRes.data.length ? userRes.data[0] : null

    await db.collection('privacy_consents').add({
      data: {
        openid,
        user_id: user ? user._id : '',
        consent_version: CONSENT_VERSION,
        policy_hash: CONSENT_POLICY_HASH,
        consent_status: 'agreed',
        channel: event.channel || 'miniapp',
        agreed_at: db.serverDate(),
        client_ts: event.client_ts || Date.now(),
        created_at: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: '已记录同意',
      data: {
        consent_version: CONSENT_VERSION,
        policy_hash: CONSENT_POLICY_HASH
      }
    }
  } catch (err) {
    return { code: -1, msg: '记录同意失败' }
  }
}

async function login(event, wxContext) {
  const name = normalizeText(event.name)
  const phone = normalizeText(event.phone)
  const password = event.password ? String(event.password) : ''

  const validation = validateLoginAttempt({ name, phone, password })
  if (!validation.ok) {
    return { code: -1, msg: validation.msg }
  }

  // 限流检查
  const allowed = await checkLoginRateLimit(name, phone)
  if (!allowed) {
    return { code: -1, msg: '登录尝试过于频繁，请稍后再试' }
  }

  try {
    const agreed = await hasCurrentConsent(wxContext.OPENID)
    if (!agreed) {
      return { code: -1, msg: '请先同意隐私政策与用户协议' }
    }

    const userRes = await db.collection('Users').where({
      name: name
    }).limit(20).get()

    const pickResult = pickLoginUser({
      name,
      phone,
      users: userRes.data || []
    })

    if (!pickResult.ok) {
      await db.collection('audit_logs').add({
        data: {
          action: 'login_failed',
          details: `${pickResult.field || 'login'}错误 - ${name}`,
          created_at: db.serverDate()
        }
      })
      return { code: -1, msg: pickResult.msg }
    }

    const user = pickResult.user

    const needChangePassword = !!(user.must_change_password || !user.password_changed)

    if (user.status === 'disabled') {
      return { code: -1, msg: '账号已停用，请联系管理员' }
    }

    // 验证密码
    const inputHash = hashPassword(password, user.salt || '')
    let passwordValid = false
    if (user.password_hash && user.password_hash === inputHash) {
      passwordValid = true
    } else if (!user.password_changed) {
      // 仅在用户未改过密码时才接受默认密码（手机号）
      const defaultHash = hashPassword(phone, user.salt || '')
      if (inputHash === defaultHash) {
        passwordValid = true
      }
    }

    if (!passwordValid) {
      await db.collection('audit_logs').add({
        data: {
          action: 'login_failed',
          details: '密码错误 - ' + name,
          created_at: db.serverDate()
        }
      })
      return { code: -1, msg: '密码错误' }
    }

    // 生成会话token
    const sessionToken = generateToken()

    // 绑定openid + 更新token
    await db.collection('Users').doc(user._id).update({
      data: {
        openid: wxContext.OPENID,
        session_token: sessionToken,
        last_login: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: '登录成功',
      data: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        openid: wxContext.OPENID,
        session_token: sessionToken,
        need_change_password: needChangePassword
      }
    }
  } catch (err) {
    console.error('登录失败:', err)
    return { code: -1, msg: '登录失败，请重试' }
  }
}

// 首次登录修改密码
async function changePassword(event, wxContext) {
  const { user_id, old_password, new_password } = event
  if (!user_id || !new_password) {
    return { code: -1, msg: '参数不完整' }
  }

  try {
    const userRes = await db.collection('Users').doc(user_id).get()
    const user = userRes.data
    if (!user) return { code: -1, msg: '用户不存在' }

    // 身份校验：调用者的 openid 必须与该用户绑定的 openid 一致
    if (!wxContext.OPENID || user.openid !== wxContext.OPENID) {
      return { code: -1, msg: '身份验证失败，无权修改该用户密码' }
    }

    // 校验新密码强度
    if (!isStrongPassword(new_password, user.phone)) {
      return { code: -1, msg: '密码需至少8位，包含字母和数字，且不能与手机号相同' }
    }

    // 旧密码校验（必须提供，除非是首次改密且 must_change_password 为 true）
    if (!user.must_change_password) {
      if (!old_password) {
        return { code: -1, msg: '请输入原密码' }
      }
      const oldHash = hashPassword(old_password, user.salt || '')
      if (user.password_hash && user.password_hash !== oldHash) {
        return { code: -1, msg: '原密码错误' }
      }
    }

    // 更新密码
    const newSalt = generateSalt()
    const newHash = hashPassword(new_password, newSalt)
    const newToken = generateToken()

    await db.collection('Users').doc(user_id).update({
      data: {
        password_hash: newHash,
        salt: newSalt,
        password_changed: true,
        must_change_password: false,
        session_token: newToken,
        updated_at: db.serverDate()
      }
    })

    return {
      code: 0,
      msg: '密码修改成功',
      data: { session_token: newToken }
    }
  } catch (err) {
    return { code: -1, msg: '修改密码失败' }
  }
}

// 验证token有效性
async function verifyToken(event, wxContext) {
  const { user_id, session_token } = event
  if (!user_id || !session_token) {
    return { code: -1, msg: '参数不完整' }
  }
  try {
    const userRes = await db.collection('Users').doc(user_id).get()
    const user = userRes.data
    if (!user || user.status !== 'active' || user.session_token !== session_token) {
      return { code: -1, msg: '登录已失效，请重新登录' }
    }
    // 校验 openid 一致性，防止 token 跨设备盗用
    if (wxContext.OPENID && user.openid && user.openid !== wxContext.OPENID) {
      return { code: -1, msg: '登录已在其他设备生效，请重新登录' }
    }
    return {
      code: 0,
      msg: 'token有效',
      data: {
        _id: user._id,
        name: user.name,
        phone: user.phone,
        role: user.role,
        openid: user.openid,
        session_token: user.session_token,
        need_change_password: !!(user.must_change_password || !user.password_changed)
      }
    }
  } catch (err) {
    return { code: -1, msg: '验证失败' }
  }
}
