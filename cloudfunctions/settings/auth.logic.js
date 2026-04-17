function normalizeCredential(value) {
  return typeof value === 'string' ? value.trim() : ''
}

function buildStrictAuthWhere(event) {
  const authUserId = normalizeCredential(event && event.auth_user_id)
  const authSessionToken = normalizeCredential(event && event.auth_session_token)

  if (!authUserId || !authSessionToken) {
    return null
  }

  return {
    _id: authUserId,
    session_token: authSessionToken,
    status: 'active'
  }
}

module.exports = {
  buildStrictAuthWhere
}