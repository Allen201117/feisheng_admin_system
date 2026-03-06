// pages/boss/employees/employees.js
var util = require('../../../utils/util')
var callCloud = util.callCloud
var showError = util.showError
var showSuccess = util.showSuccess
var showLoading = util.showLoading
var hideLoading = util.hideLoading
var showConfirm = util.showConfirm
var config = require('../../../utils/config')

Page({
  data: {
    employees: [],
    loading: false,
    filterRole: 'all'
  },

  onShow: function() {
    this.loadEmployees()
  },

  onPullDownRefresh: function() {
    var that = this
    this.loadEmployees().then(function() { wx.stopPullDownRefresh() })
  },

  loadEmployees: function() {
    var that = this
    this.setData({ loading: true })
    return callCloud('user', { action: 'list' }).then(function(res) {
      var employees = res.data || []
      employees = employees.map(function(e) {
        return {
          _id: e._id,
          name: e.name,
          phone: e.phone,
          role: e.role,
          status: e.status,
          role_name: config.ROLE_NAMES[e.role] || e.role,
          status_text: e.status === 'active' ? '正常' : '已停用',
          join_date: e.join_date || ''
        }
      })
      that.setData({ employees: employees })
    }).catch(function() {
      showError('加载员工列表失败')
    }).then(function() {
      that.setData({ loading: false })
    })
  },

  goAddEmployee: function() {
    wx.navigateTo({ url: '/pages/boss/employee-edit/employee-edit' })
  },

  goEditEmployee: function(e) {
    var id = e.currentTarget.dataset.id
    wx.navigateTo({ url: '/pages/boss/employee-edit/employee-edit?id=' + id })
  },

  toggleStatus: function(e) {
    var that = this
    var emp = e.currentTarget.dataset.emp
    var newStatus = emp.status === 'active' ? 'disabled' : 'active'
    var actionText = newStatus === 'active' ? '启用' : '停用'

    showConfirm('确认操作', '确定' + actionText + '员工 "' + emp.name + '" 吗？').then(function(confirmed) {
      if (!confirmed) return
      showLoading('操作中...')
      return callCloud('user', {
        action: 'updateStatus',
        user_id: emp._id,
        status: newStatus
      }).then(function() {
        hideLoading()
        showSuccess('已' + actionText)
        that.loadEmployees()
      }).catch(function(err) {
        hideLoading()
        showError(err.message || '操作失败')
      })
    })
  },

  // 重置密码
  resetPassword: function(e) {
    var that = this
    var emp = e.currentTarget.dataset.emp
    showConfirm('重置密码', '确定将 "' + emp.name + '" 的密码重置为手机号？\n该员工将被强制下线，下次登录须修改密码。').then(function(confirmed) {
      if (!confirmed) return
      showLoading('重置中...')
      return callCloud('user', {
        action: 'resetPassword',
        user_id: emp._id,
        reason: '管理员手动重置'
      }).then(function() {
        hideLoading()
        showSuccess('密码已重置')
      }).catch(function(err) {
        hideLoading()
        showError(err.message || '重置失败')
      })
    })
  }
})
