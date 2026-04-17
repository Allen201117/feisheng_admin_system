// util.js - 通用工具函数（所有时间已统一为北京时间 Asia/Shanghai）
const { getStoredUser } = require('./auth')
const bjTime = require('./beijing-time')

/**
 * 格式化日期为 YYYY-MM-DD（北京时间）
 */
function formatDate(date) {
  return bjTime.formatBeijingDate(date)
}

/**
 * 格式化时间为 HH:mm:ss（北京时间）
 */
function formatTime(date) {
  return bjTime.formatBeijingTime(date)
}

/**
 * 格式化日期时间为 YYYY-MM-DD HH:mm（北京时间）
 */
function formatDateTime(date) {
  return bjTime.formatBeijingDateTime(date)
}

/**
 * 获取当月第一天 YYYY-MM-01（北京时间）
 */
function getMonthStart(date) {
  return bjTime.getBeijingMonthStart(date)
}

/**
 * 获取当月最后一天（北京时间）
 */
function getMonthEnd(date) {
  return bjTime.getBeijingMonthEnd(date)
}

/**
 * 计算两个时间之间的小时数
 */
function calcHours(startTime, endTime) {
  return bjTime.calcHoursBetween(startTime, endTime)
}

/**
 * 显示成功提示
 */
function showSuccess(msg) {
  wx.showToast({ title: msg, icon: 'success', duration: 2000 })
}

/**
 * 显示错误提示
 */
function showError(msg) {
  wx.showToast({ title: msg, icon: 'none', duration: 3000 })
}

/**
 * 显示加载中
 */
function showLoading(msg) {
  wx.showLoading({ title: msg || '加载中...', mask: true })
}

/**
 * 隐藏加载
 */
function hideLoading() {
  wx.hideLoading()
}

/**
 * 确认对话框
 */
function showConfirm(title, content) {
  return new Promise((resolve) => {
    wx.showModal({
      title: title,
      content: content,
      confirmText: '确定',
      cancelText: '取消',
      success: (res) => resolve(res.confirm)
    })
  })
}

/**
 * 调用云函数的统一封装（含自动重试）
 * 网络错误自动重试最多2次，业务错误不重试
 */
function callCloud(name, data, _retryCount) {
  var retries = _retryCount || 0
  var maxRetries = 2
  return new Promise(function(resolve, reject) {
    var user = null
    try {
      user = getStoredUser()
    } catch (e) {
      user = null
    }

    var payload = Object.assign({}, data || {})
    if (user && user._id) {
      payload.auth_user_id = user._id
    }
    if (user && user.session_token) {
      payload.auth_session_token = user.session_token
    }

    wx.cloud.callFunction({
      name: name,
      data: payload
    }).then(function(res) {
      console.log('[callCloud] ' + name + ' result:', JSON.stringify(res.result))
      try {
        resolve(resolveCloudCallResult(res.result))
      } catch (err) {
        reject(err)
      }
    }).catch(function(err) {
      console.error('云函数 ' + name + ' 调用失败 (attempt ' + (retries + 1) + '):', err)
      if (retries < maxRetries) {
        // 网络错误自动重试，指数退避
        var delay = Math.pow(2, retries) * 500
        setTimeout(function() {
          callCloud(name, data, retries + 1).then(resolve).catch(reject)
        }, delay)
      } else {
        reject(new Error('网络错误，请检查网络后重试'))
      }
    })
  })
}

function resolveCloudCallResult(result) {
  if (result && (result.code === 0 || result.code === -2)) {
    return result
  }
  var errMsg = (result && result.msg) || '操作失败，请重试'
  throw new Error(errMsg)
}

/**
 * 金额格式化（保留2位小数）
 */
function formatMoney(num) {
  const n = Number(num)
  return Number.isFinite(n) ? n.toFixed(2) : '0.00'
}

/**
 * 数量格式化
 */
function formatQty(num) {
  if (num === null || num === undefined) return '0'
  return String(num)
}

/**
 * 获取今天的日期字符串 YYYY-MM-DD（北京时间）
 */
function getToday() {
  return bjTime.getBeijingToday()
}

/**
 * 判断是否是同一天（北京时间）
 */
function isSameDay(date1, date2) {
  return bjTime.isSameBeijingDay(date1, date2)
}

/**
 * 手机号校验
 */
function isValidPhone(phone) {
  return /^1[3-9]\d{9}$/.test(phone)
}

/**
 * 去除字符串首尾空格
 */
function trim(str) {
  return str ? str.replace(/^\s+|\s+$/g, '') : ''
}

/**
 * 判断员工是否可查看某订单的工价
 * @param {Object} order - 订单对象，需含 price_hidden / salaryPaid 等字段
 * @param {string} userRole - 当前用户角色 'boss' | 'employee' | 'qc'
 * @returns {boolean} true = 可查看工价
 */
function canEmployeeViewOrderPrice(order, userRole) {
  if (userRole === 'boss') return true
  if (!order) return true
  if (order.price_hidden === true) return false
  if (order.salary_paid === true) return false
  return true
}

module.exports = {
  formatDate,
  formatTime,
  formatDateTime,
  getMonthStart,
  getMonthEnd,
  calcHours,
  showSuccess,
  showError,
  showLoading,
  hideLoading,
  showConfirm,
  callCloud,
  resolveCloudCallResult,
  formatMoney,
  formatQty,
  getToday,
  isSameDay,
  isValidPhone,
  trim,
  canEmployeeViewOrderPrice
}
