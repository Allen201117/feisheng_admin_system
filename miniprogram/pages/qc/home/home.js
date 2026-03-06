// pages/qc/home/home.js
const { callCloud, showError, formatDateTime, getToday } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const app = getApp()

Page({
  data: {
    userInfo: null,
    pendingLogs: [],
    inspectedLogs: [],
    activeTab: 'pending',
    todayDate: '',
    loading: false
  },

  onLoad() {
    const user = getStoredUser()
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    // 管理员和质检员都可以访问此页面
    if (user.role !== 'qc' && user.role !== 'boss') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({
      userInfo: user,
      todayDate: getToday()
    })
  },

  onShow() {
    this.loadPendingLogs()
    this.loadInspectedLogs()
  },

  onPullDownRefresh() {
    Promise.all([this.loadPendingLogs(), this.loadInspectedLogs()])
      .finally(() => wx.stopPullDownRefresh())
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab })
  },

  async loadPendingLogs() {
    try {
      const res = await callCloud('worklog', {
        action: 'getPendingLogs'
      })
      const logs = (res.data || []).map(log => ({
        ...log,
        created_at_display: log.date || ''
      }))
      this.setData({ pendingLogs: logs })
    } catch (e) {
      console.error('加载待质检记录失败', e)
    }
  },

  async loadInspectedLogs() {
    try {
      const res = await callCloud('worklog', {
        action: 'getInspectedLogs'
      })
      const logs = (res.data || []).map(log => ({
        ...log,
        created_at_display: log.date || '',
        pass_rate: log.quantity > 0 ? Math.round((log.passed_qty || 0) / log.quantity * 100) : 0
      }))
      this.setData({ inspectedLogs: logs })
    } catch (e) {
      console.error('加载已质检记录失败', e)
    }
  },

  goInspect(e) {
    const logId = e.currentTarget.dataset.id
    wx.navigateTo({
      url: `/pages/qc/inspect/inspect?id=${logId}`
    })
  },

  goBack() {
    wx.navigateBack()
  },

  onLogout() {
    app.logout()
  }
})
