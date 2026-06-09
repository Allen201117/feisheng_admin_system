// pages/boss/settings/settings.js
const {
  callCloud,
  showError,
  showSuccess,
  showLoading,
  hideLoading
} = require('../../../utils/util')
const {
  sampleLocationAndPickBest,
  isValidCoordinate,
  isInChinaMainland,
  checkLocationPermission
} = require('../../../utils/location')
const {
  canSaveSettings,
  createCheckpointDraft,
  buildCheckpointPayload,
  normalizePayrollMode
} = require('./settings.logic')

Page({
  data: {
    factory_latitude: '',
    factory_longitude: '',
    geofence_radius: '100',
    quality_threshold: '95',
    export_email: 'hanyifan424@gmail.com',
    qrcode_expire_days: '1',
    allow_home_checkin: false,
    leaderboard_visible: false,
    salary_payroll_mode: 'monthly',
    smtp_host: '',
    smtp_port: '465',
    smtp_user: '',
    smtp_pass: '',
    loading: false,
    loaded: false,
    // 定位采样状态
    locating: false,
    locationSamples: [],
    locationResult: null,
    sampledLocation: null,
    checkpoints: [],
    showAdvancedInput: false,
    coordinate_system: '',
    location_source: ''
  },

  onShow() {
    this.loadSettings()
  },

  loadSettings() {
    callCloud('settings', { action: 'getAll' })
      .then((res) => {
        if (!res.data) return

        const settings = res.data
        const checkpointList = Array.isArray(settings.checkpoints) ? settings.checkpoints : []
        const mainCheckpoint = checkpointList[0] || null
        const extraCheckpoints = checkpointList.slice(1).map(createCheckpointDraft)
        this.setData({
          factory_latitude: String(settings.factory_latitude || (mainCheckpoint ? mainCheckpoint.latitude : '') || ''),
          factory_longitude: String(settings.factory_longitude || (mainCheckpoint ? mainCheckpoint.longitude : '') || ''),
          geofence_radius: String(settings.geofence_radius || (mainCheckpoint ? mainCheckpoint.radius : 100) || 100),
          quality_threshold: String(settings.quality_threshold || 95),
          export_email: settings.export_email || 'hanyifan424@gmail.com',
          qrcode_expire_days: String(settings.qrcode_expire_days || 1),
          allow_home_checkin: !!settings.allow_home_checkin,
          leaderboard_visible: !!settings.leaderboard_visible,
          salary_payroll_mode: normalizePayrollMode(settings.salary_payroll_mode),
          smtp_host: settings.smtp_host || '',
          smtp_port: String(settings.smtp_port || 465),
          smtp_user: settings.smtp_user || '',
          smtp_pass: settings.smtp_pass || '',
          checkpoints: extraCheckpoints,
          coordinate_system: settings.coordinate_system || '',
          location_source: settings.location_source || '',
          loaded: true
        })
      })
      .catch(() => {
        this.setData({ loaded: false })
        showError('加载设置失败')
      })
  },

  onInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onSwitchChange(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ [field]: e.detail.value })
  },

  onPayrollModeTap(e) {
    const mode = normalizePayrollMode(e.currentTarget.dataset.mode)
    this.setData({ salary_payroll_mode: mode })
  },

  quickAddCheckpoint() {
    if (!this.data.sampledLocation) {
      showError('请先采样当前位置')
      return
    }
    const self = this
    wx.showModal({
      title: '添加附加打卡点',
      content: '请输入名称（如：1号车间入口）',
      editable: true,
      placeholderText: '打卡点名称',
      success(res) {
        if (!res.confirm) return
        const name = (res.content || '').trim() || '附加打卡点'
        const checkpoints = (self.data.checkpoints || []).concat(createCheckpointDraft({
          name: name,
          latitude: self.data.sampledLocation.latitude,
          longitude: self.data.sampledLocation.longitude,
          radius: self.data.geofence_radius || '100'
        }))
        self.setData({ checkpoints, location_source: 'on_site', coordinate_system: 'gcj02' })
        showSuccess('已添加：' + name)
      }
    })
  },

  removeCheckpoint(e) {
    const index = Number(e.currentTarget.dataset.index)
    const checkpoints = (this.data.checkpoints || []).slice()
    checkpoints.splice(index, 1)
    this.setData({ checkpoints })
  },

  applySampleToMain() {
    if (!this.data.sampledLocation) {
      showError('请先采样当前位置')
      return
    }
    this.setData({
      factory_latitude: this.data.sampledLocation.latitude,
      factory_longitude: this.data.sampledLocation.longitude,
      location_source: 'on_site',
      coordinate_system: 'gcj02'
    })
    showSuccess('已设为主打卡点')
  },

  toggleAdvancedInput() {
    this.setData({ showAdvancedInput: !this.data.showAdvancedInput })
  },

  onSave() {
    const canSave = canSaveSettings({ loaded: this.data.loaded })
    if (!canSave.ok) {
      showError(canSave.msg)
      return
    }

    const lat = parseFloat(this.data.factory_latitude)
    const lng = parseFloat(this.data.factory_longitude)

    if (this.data.factory_latitude && (Number.isNaN(lat) || lat < -90 || lat > 90)) {
      showError('纬度范围应在 -90 到 90 之间')
      return
    }

    if (this.data.factory_longitude && (Number.isNaN(lng) || lng < -180 || lng > 180)) {
      showError('经度范围应在 -180 到 180 之间')
      return
    }

    if (this.data.factory_latitude && this.data.factory_longitude && !isInChinaMainland(lat, lng)) {
      wx.showModal({
        title: '坐标不在中国大陆范围',
        content: '当前坐标不在中国大陆范围内，请确认是否正确',
        success: (res) => {
          if (res.confirm) this.doSave(lat, lng)
        }
      })
      return
    }

    this.doSave(lat, lng)
  },

  doSave(lat, lng) {
    this.setData({ loading: true })
    showLoading('保存中...')

    // 确定坐标来源
    const locationSource = this.data.location_source || (this.data.showAdvancedInput ? 'manual_input' : 'on_site')
    const checkpointPayload = buildCheckpointPayload(this.data)

    callCloud('settings', {
      action: 'save',
      factory_latitude: Number.isFinite(lat) ? lat : '',
      factory_longitude: Number.isFinite(lng) ? lng : '',
      geofence_radius: parseInt(this.data.geofence_radius, 10) || 100,
      quality_threshold: parseInt(this.data.quality_threshold, 10) || 95,
      export_email: this.data.export_email,
      qrcode_expire_days: parseInt(this.data.qrcode_expire_days, 10) || 1,
      allow_home_checkin: this.data.allow_home_checkin,
      leaderboard_visible: this.data.leaderboard_visible,
      salary_payroll_mode: normalizePayrollMode(this.data.salary_payroll_mode),
      smtp_host: this.data.smtp_host,
      smtp_port: parseInt(this.data.smtp_port, 10) || 465,
      smtp_user: this.data.smtp_user,
      smtp_pass: this.data.smtp_pass,
      checkpoints: checkpointPayload,
      coordinate_system: 'gcj02',
      location_source: locationSource
    })
      .then(() => {
        hideLoading()
        showSuccess('保存成功')
      })
      .catch((err) => {
        hideLoading()
        showError(err.message || '保存失败')
      })
      .then(() => {
        this.setData({ loading: false })
      })
  },

  goSubscription() {
    wx.navigateTo({ url: '/pages/boss/subscription/subscription' })
  },

  async getLocation() {
    // 先检查权限
    const perm = await checkLocationPermission()
    if (perm.preciseDenied && perm.fuzzyDenied) {
      wx.showModal({
        title: '定位权限未开启',
        content: '请在手机设置中允许微信获取位置权限后重试',
        showCancel: false
      })
      return
    }

    this.setData({ locating: true, locationSamples: [], locationResult: null })
    showLoading('正在采样定位（共3次）...')

    try {
      const result = await sampleLocationAndPickBest(wx, 3, 1000)

      hideLoading()

      if (!isValidCoordinate(result.latitude, result.longitude)) {
        showError('采样结果无效，请到室外重试')
        this.setData({ locating: false })
        return
      }

      // 格式化所有采样供展示
      const samplesDisplay = result.allSamples.map((s, i) => {
        if (s.error) return { index: i + 1, status: '失败', error: s.error }
        return {
          index: i + 1,
          status: '成功',
          latitude: s.latitude.toFixed(6),
          longitude: s.longitude.toFixed(6),
          accuracy: s.accuracy > 0 ? Math.round(s.accuracy) + '米' : '未知',
          isPrecise: s.isPrecise ? '高精度' : '模糊定位'
        }
      })

      this.setData({
        locationSamples: samplesDisplay,
        locationResult: {
          accuracy: result.accuracy > 0 ? Math.round(result.accuracy) + '米' : '未知',
          validCount: result.validCount,
          totalCount: result.sampleCount,
          isPrecise: result.isPrecise
        },
        sampledLocation: {
          latitude: result.latitude.toFixed(6),
          longitude: result.longitude.toFixed(6)
        },
        factory_latitude: this.data.factory_latitude || result.latitude.toFixed(6),
        factory_longitude: this.data.factory_longitude || result.longitude.toFixed(6),
        location_source: 'on_site',
        coordinate_system: 'gcj02',
        locating: false
      })

      const accMsg = result.accuracy > 0 ? `，精度${Math.round(result.accuracy)}米` : ''
      showSuccess(`已获取位置（${result.validCount}/${result.sampleCount}次成功${accMsg}）`)
    } catch (err) {
      hideLoading()
      this.setData({ locating: false })
      const errMsg = (err && err.message) || ''
      if (errMsg.includes('auth deny') || errMsg.includes('authorize')) {
        wx.showModal({
          title: '定位权限未开启',
          content: '请前往手机设置，允许微信获取位置权限',
          confirmText: '去设置',
          success(res) {
            if (res.confirm) wx.openSetting()
          }
        })
      } else {
        showError('获取位置失败：' + errMsg)
      }
    }
  },

  goPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/privacy-policy/privacy-policy' })
  },

  goUserAgreement() {
    wx.navigateTo({ url: '/pages/user-agreement/user-agreement' })
  }
})
