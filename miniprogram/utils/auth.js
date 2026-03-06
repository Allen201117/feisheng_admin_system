// auth.js - 登录态管理
const STORAGE_KEY = 'factory_user_info'

/**
 * 保存用户信息到本地
 */
function storeUser(userInfo) {
  try {
    wx.setStorageSync(STORAGE_KEY, JSON.stringify(userInfo))
  } catch (e) {
    console.error('存储用户信息失败', e)
  }
}

/**
 * 获取本地存储的用户信息
 */
function getStoredUser() {
  try {
    const data = wx.getStorageSync(STORAGE_KEY)
    return data ? JSON.parse(data) : null
  } catch (e) {
    return null
  }
}

/**
 * 清除本地用户信息
 */
function clearUser() {
  try {
    wx.removeStorageSync(STORAGE_KEY)
  } catch (e) {
    console.error('清除用户信息失败', e)
  }
}

/**
 * 检查是否已登录
 */
function isLoggedIn() {
  const user = getStoredUser()
  return !!(user && user._id)
}

/**
 * 获取当前用户角色
 */
function getRole() {
  const user = getStoredUser()
  return user ? user.role : null
}

/**
 * 获取当前用户ID
 */
function getUserId() {
  const user = getStoredUser()
  return user ? user._id : null
}

/**
 * 获取当前用户名
 */
function getUserName() {
  const user = getStoredUser()
  return user ? user.name : ''
}

/**
 * 权限检查 - 是否是老板
 */
function isBoss() {
  return getRole() === 'boss'
}

/**
 * 权限检查 - 是否是质检员
 */
function isQC() {
  return getRole() === 'qc'
}

/**
 * 权限检查 - 是否是员工
 */
function isEmployee() {
  return getRole() === 'employee'
}

module.exports = {
  storeUser,
  getStoredUser,
  clearUser,
  isLoggedIn,
  getRole,
  getUserId,
  getUserName,
  isBoss,
  isQC,
  isEmployee
}
