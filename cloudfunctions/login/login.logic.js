function normalizeText(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function validateLoginAttempt(payload) {
  const name = normalizeText(payload && payload.name)
  const password = payload && payload.password ? String(payload.password) : ''

  if (!name) {
    return { ok: false, msg: '请输入姓名' }
  }

  if (!password) {
    return { ok: false, msg: '请输入密码' }
  }

  return { ok: true }
}

function needPhoneForLogin(user) {
  return !!(user && (user.must_change_password || !user.password_changed))
}

function pickLoginUser(options) {
  const name = normalizeText(options && options.name)
  const phone = normalizeText(options && options.phone)
  const users = Array.isArray(options && options.users) ? options.users : []

  if (users.length === 0) {
    return { ok: false, field: 'name', msg: '姓名错误' }
  }

  if (phone) {
    const matchedUser = users.find((user) => normalizeText(user.phone) === phone)
    if (!matchedUser) {
      return { ok: false, field: 'phone', msg: '手机号错误' }
    }
    return { ok: true, user: matchedUser }
  }

  if (users.length > 1) {
    return { ok: false, field: 'phone', msg: '该姓名存在多个账号，请输入手机号' }
  }

  if (needPhoneForLogin(users[0])) {
    return { ok: false, field: 'phone', msg: '首次登录请输入手机号' }
  }

  return { ok: true, user: users[0], name }
}

module.exports = {
  normalizeText,
  validateLoginAttempt,
  needPhoneForLogin,
  pickLoginUser
}