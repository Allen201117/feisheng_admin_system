// pages/boss/settings/settings.js
var util = require('../../../utils/util')
var callCloud = util.callCloud
var showError = util.showError
var showSuccess = util.showSuccess
var showLoading = util.showLoading
var hideLoading = util.hideLoading
var auth = require('../../../utils/auth')
var getStoredUser = auth.getStoredUser

Page({
  data: {
    factory_latitude: '',
    factory_longitude: '',
    geofence_radius: '100',
    quality_threshold: '95',
    export_email: 'hanyifan424@gmail.com',
    qrcode_expire_days: '1',
    allow_home_checkin: false,
    smtp_host: '',
    smtp_port: '465',
    smtp_user: '',
    smtp_pass: '',
    loading: false,
    loaded: false
  },

  onShow: function() {
    this.loadSettings()
  },

  loadSettings: function() {
    var that = this
    callCloud('settings', { action: 'getAll' }).then(function(res) {
      if (res.data) {
        var s = res.data
        that.setData({
          factory_latitude: String(s.factory_latitude || ''),
          factory_longitude: String(s.factory_longitude || ''),
          geofence_radius: String(s.geofence_radius || 100),
          quality_threshold: String(s.quality_threshold || 95),
          export_email: s.export_email || 'hanyifan424@gmail.com',
          qrcode_expire_days: String(s.qrcode_expire_days || 1),
          allow_home_checkin: !!s.allow_home_checkin,
          smtp_host: s.smtp_host || '',
          smtp_port: String(s.smtp_port || 465),
          smtp_user: s.smtp_user || '',
          smtp_pass: s.smtp_pass || '',
          loaded: true
        })
      }
    }).catch(function() {
      showError('加载设置失败')
    })
  },

  onInput: function(e) {
    var field = e.currentTarget.dataset.field
    var obj = {}
    obj[field] = e.detail.value
    this.setData(obj)
  },

  onSwitchChange: function(e) {
    var field = e.currentTarget.dataset.field
    var obj = {}
    obj[field] = e.detail.value
    this.setData(obj)
  },

  onSave: function() {
    var that = this
    var lat = parseFloat(this.data.factory_latitude)
    var lng = parseFloat(this.data.factory_longitude)
    if (this.data.factory_latitude && (isNaN(lat) || lat < -90 || lat > 90)) {
      showError('纬度范围应在 -90 到 90 之间')
      return
    }
    if (this.data.factory_longitude && (isNaN(lng) || lng < -180 || lng > 180)) {
      showError('经度范围应在 -180 到 180 之间')
      return
    }

    this.setData({ loading: true })
    showLoading('保存中...')

    callCloud('settings', {
      action: 'save',
      factory_latitude: lat || 0,
      factory_longitude: lng || 0,
      geofence_radius: parseInt(this.data.geofence_radius) || 100,
      quality_threshold: parseInt(this.data.quality_threshold) || 95,
      export_email: this.data.export_email,
      qrcode_expire_days: parseInt(this.data.qrcode_expire_days) || 1,
      allow_home_checkin: this.data.allow_home_checkin,
      smtp_host: this.data.smtp_host,
      smtp_port: parseInt(this.data.smtp_port) || 465,
      smtp_user: this.data.smtp_user,
      smtp_pass: this.data.smtp_pass
    }).then(function() {
      hideLoading()
      showSuccess('保存成功')
    }).catch(function(err) {
      hideLoading()
      showError(err.message || '保存失败')
    }).then(function() {
      that.setData({ loading: false })
    })
  },

  getLocation: function() {
    var that = this
    wx.getFuzzyLocation({
      type: 'wgs84',
      success: function(loc) {
        that.setData({
          factory_latitude: loc.latitude.toFixed(6),
          factory_longitude: loc.longitude.toFixed(6)
        })
        showSuccess('已获取当前位置')
      },
      fail: function() {
        showError('获取位置失败，请检查权限')
      }
    })
  },

  goPrivacyPolicy: function() {
    wx.navigateTo({ url: '/pages/privacy-policy/privacy-policy' })
  },

  goUserAgreement: function() {
    wx.navigateTo({ url: '/pages/user-agreement/user-agreement' })
  }
})