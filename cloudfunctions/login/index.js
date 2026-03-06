// 云函�?- login（含首次登录强制改密、登录限流、会话token�?
const cloud = require('wx-server-sdk')
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV })
const db = cloud.database()
const _ = db.command
const crypto = require('crypto')

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

// 密码强度校验：长�?=8，至少包含字�?数字
function isStrongPassword(pwd, phone) {
  if (!pwd || pwd.length < 8) return false
  if (pwd === phone) return false
  if (!/[a-zA-Z]/.test(pwd)) return false
  if (!/[0-9]/.test(pwd)) return false
  return true
}

// 登录限流�?分钟内最�?次失�?
async function checkLoginRateLimit(name, phone) {
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000)
  try {
    const res = await db.collection('audit_logs').where({
      action: 'login_failed',
      'details': _.exists(true),
      created_at: _.gte(fiveMinAgo)
    }).count()
    // 简单全局限流，精确限流需按用�?
    return res.total < 50
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
    return { code: -1, msg: '获取同意状态失�? }
  }
}

async function recordConsent(event, wxContext) {
  const agreed = !!event.agreed
  if (!agreed) {
    return { code: -1, msg: '需同意协议后方可继�? }
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
      msg: '已记录同�?,
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
  const { name, phone, password } = event
  if (!name || !phone || !password) {
    return { code: -1, msg: '请输入姓名、手机号和密�? }
  }

  // 限流检�?
  const allowed = await checkLoginRateLimit(name, phone)
  if (!allowed) {
    return { code: -1, msg: '登录尝试过于频繁，请稍后再试' }
  }

  try {
    const agreed = await hasCurrentConsent(wxContext.OPENID)
    if (!agreed) {
      return { code: -1, msg: '请先同意隐私政策与用户协�? }
    }

    // 先按姓名查询，再校验手机号，用于更清晰地给出失败提示
    const userRes = await db.collection('Users').where({
      name: name
    }).limit(20).get()

    if (!userRes.data || userRes.data.length === 0) {
      return { code: -1, msg: '用户名或手机号错�? }
    }

    const user = userRes.data.find(u => u.phone === phone)
    if (!user) {
      return { code: -1, msg: '用户名或手机号错�? }
    }

    if (user.status === 'disabled') {
      return { code: -1, msg: '账号已停用，请联系管理员' }
    }

    // 验证密码
    const inputHash = hashPassword(password, user.salt || '')
    let passwordValid = false
    if (user.password_hash && user.password_hash === inputHash) {
      passwordValid = true
    } else {
      // 兼容历史默认密码（手机号），但必须经过哈希比�?
      const defaultHash = hashPassword(phone, user.salt || '')
      if (inputHash === defaultHash) {
        passwordValid = true
      }
    }

    if (!passwordValid) {
      // 记录失败日志
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

    // 检查是否需要强制改�?
    const needChangePassword = !!(user.must_change_password || !user.password_changed)

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
    return { code: -1, msg: '参数不完�? }
  }

  try {
    const userRes = await db.collection('Users').doc(user_id).get()
    const user = userRes.data
    if (!user) return { code: -1, msg: '用户不存�? }

    // 校验新密码强�?
    if (!isStrongPassword(new_password, user.phone)) {
      return { code: -1, msg: '密码需至少8位，包含字母和数字，且不能与手机号相�? }
    }

    // 如果提供了旧密码则校�?
    if (old_password) {
      const oldHash = hashPassword(old_password, user.salt || '')
      if (user.password_hash && user.password_hash !== oldHash) {
        return { code: -1, msg: '原密码错�? }
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

// 验证token有效�?
async function verifyToken(event, wxContext) {
  const { user_id, session_token } = event
  if (!user_id || !session_token) {
    return { code: -1, msg: '参数不完�? }
  }
  try {
    const userRes = await db.collection('Users').doc(user_id).get()
    const user = userRes.data
    if (!user || user.session_token !== session_token) {
      return { code: -1, msg: '登录已失效，请重新登�? }
    }
    return { code: 0, msg: 'token有效' }
  } catch (err) {
    return { code: -1, msg: '验证失败' }
  }
}
