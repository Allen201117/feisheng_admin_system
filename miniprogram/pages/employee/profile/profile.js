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
    payrollMode: 'monthly',
    salaryPeriodLabel: '',
    statisticsTitle: '本月统计',
    pieceRateLabel: '计件工资',
    outputLabel: '合格产出',
    passRateLabel: '合格率',
    monthlySalary: '0.00',
    monthlyHours: '0.0',
    monthlyOutput: 0,
    passRate: '0',
    adjustments: [],
    totalAdjustment: '0.00',
    finalSalary: '0.00',
    attendanceRecords: [],
    paymentRecords: [],
    orderSummaries: [],
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
    var bjTime = require('../../../utils/beijing-time')
    var f = bjTime.getBeijingFields()
    this.setData({
      userInfo: user,
      currentMonth: f.year + '年' + f.month + '月',
      salaryPeriodLabel: f.year + '年' + f.month + '月'
    })
  },

  onShow: function() {
    this.loadSalaryData()
    this.loadPaymentRecords()
    this.loadAttendance()
  },

  loadSalaryData: function() {
    var that = this
    callCloud('salary', {
      action: 'getUserPayrollSalary',
      user_id: this.data.userInfo._id
    }).then(function(res) {
      var data = res.data || {}
      var payrollMode = data.payroll_mode === 'order' ? 'order' : 'monthly'
      var isOrderMode = payrollMode === 'order'
      var salaryPeriodLabel = isOrderMode ? '按订单' : that.data.currentMonth
      var orderSummaries = (data.order_summaries || []).map(function(item) {
        return {
          ...item,
          amount_display: item.has_hidden_amount ? '已隐藏' : formatMoney(item.amount || 0),
          quantity_display: (item.quantity || 0) + ' 件',
          detail_display: (item.detail_count || 0) + ' 条明细'
        }
      })

      if (data.is_paid) {
        // 已发薪 — 脱敏模式：无 piece_rate / logs / work_stats.total_quantity / total_passed / pass_rate
        var ws = data.work_stats || {}
        that.setData({
          isPaid: true,
          payrollMode: payrollMode,
          salaryPeriodLabel: salaryPeriodLabel,
          statisticsTitle: isOrderMode ? '订单统计' : '本月统计',
          pieceRateLabel: isOrderMode ? '订单计件工资' : '计件工资',
          outputLabel: isOrderMode ? '订单产出' : '产出(已归档)',
          passRateLabel: isOrderMode ? '订单合格率' : '合格率(已归档)',
          paidAt: data.paid_at || '',
          finalSalary: formatMoney(data.total || 0),
          monthlyHours: (ws.total_hours || 0).toFixed(1),
          monthlySalary: '--',
          monthlyOutput: '--',
          passRate: '--',
          orderSummaries: orderSummaries,
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
          payrollMode: payrollMode,
          salaryPeriodLabel: salaryPeriodLabel,
          statisticsTitle: isOrderMode ? '订单统计' : '本月统计',
          pieceRateLabel: isOrderMode ? '订单计件工资' : '计件工资',
          outputLabel: isOrderMode ? '订单产出' : '合格产出',
          passRateLabel: isOrderMode ? '订单合格率' : '合格率',
          paidAt: '',
          monthlySalary: formatMoney(pieceRate),
          monthlyHours: (ws2.total_hours || 0).toFixed(1),
          monthlyOutput: ws2.total_quantity || 0,
          passRate: (ws2.pass_rate || 0).toFixed(1),
          orderSummaries: orderSummaries,
          adjustments: data.adjustments || [],
          totalAdjustment: formatMoney(reward - penalty),
          finalSalary: formatMoney(data.total || 0)
        })
      }
    }).catch(function(e) {
      console.error('加载薪资数据失败', e)
    })
  },

  loadPaymentRecords: function() {
    var that = this
    callCloud('salary', {
      action: 'getUserPaymentRecords',
      user_id: this.data.userInfo._id
    }).then(function(res) {
      var records = (res.data || []).map(function(item) {
        var label = item.payroll_type === 'order'
          ? (item.order_name || '订单发薪')
          : ((item.month || '') + ' 月度发薪')
        return {
          ...item,
          label: label,
          amount_display: item.total_amount === undefined || item.total_amount === null ? '--' : formatMoney(item.total_amount)
        }
      })
      that.setData({ paymentRecords: records })
    }).catch(function(e) {
      console.error('加载历史发薪记录失败', e)
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
