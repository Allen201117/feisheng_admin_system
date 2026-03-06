// pages/login/login.js
var util = require('../../utils/util')
var callCloud = util.callCloud
var showError = util.showError
var showSuccess = util.showSuccess
var showLoading = util.showLoading
var hideLoading = util.hideLoading
var trim = util.trim
var isValidPhone = util.isValidPhone
var auth = require('../../utils/auth')
var storeUser = auth.storeUser
var getStoredUser = auth.getStoredUser
var privacy = require('../../utils/privacy')
var markConsentAccepted = privacy.markConsentAccepted
var app = getApp()

Page({
  data: {
    name: '',
    phone: '',
    password: '',
    loading: false,
    showPassword: false,
    // 强制改密弹窗
    showChangePwd: false,
    changePwdData: {
      oldPassword: '',
      newPassword: '',
      confirmPassword: ''
    },
    showNewPwd: false,
    changePwdLoading: false,
    consentVersion: '',
    consentChecked: false,
    hasCurrentConsent: false,
    needConsentDialog: false,
    existingUser: null,
    // 临时存储登录返回的用户信�?
    _pendingUser: null
  },

  onLoad: function(options) {
    var existingUser = getStoredUser()
    this.setData({ existingUser: existingUser || null })
    this.loadConsentStatus()

    var qrId = ''

    if (options.scene) {
      try {
        var scene = decodeURIComponent(options.scene)
        wx.setStorageSync('scan_scene', scene)
        qrId = this.parseQrIdFromScene(scene)
      } catch (e) {
        console.error('解析场景值失�?, e)
      }
    }

    if (!qrId && options.q) {
      qrId = trim(options.q)
    }

    if (!qrId && options.qr_id) {
      qrId = trim(options.qr_id)
    }

    if (qrId) {
      this.handleScanQrId(qrId)
    }

    if (options.source === 'scan') {
      wx.setStorageSync('clock_source', 'qrcode')
    }
  },

  parseQrIdFromScene: function(scene) {
    if (!scene) return ''
    var match = /(?:^|&)q=([^&]+)/.exec(scene)
    return match && match[1] ? match[1] : ''
  },

  handleScanQrId: function(qrId) {
    if (!qrId) return

    callCloud('qrcode', {
      action: 'verify',
      qr_id: qrId
    }).then(function() {
      wx.setStorageSync('clock_source', 'qrcode')
      wx.setStorageSync('scan_qr_token', qrId)
    }).catch(function(err) {
      wx.removeStorageSync('scan_qr_token')
      wx.removeStorageSync('clock_source')
      wx.showModal({
        title: '扫码状态异�?,
        content: err.message || '二维码已失效，请联系管理员重新生�?,
        showCancel: false
      })
      console.error('[scan verify failed]', err)
    })
  },

  loadConsentStatus: function() {
    var that = this
    callCloud('login', { action: 'getConsentStatus' }).then(function(res) {
      var data = res.data || {}
      var hasConsent = !!data.has_consent
      that.setData({
        consentVersion: data.consent_version || '',
        hasCurrentConsent: hasConsent,
        needConsentDialog: !hasConsent,
        consentChecked: hasConsent
      })
      if (hasConsent) {
        markConsentAccepted()
      }
    }).catch(function() {
      that.setData({
        hasCurrentConsent: false,
        needConsentDialog: true,
        consentChecked: false
      })
    })
  },

  onConsentCheck: function(e) {
    this.setData({ consentChecked: !!e.detail.value.length })
  },

  openPrivacyPolicy: function() {
    wx.navigateTo({ url: '/pages/privacy-policy/privacy-policy' })
  },

  openUserAgreement: function() {
    wx.navigateTo({ url: '/pages/user-agreement/user-agreement' })
  },

  onConfirmConsent: function() {
    var that = this
    if (!this.data.consentChecked) {
      showError('请勾选同意后继续')
      return
    }

    showLoading('提交�?..')
    callCloud('login', {
      action: 'recordConsent',
      agreed: true,
      channel: 'login_popup',
      client_ts: Date.now()
    }).then(function() {
      hideLoading()
      markConsentAccepted()
      that.setData({
        hasCurrentConsent: true,
        needConsentDialog: false
      })
      showSuccess('已完成协议确�?)
    }).catch(function(err) {
      hideLoading()
      showError(err.message || '提交失败')
    })
  },

  onContinueWithoutConsent: function() {
    showError('未同意协议前无法使用登录和手机号相关功能')
  },

  onInputName: function(e) {
    this.setData({ name: e.detail.value })
  },

  onInputPhone: function(e) {
    this.setData({ phone: e.detail.value })
  },

  onInputPassword: function(e) {
    this.setData({ password: e.detail.value })
  },

  togglePassword: function() {
    this.setData({ showPassword: !this.data.showPassword })
  },

  onLogin: function() {
    var that = this
    var name = trim(this.data.name)
    var phone = trim(this.data.phone)
    var password = this.data.password

    if (!this.data.hasCurrentConsent) {
      this.setData({ needConsentDialog: true })
      showError('请先同意隐私政策与用户协�?)
      return
    }

    if (!name) { showError('请输入姓�?); return }
    if (!phone) { showError('请输入手机号'); return }
    if (!isValidPhone(phone)) { showError('手机号格式不正确'); return }
    if (!password) { showError('请输入密�?); return }

    this.setData({ loading: true })
    showLoading('登录�?..')

    callCloud('login', {
      action: 'login',
      name: name,
      phone: phone,
      password: password
    }).then(function(res) {
      hideLoading()
      if (res.data) {
        // 检查是否需要强制改�?
        if (res.data.need_change_password) {
          that.setData({
            showChangePwd: true,
            _pendingUser: res.data,
            changePwdData: { oldPassword: '', newPassword: '', confirmPassword: '' }
          })
        } else {
          that._finishLogin(res.data)
        }
      }
    }).catch(function(err) {
      hideLoading()
      showError(err.message || '登录失败')
    }).then(function() {
      that.setData({ loading: false })
    })
  },

  _finishLogin: function(userData) {
    storeUser(userData)
    markConsentAccepted()
    app.globalData.userInfo = userData
    app.globalData.isLoggedIn = true
    app.routeByRole(userData.role)
  },

  onQuickEnterStored: function() {
    if (!this.data.existingUser || !this.data.existingUser.role) {
      showError('暂无可用登录�?)
      return
    }
    if (!this.data.hasCurrentConsent) {
      this.setData({ needConsentDialog: true })
      showError('请先同意隐私政策与用户协�?)
      return
    }
    app.routeByRole(this.data.existingUser.role)
  },

  onEnterDemo: function() {
    wx.navigateTo({ url: '/pages/review/home/home' })
  },

  // ========== 强制改密弹窗 ==========
  onOldPwdInput: function(e) {
    this.setData({ 'changePwdData.oldPassword': e.detail.value })
  },

  onNewPwdInput: function(e) {
    this.setData({ 'changePwdData.newPassword': e.detail.value })
  },

  onConfirmPwdInput: function(e) {
    this.setData({ 'changePwdData.confirmPassword': e.detail.value })
  },

  toggleNewPwd: function() {
    this.setData({ showNewPwd: !this.data.showNewPwd })
  },

  onSubmitChangePwd: function() {
    var that = this
    var d = this.data.changePwdData
    if (!d.oldPassword) { showError('请输入旧密码'); return }
    if (!d.newPassword) { showError('请输入新密码'); return }
    if (d.newPassword.length < 8) { showError('新密码至�?�?); return }
    if (!/[a-zA-Z]/.test(d.newPassword)) { showError('新密码需包含字母'); return }
    if (!/[0-9]/.test(d.newPassword)) { showError('新密码需包含数字'); return }
    if (d.newPassword !== d.confirmPassword) { showError('两次输入不一�?); return }
    if (d.newPassword === d.oldPassword) { showError('新旧密码不能相同'); return }

    this.setData({ changePwdLoading: true })
    showLoading('修改密码...')

    var pendingUser = this.data._pendingUser
    callCloud('login', {
      action: 'changePassword',
      user_id: pendingUser._id,
      old_password: d.oldPassword,
      new_password: d.newPassword
    }).then(function(res) {
      hideLoading()
      showSuccess('密码修改成功')
      that.setData({ showChangePwd: false })
      // 修改成功后自动完成登�?
      if (res.data) {
        // 用新 token 更新用户信息
        pendingUser.session_token = res.data.session_token || pendingUser.session_token
        pendingUser.need_change_password = false
      }
      that._finishLogin(pendingUser)
    }).catch(function(err) {
      hideLoading()
      showError(err.message || '修改失败')
    }).then(function() {
      that.setData({ changePwdLoading: false })
    })
  },

  onCancelChangePwd: function() {
    // 强制改密不可取消，提示用�?
    showError('首次登录必须修改密码')
  }
})
