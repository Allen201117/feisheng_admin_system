// pages/boss/home/home.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, formatMoney, getToday } = require('../../../utils/util')
const { getStoredUser, clearUser } = require('../../../utils/auth')
const app = getApp()

Page({
  data: {
    userInfo: null,
    todayDate: '',
    stats: {
      totalEmployees: 0,
      todayAttendance: 0,
      activeOrders: 0,
      pendingQC: 0,
      monthSalary: '0.00'
    },
    // 修改密码
    showChangePwd: false,
    changePwdData: { oldPassword: '', newPassword: '', confirmPassword: '' },
    showOldPwd: false,
    showNewPwd: false,
    changePwdLoading: false
  },

  onLoad() {
    const user = getStoredUser()
    if (!user || user.role !== 'boss') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({
      userInfo: user,
      todayDate: getToday()
    })
  },

  onShow() {
    this.loadDashboard()
  },

  onPullDownRefresh() {
    this.loadDashboard().finally(() => wx.stopPullDownRefresh())
  },

  async loadDashboard() {
    try {
      const res = await callCloud('salary', {
        action: 'getDashboard'
      })
      if (res.data) {
        this.setData({
          stats: {
            totalEmployees: res.data.employee_count || 0,
            todayAttendance: res.data.today_attendance || 0,
            activeOrders: res.data.active_orders || 0,
            pendingQC: res.data.pending_qc || 0,
            monthSalary: formatMoney(res.data.monthly_salary || 0)
          }
        })
      }
    } catch (e) {
      console.error('加载仪表盘失败', e)
      if (e && e.message && e.message.includes('权限不足')) {
        clearUser()
        showError('登录态已失效，请重新登录')
        setTimeout(() => {
          wx.reLaunch({ url: '/pages/login/login' })
        }, 400)
      }
    }
  },

  goTo(e) {
    const page = e.currentTarget.dataset.page
    wx.navigateTo({ url: `/pages/boss/${page}/${page}` })
  },

  goToQC() {
    wx.navigateTo({ url: '/pages/qc/home/home' })
  },

  onLogout() {
    app.logout()
  },

  // ========== 修改密码 ==========
  openChangePwd() {
    this.setData({
      showChangePwd: true,
      changePwdData: { oldPassword: '', newPassword: '', confirmPassword: '' }
    })
  },

  closeChangePwd() {
    this.setData({ showChangePwd: false })
  },

  onOldPwdInput(e) {
    this.setData({ 'changePwdData.oldPassword': e.detail.value })
  },

  onNewPwdInput(e) {
    this.setData({ 'changePwdData.newPassword': e.detail.value })
  },

  onConfirmPwdInput(e) {
    this.setData({ 'changePwdData.confirmPassword': e.detail.value })
  },

  toggleOldPwd() {
    this.setData({ showOldPwd: !this.data.showOldPwd })
  },

  toggleNewPwd() {
    this.setData({ showNewPwd: !this.data.showNewPwd })
  },

  onSubmitChangePwd() {
    const d = this.data.changePwdData
    if (!d.oldPassword) { showError('请输入旧密码'); return }
    if (!d.newPassword) { showError('请输入新密码'); return }
    if (d.newPassword.length < 8) { showError('新密码至少8位'); return }
    if (!/[a-zA-Z]/.test(d.newPassword)) { showError('新密码需包含字母'); return }
    if (!/[0-9]/.test(d.newPassword)) { showError('新密码需包含数字'); return }
    if (d.newPassword !== d.confirmPassword) { showError('两次输入不一致'); return }
    if (d.newPassword === d.oldPassword) { showError('新旧密码不能相同'); return }

    this.setData({ changePwdLoading: true })
    showLoading('修改密码...')

    callCloud('login', {
      action: 'changePassword',
      user_id: this.data.userInfo._id,
      old_password: d.oldPassword,
      new_password: d.newPassword
    }).then(() => {
      hideLoading()
      showSuccess('密码修改成功')
      this.setData({ showChangePwd: false })
    }).catch((err) => {
      hideLoading()
      showError(err.message || '修改失败')
    }).then(() => {
      this.setData({ changePwdLoading: false })
    })
  }
})
