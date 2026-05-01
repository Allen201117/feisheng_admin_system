const { callCloud, showError, showSuccess, showLoading, hideLoading } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const ADMIN_WECHAT_QR = '/images/admin-wechat-qr.jpg'

Page({
  data: {
    userInfo: null,
    subscription: null,
    requestInfoText: '',
    support: null,
    adminWechatQr: ADMIN_WECHAT_QR,
    showContactQr: false,
    loading: false,
    statusClass: 'status-normal'
  },

  onLoad() {
    const user = getStoredUser()
    if (!user || user.role !== 'boss') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({ userInfo: user })
  },

  onShow() {
    this.loadSubscription()
  },

  onPullDownRefresh() {
    this.loadSubscription().finally(() => wx.stopPullDownRefresh())
  },

  async loadSubscription() {
    this.setData({ loading: true })
    showLoading('加载中...')
    try {
      const res = await callCloud('billing', { action: 'getMySubscription' })
      const subscription = res.data.subscription || null
      const status = subscription ? subscription.billing_status : 'unknown'
      this.setData({
        subscription,
        requestInfoText: res.data.request_info_text || '',
        support: res.data.support || null,
        statusClass: status === 'expired' ? 'status-expired' : status === 'grace' ? 'status-grace' : status === 'trial' ? 'status-trial' : 'status-normal'
      })
    } catch (err) {
      showError(err.message || '加载服务状态失败')
    } finally {
      hideLoading()
      this.setData({ loading: false })
    }
  },

  copyOpenInfo() {
    const text = this.data.requestInfoText
    if (!text) {
      showError('暂无可复制信息')
      return
    }
    wx.setClipboardData({
      data: text,
      success: () => showSuccess('已复制')
    })
  },

  showContactTip() {
    this.setData({ showContactQr: true })
  },

  hideContactQr() {
    this.setData({ showContactQr: false })
  },

  stopBubble() {},

  previewContactQr() {
    wx.previewImage({
      current: ADMIN_WECHAT_QR,
      urls: [ADMIN_WECHAT_QR]
    })
  }
})
