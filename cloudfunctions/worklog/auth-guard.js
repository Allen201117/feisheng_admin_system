// 统一鉴权守卫（唯一真源在 cloudfunctions/common/auth-guard.js，各云函数目录持有相同副本——
// 云函数按目录独立部署，无法跨目录 require，同 beijing-time.js 模式；改动必须同步所有副本，
// tests/auth-guard-copies.test.js 会校验副本一致性）。
//
// 口径（CLAUDE.md §2.5）：
//   1. 必须携带 auth_user_id + auth_session_token，且与 Users 严格匹配（status=active）。
//      不做 openid 回退——session_token 清空/重置即踢下线，不能被绕过。
//   2. 所属工厂 Organizations.status 必须为 active；校验失败一律 fail-closed（拒绝）。
//   3. org_id 永远从返回的登录用户推导，绝不信前端传值。

function buildStrictAuthWhere(event) {
  const authUserId = event && event.auth_user_id
  const authSessionToken = event && event.auth_session_token
  if (!authUserId || !authSessionToken) return null
  return {
    _id: authUserId,
    session_token: authSessionToken,
    status: 'active'
  }
}

async function getCallerUserByEvent(db, event) {
  const where = buildStrictAuthWhere(event)
  if (!where) return null

  let user = null
  try {
    const res = await db.collection('Users').where(where).limit(1).get()
    if (!res.data || res.data.length === 0) return null
    user = res.data[0]
  } catch (err) {
    console.error('[auth-guard] 用户鉴权查询失败，拒绝访问', err)
    return null
  }

  if (user.org_id) {
    try {
      const orgRes = await db.collection('Organizations').doc(user.org_id).get()
      if (!orgRes.data || orgRes.data.status !== 'active') return null
    } catch (err) {
      console.error('[auth-guard] 工厂状态校验失败，拒绝访问', err)
      return null
    }
  }

  return user
}

module.exports = {
  buildStrictAuthWhere,
  getCallerUserByEvent
}
