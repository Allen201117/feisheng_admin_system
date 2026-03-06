// util.js - 通用工具函数

/**
 * 格式化日期为 YYYY-MM-DD
 */
function formatDate(date) {
  if (!date) return ''
  const d = new Date(date)
  const year = d.getFullYear()
  const month = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/**
 * 格式化时间为 HH:mm:ss
 */
function formatTime(date) {
  if (!date) return ''
  const d = new Date(date)
  const hours = String(d.getHours()).padStart(2, '0')
  const minutes = String(d.getMinutes()).padStart(2, '0')
  const seconds = String(d.getSeconds()).padStart(2, '0')
  return `${hours}:${minutes}:${seconds}`
}

/**
 * 格式化日期时间为 YYYY-MM-DD HH:mm
 */
function formatDateTime(date) {
  if (!date) return ''
  return formatDate(date) + ' ' + formatTime(date).substring(0, 5)
}

/**
 * 获取当月第一天 YYYY-MM-01
 */
function getMonthStart(date) {
  const d = date ? new Date(date) : new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`
}

/**
 * 获取当月最后一天
 */
function getMonthEnd(date) {
  const d = date ? new Date(date) : new Date()
  const lastDay = new Date(d.getFullYear(), d.getMonth() + 1, 0)
  return formatDate(lastDay)
}

/**
 * 计算两个时间之间的小时数
 */
function calcHours(startTime, endTime) {
  if (!startTime || !endTime) return 0
  const start = new Date(startTime).getTime()
  const end = new Date(endTime).getTime()
  if (end <= start) return 0
  return Math.round((end - start) / (1000 * 60 * 60) * 100) / 100
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
    wx.cloud.callFunction({
      name: name,
      data: data
    }).then(function(res) {
      console.log('[callCloud] ' + name + ' result:', JSON.stringify(res.result))
      if (res.result && res.result.code === 0) {
        resolve(res.result)
      } else {
        var errMsg = (res.result && res.result.msg) || '操作失败，请重试'
        reject(new Error(errMsg))
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

/**
 * 金额格式化（保留2位小数）
 */
function formatMoney(num) {
  if (num === null || num === undefined) return '0.00'
  return Number(num).toFixed(2)
}

/**
 * 数量格式化
 */
function formatQty(num) {
  if (num === null || num === undefined) return '0'
  return String(num)
}

/**
 * 获取今天的日期字符串 YYYY-MM-DD
 */
function getToday() {
  return formatDate(new Date())
}

/**
 * 判断是否是同一天
 */
function isSameDay(date1, date2) {
  return formatDate(date1) === formatDate(date2)
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
  formatMoney,
  formatQty,
  getToday,
  isSameDay,
  isValidPhone,
  trim
}
