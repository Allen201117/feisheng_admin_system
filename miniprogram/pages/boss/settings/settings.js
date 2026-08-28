// pages/boss/settings/settings.js
const {
  callCloud,
  showError,
  showSuccess,
  showLoading,
  hideLoading,
  showConfirm
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

// 把云函数返回的修复报告拍平成可直接渲染的文案（WXML 里不做计算，遵循项目现有约定）
// status：clean=全部对齐无需处理｜dirty=查出差异待确认｜applied=刚写完库
function buildRepairReport(data, applied) {
  const samples = (data.samples || []).map((item) => {
    const parts = []
    if (item.price_to !== null && item.price_to !== undefined) {
      parts.push(`结算价 ¥${item.price_from} → ¥${item.price_to}`)
    }
    if (item.process_name_to) {
      parts.push(`工序名 ${item.process_name_from} → ${item.process_name_to}`)
    }
    return {
      worklog_id: item.worklog_id,
      title: `${item.user_name || ''} ${item.order_name || ''} ${item.date || ''}`.trim(),
      detail: `${item.locked ? '[已发薪] ' : ''}${parts.join('；')}`
    }
  })
  const manual = data.manual_review || []
  const fixCount = data.total_fix_count || 0
  const scanned = (data.scanned && data.scanned.worklogs) || 0
  const status = applied ? 'applied' : (fixCount === 0 && manual.length === 0 ? 'clean' : 'dirty')

  let headline
  if (status === 'clean') headline = '全部对齐，没有要改的'
  else if (status === 'applied') headline = `已对齐 ${data.applied || 0} 条` + ((data.failed || 0) > 0 ? `，${data.failed} 条失败` : '')
  else headline = `查出 ${fixCount} 条需要对齐`

  return {
    status,
    total_fix_count: fixCount,
    headline,
    summaryText: `扫描报工 ${scanned} 条 · 未发薪 ${data.unpaid_fix_count || 0} 条 · 已发薪 ${data.paid_fix_count || 0} 条 · 待人工确认 ${manual.length} 组`,
    samples,
    manual_review: manual
  }
}

// 历史半天请假迁移报告 → 可直接渲染的文案
const HALF_KIND_TEXT = { am: '上午', pm: '下午', half: '半天' }

function formatLeaveDates(dates) {
  return (dates || []).map((d) => {
    const p = String(d).split('-')
    return parseInt(p[1], 10) + '月' + parseInt(p[2], 10) + '日'
  }).join('、')
}

function buildHalfDayReport(data, applied) {
  const plan = data.plan || []
  const unmatched = data.unmatched || []
  const fixCount = data.total_fix_count || 0
  const status = applied ? 'applied' : (fixCount === 0 ? 'clean' : 'dirty')

  let headline
  if (status === 'clean') headline = '没有要转换的老记录'
  else if (status === 'applied') headline = `已转换 ${data.applied || 0} 条` + ((data.failed || 0) > 0 ? `，${data.failed} 条失败` : '')
  else headline = `找到 ${fixCount} 条其实是半天的老记录`

  return {
    status,
    total_fix_count: fixCount,
    headline,
    summaryText: `扫描请假记录 ${data.scanned || 0} 条 · 读不出半天的 ${unmatched.length} 条`,
    rows: plan.map((item) => ({
      _id: item._id,
      title: `${item.user_name} ${formatLeaveDates(item.dates)}`,
      detail: `备注「${item.reason}」· 请假 ${item.old_day_count} 天 → ${item.new_day_count} 天`,
      kindText: HALF_KIND_TEXT[item.kind] || '半天'
    })),
    unmatched: unmatched.map((item) => ({
      _id: item._id,
      title: `${item.user_name} ${formatLeaveDates(item.dates)}`,
      reason: item.reason
    }))
  }
}

Page({
  data: {
    repairing: false,
    repairReport: null,
    halfDayChecking: false,
    halfDayReport: null,
    checkpointTotal: 0,
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
        }, () => this.refreshCheckpointTotal())
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
        self.setData({ checkpoints, location_source: 'on_site', coordinate_system: 'gcj02' }, () => self.refreshCheckpointTotal())
        showSuccess('已添加：' + name)
      }
    })
  },

  removeCheckpoint(e) {
    const index = Number(e.currentTarget.dataset.index)
    const checkpoints = (this.data.checkpoints || []).slice()
    checkpoints.splice(index, 1)
    this.setData({ checkpoints }, () => this.refreshCheckpointTotal())
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
    }, () => this.refreshCheckpointTotal())
    showSuccess('已设为主打卡点')
  },

  // 打卡点总数 = 主打卡点(0/1) + 附加打卡点，供卡片头部显示。
  // WXML 不做计算，所以每次动到 checkpoints / 主打卡点后都刷一次。
  refreshCheckpointTotal() {
    const extra = (this.data.checkpoints || []).length
    this.setData({ checkpointTotal: (this.data.factory_latitude ? 1 : 0) + extra })
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

  // 结算价体检：先试运行（不写库）列出差异，老板确认后再一键对齐
  async onCheckSettlementPrices() {
    this.setData({ repairing: true, repairReport: null })
    showLoading('检查中...')
    try {
      const res = await callCloud('salary', { action: 'repairSettlementPrices', dry_run: true })
      hideLoading()
      const report = buildRepairReport(res.data || {}, false)
      this.setData({ repairing: false, repairReport: report })
      // 「没问题」也要有明确反馈：只留一行小灰字等于没反馈
      if (report.status === 'clean') showSuccess('数据都是对的')
      else wx.showToast({ title: report.headline, icon: 'none', duration: 2500 })
    } catch (err) {
      hideLoading()
      this.setData({ repairing: false })
      showError(err.message || '检查失败')
    }
  },

  async onApplySettlementRepair() {
    const report = this.data.repairReport
    if (!report || !report.total_fix_count) return
    const ok = await showConfirm('确认对齐', `将把 ${report.total_fix_count} 条报工的结算价/工序名对齐到当前工价。已发薪且金额对不上账的记录不会被改动。`)
    if (!ok) return

    this.setData({ repairing: true })
    showLoading('对齐中...')
    try {
      const res = await callCloud('salary', { action: 'repairSettlementPrices', dry_run: false })
      hideLoading()
      const report = buildRepairReport(res.data || {}, true)
      this.setData({ repairing: false, repairReport: report })
      showSuccess(report.headline)
    } catch (err) {
      hideLoading()
      this.setData({ repairing: false })
      showError(err.message || '对齐失败')
    }
  },

  // ===== 历史半天请假识别（老数据迁移）=====
  async onCheckLegacyHalfDay() {
    this.setData({ halfDayChecking: true, halfDayReport: null })
    showLoading('检查中...')
    try {
      const res = await callCloud('attendance', { action: 'repairLegacyHalfDayLeaves', dry_run: true })
      hideLoading()
      const report = buildHalfDayReport(res.data || {}, false)
      this.setData({ halfDayChecking: false, halfDayReport: report })
      if (report.status === 'clean') showSuccess('没有要转换的')
      else wx.showToast({ title: report.headline, icon: 'none', duration: 2500 })
    } catch (err) {
      hideLoading()
      this.setData({ halfDayChecking: false })
      showError(err.message || '检查失败')
    }
  },

  async onApplyLegacyHalfDay() {
    const report = this.data.halfDayReport
    if (!report || !report.total_fix_count) return
    const ok = await showConfirm('确认转换', `将把 ${report.total_fix_count} 条老请假从整天改成半天，请假天数会相应减半。全勤统计会跟着变。`)
    if (!ok) return

    this.setData({ halfDayChecking: true })
    showLoading('转换中...')
    try {
      const res = await callCloud('attendance', { action: 'repairLegacyHalfDayLeaves', dry_run: false })
      hideLoading()
      const next = buildHalfDayReport(res.data || {}, true)
      this.setData({ halfDayChecking: false, halfDayReport: next })
      showSuccess(next.headline)
    } catch (err) {
      hideLoading()
      this.setData({ halfDayChecking: false })
      showError(err.message || '转换失败')
    }
  },

  // 备注读不出半天的，让老板直接点着改 —— 否则只能删了重录，太折腾
  onFixLeaveKind(e) {
    const leaveId = e.currentTarget.dataset.id
    const title = e.currentTarget.dataset.title || '这条请假'
    if (!leaveId) return
    const options = [
      { label: '改成上午半天', kind: 'am' },
      { label: '改成下午半天', kind: 'pm' },
      { label: '改成半天（不分上下午）', kind: 'half' },
      { label: '改回全天', kind: 'full' }
    ]
    wx.showActionSheet({
      itemList: options.map(o => o.label),
      success: (res) => {
        const picked = options[res.tapIndex]
        if (!picked) return
        this.applyLeaveKind(leaveId, picked.kind, title)
      },
      fail: () => {}
    })
  },

  async applyLeaveKind(leaveId, kind, title) {
    showLoading('保存中...')
    try {
      await callCloud('attendance', { action: 'updateLeaveHalfDay', leave_id: leaveId, kind })
      hideLoading()
      showSuccess(`${title} 已更新`)
      this.onCheckLegacyHalfDay()
    } catch (err) {
      hideLoading()
      showError(err.message || '修改失败')
    }
  },

  goPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/privacy-policy/privacy-policy' })
  },

  goUserAgreement() {
    wx.navigateTo({ url: '/pages/user-agreement/user-agreement' })
  }
})
