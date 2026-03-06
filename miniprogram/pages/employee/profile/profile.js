// pages/employee/profile/profile.js
var util = require('../../../utils/util')
var callCloud = util.callCloud
var formatMoney = util.formatMoney
var showError = util.showError
var showSuccess = util.showSuccess
var showLoading = util.showLoading
var hideLoading = util.hideLoading
var auth = require('../../../utils/auth')
var getStoredUser = auth.getStoredUser

Page({
  data: {
    userInfo: null,
    currentMonth: '',
    monthlySalary: '0.00',
    monthlyHours: '0.0',
    monthlyOutput: 0,
    passRate: '0',
    adjustments: [],
    totalAdjustment: '0.00',
    finalSalary: '0.00',
    attendanceRecords: [],
    showAttendance: false,
    // 已发薪隐私标记
    isPaid: false,
    paidAt: '',
    // 修改密码
    showChangePwd: false,
    changePwdData: { oldPassword: '', newPassword: '', confirmPassword: '' },
    showOldPwd: false,
    showNewPwd: false,
    changePwdLoading: false
  },

  onLoad: function() {
    var user = getStoredUser()
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    var now = new Date()
    this.setData({
      userInfo: user,
      currentMonth: now.getFullYear() + '年' + (now.getMonth() + 1) + '月'
    })
  },

  onShow: function() {
    this.loadSalaryData()
    this.loadAttendance()
  },

  loadSalaryData: function() {
    var that = this
    callCloud('salary', {
      action: 'getUserMonthlySalary',
      user_id: this.data.userInfo._id
    }).then(function(res) {
      var data = res.data || {}

      if (data.is_paid) {
        // 已发薪 — 脱敏模式：无 piece_rate / logs / work_stats.total_quantity / total_passed / pass_rate
        var ws = data.work_stats || {}
        that.setData({
          isPaid: true,
          paidAt: data.paid_at || '',
          finalSalary: formatMoney(data.total || 0),
          monthlyHours: (ws.total_hours || 0).toFixed(1),
          monthlySalary: '--',
          monthlyOutput: '--',
          passRate: '--',
          adjustments: data.adjustments || [],
          totalAdjustment: formatMoney((data.reward || 0) - (data.penalty || 0))
        })
      } else {
        // 未发薪 — 完整数据
        var pieceRate = data.piece_rate || 0
        var reward = data.reward || 0
        var penalty = data.penalty || 0
        var ws2 = data.work_stats || {}
        that.setData({
          isPaid: false,
          paidAt: '',
          monthlySalary: formatMoney(pieceRate),
          monthlyHours: (ws2.total_hours || 0).toFixed(1),
          monthlyOutput: ws2.total_quantity || 0,
          passRate: (ws2.pass_rate || 0).toFixed(1),
          adjustments: data.adjustments || [],
          totalAdjustment: formatMoney(reward - penalty),
          finalSalary: formatMoney(data.total || 0)
        })
      }
    }).catch(function(e) {
      console.error('加载薪资数据失败', e)
    })
  },

  loadAttendance: function() {
    var that = this
    callCloud('attendance', {
      action: 'getUserMonthlyRecords',
      user_id: this.data.userInfo._id
    }).then(function(res) {
      that.setData({ attendanceRecords: res.data || [] })
    }).catch(function(e) {
      console.error('加载考勤失败', e)
    })
  },

  toggleAttendance: function() {
    this.setData({ showAttendance: !this.data.showAttendance })
  },

  // ========== 修改密码 ==========
  openChangePwd: function() {
    this.setData({
      showChangePwd: true,
      changePwdData: { oldPassword: '', newPassword: '', confirmPassword: '' }
    })
  },

  closeChangePwd: function() {
    this.setData({ showChangePwd: false })
  },

  onOldPwdInput: function(e) {
    this.setData({ 'changePwdData.oldPassword': e.detail.value })
  },

  onNewPwdInput: function(e) {
    this.setData({ 'changePwdData.newPassword': e.detail.value })
  },

  onConfirmPwdInput: function(e) {
    this.setData({ 'changePwdData.confirmPassword': e.detail.value })
  },

  toggleOldPwd: function() {
    this.setData({ showOldPwd: !this.data.showOldPwd })
  },

  toggleNewPwd: function() {
    this.setData({ showNewPwd: !this.data.showNewPwd })
  },

  onSubmitChangePwd: function() {
    var that = this
    var d = this.data.changePwdData
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
    }).then(function() {
      hideLoading()
      showSuccess('密码修改成功')
      that.setData({ showChangePwd: false })
    }).catch(function(err) {
      hideLoading()
      showError(err.message || '修改失败')
    }).then(function() {
      that.setData({ changePwdLoading: false })
    })
  },

  goPrivacyPolicy: function() {
    wx.navigateTo({ url: '/pages/privacy-policy/privacy-policy' })
  },

  goUserAgreement: function() {
    wx.navigateTo({ url: '/pages/user-agreement/user-agreement' })
  }
})
