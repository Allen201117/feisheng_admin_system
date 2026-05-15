// pages/employee/home/home.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, formatTime, formatDate, formatMoney, getToday } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const { requestBestLocation, sampleLocationAndPickBest, calculateDistanceMeters, isValidCoordinate, checkLocationPermission } = require('../../../utils/location')
const { normalizeAssignedProcessForEmployee } = require('../worklog/worklog.logic')
const {
  buildHomeProcessView,
  buildQuantityState,
  buildQuotaFromProcess,
  findProcessById
} = require('./home.logic')
const app = getApp()

const HOME_PROCESS_PREVIEW_LIMIT = 5

Page({
  data: {
    userInfo: null,
    todayDate: '',
    currentTime: '',
    clockedIn: false,
    clockedOut: false,
    clockInTime: '',
    clockOutTime: '',
    todayEarnings: '0.00',
    monthHours: '0.00',
    todayHours: '0.0',
    sessionCount: 0,
    locationReady: false,
    loading: false,
    clockSource: 'normal',
    qrToken: '',
    joinDateDisplay: '',
    assignedProcesses: [],
    displayedHomeProcesses: [],
    assignedProcessTotal: 0,
    hasMoreAssignedProcesses: false,
    selectedHomeProcess: null,
    selectedHomeProcessId: '',
    homeQuantity: 0,
    homeQuickQuantities: [50, 100, 200, 500],
    homeQuotaInfo: null,
    homeQuotaLoading: false,
    homeQuantityError: '',
    homeCanSubmit: false,
    homeEstimateAmount: '0.00',
    homeProcessLoading: false,
    homeProcessError: '',
    // 修改密码
    showChangePwd: false,
    changePwdData: { oldPassword: '', newPassword: '', confirmPassword: '' },
    showOldPwd: false,
    showNewPwd: false,
    changePwdLoading: false,
    // 排行榜可见
    leaderboardVisible: false
  },

  onLoad() {
    const user = getStoredUser()
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    // 检查是否是扫码进入
    const clockSource = wx.getStorageSync('clock_source') || 'normal'
    const qrToken = wx.getStorageSync('scan_qr_token') || ''
    this.setData({
      userInfo: user,
      todayDate: getToday(),
      clockSource: clockSource,
      qrToken: qrToken
    })
    // 清除扫码标记
    wx.removeStorageSync('clock_source')
    wx.removeStorageSync('scan_qr_token')
  },

  async onShow() {
    this.updateTime()
    await this.loadTodayAttendance()
    this.loadTodayEarnings()
    this.loadHomeAssignedProcesses()
    this.loadMonthlyHours()
    this.loadJoinDate()
    this.tryAutoClockInFromScan()
    this.checkLeaderboardVisible()
    // 定时更新时间
    this._timer = setInterval(() => this.updateTime(), 1000)
  },

  async tryAutoClockInFromScan() {
    if (this._autoClockScanTried) return
    if (this.data.clockSource !== 'qrcode' || !this.data.qrToken) return
    if (this.data.clockedIn) {
      this.setData({ clockSource: 'normal', qrToken: '' })
      return
    }
    this._autoClockScanTried = true
    await this.doClock('clockIn')
  },

  onHide() {
    if (this._timer) clearInterval(this._timer)
  },

  onUnload() {
    if (this._timer) clearInterval(this._timer)
  },

  updateTime() {
    this.setData({ currentTime: formatTime(new Date()) })
  },

  async loadTodayAttendance() {
    try {
      const res = await callCloud('attendance', {
        action: 'getTodayRecord',
        user_id: this.data.userInfo._id
      })
      if (res.data) {
        const d = res.data
        const hasOpen = !!d.has_open_session
        this.setData({
          clockedIn: hasOpen,
          clockedOut: false,
          clockInTime: d.clock_in_time ? formatTime(d.clock_in_time) : '',
          clockOutTime: d.clock_out_time ? formatTime(d.clock_out_time) : '',
          todayHours: (d.total_hours_today || 0).toFixed(1),
          sessionCount: d.session_count || 0
        })
      } else {
        this.setData({
          clockedIn: false,
          clockedOut: false,
          clockInTime: '',
          clockOutTime: '',
          todayHours: '0.0',
          sessionCount: 0
        })
      }
    } catch (e) {
      console.error('加载考勤记录失败', e)
    }
  },

  async loadTodayEarnings() {
    try {
      const res = await callCloud('worklog', {
        action: 'getTodayEarnings',
        user_id: this.data.userInfo._id
      })
      this.setData({
        todayEarnings: formatMoney(res.data ? res.data.earnings : 0)
      })
    } catch (e) {
      console.error('加载今日收入失败', e)
    }
  },

  buildHomeEstimate(quantity, selectedProcess) {
    if (!selectedProcess || selectedProcess.price_hidden || quantity <= 0) {
      return '0.00'
    }
    return formatMoney(quantity * (selectedProcess.current_price || 0))
  },

  applyHomeQuantityState(quantity, quotaInfo, selectedProcess) {
    const state = buildQuantityState(quantity, quotaInfo, selectedProcess)
    this.setData({
      homeQuantity: state.quantity,
      homeQuantityError: state.quantityError,
      homeCanSubmit: state.canSubmit,
      homeEstimateAmount: this.buildHomeEstimate(state.quantity, selectedProcess)
    })
  },

  async loadHomeAssignedProcesses() {
    if (!this.data.userInfo || !this.data.userInfo._id) return
    this.setData({ homeProcessLoading: true, homeProcessError: '' })

    try {
      const res = await callCloud('order', {
        action: 'getAssignedProcesses',
        user_id: this.data.userInfo._id
      })
      const processes = (res.data || []).map(normalizeAssignedProcessForEmployee)
      let selected = this.data.selectedHomeProcessId
        ? findProcessById(processes, this.data.selectedHomeProcessId)
        : null

      if (!selected && processes.length === 1) {
        selected = processes[0]
      }

      const selectedId = selected ? selected._id : ''
      const quotaInfo = selected ? buildQuotaFromProcess(selected) : null
      const state = buildQuantityState(this.data.homeQuantity, quotaInfo, selected)
      const view = buildHomeProcessView(processes, selectedId, HOME_PROCESS_PREVIEW_LIMIT)

      this.setData({
        assignedProcesses: processes,
        displayedHomeProcesses: view.items,
        assignedProcessTotal: view.totalCount,
        hasMoreAssignedProcesses: view.hasMore,
        selectedHomeProcess: selected,
        selectedHomeProcessId: selectedId,
        homeQuotaInfo: quotaInfo,
        homeQuantity: state.quantity,
        homeQuantityError: state.quantityError,
        homeCanSubmit: state.canSubmit,
        homeEstimateAmount: this.buildHomeEstimate(state.quantity, selected),
        homeProcessLoading: false
      })

      if (selected) {
        this.loadHomeProcessQuota()
      }
    } catch (e) {
      console.error('加载首页工序失败', e)
      this.setData({
        homeProcessLoading: false,
        homeProcessError: e.message || '工序加载失败'
      })
    }
  },

  onSelectHomeProcess(e) {
    const processId = e.currentTarget.dataset.id
    const selected = findProcessById(this.data.assignedProcesses, processId)
    if (!selected) return

    const quotaInfo = buildQuotaFromProcess(selected)
    const view = buildHomeProcessView(this.data.assignedProcesses, selected._id, HOME_PROCESS_PREVIEW_LIMIT)
    const state = buildQuantityState(0, quotaInfo, selected)

    this.setData({
      selectedHomeProcess: selected,
      selectedHomeProcessId: selected._id,
      displayedHomeProcesses: view.items,
      assignedProcessTotal: view.totalCount,
      hasMoreAssignedProcesses: view.hasMore,
      homeQuotaInfo: quotaInfo,
      homeQuantity: state.quantity,
      homeQuantityError: state.quantityError,
      homeCanSubmit: state.canSubmit,
      homeEstimateAmount: '0.00'
    })

    this.loadHomeProcessQuota()
  },

  async loadHomeProcessQuota() {
    const selected = this.data.selectedHomeProcess
    if (!selected) return

    this.setData({ homeQuotaLoading: true })
    try {
      const res = await callCloud('worklog', {
        action: 'getProcessQuota',
        order_id: selected.order_id,
        process_id: selected._id
      })
      const quotaInfo = res.data || buildQuotaFromProcess(selected)
      const state = buildQuantityState(this.data.homeQuantity, quotaInfo, selected)
      this.setData({
        homeQuotaInfo: quotaInfo,
        homeQuantity: state.quantity,
        homeQuantityError: state.quantityError,
        homeCanSubmit: state.canSubmit,
        homeEstimateAmount: this.buildHomeEstimate(state.quantity, selected)
      })
    } catch (err) {
      console.error('加载首页工序余量失败', err)
    } finally {
      this.setData({ homeQuotaLoading: false })
    }
  },

  onHomeQuantityInput(e) {
    const val = parseInt((e.detail.value || '').replace(/[^0-9]/g, ''), 10) || 0
    this.applyHomeQuantityState(val, this.data.homeQuotaInfo, this.data.selectedHomeProcess)
  },

  onHomeQuickQuantityTap(e) {
    const val = parseInt(e.currentTarget.dataset.value, 10) || 0
    this.applyHomeQuantityState(val, this.data.homeQuotaInfo, this.data.selectedHomeProcess)
  },

  onHomeClearQuantity() {
    this.applyHomeQuantityState(0, this.data.homeQuotaInfo, this.data.selectedHomeProcess)
  },

  async verifyHomeQuotaBeforeSubmit() {
    const selected = this.data.selectedHomeProcess
    if (!selected) return false

    const res = await callCloud('worklog', {
      action: 'getProcessQuota',
      order_id: selected.order_id,
      process_id: selected._id
    })
    const quotaInfo = res.data || {}
    const state = buildQuantityState(this.data.homeQuantity, quotaInfo, selected)

    this.setData({
      homeQuotaInfo: quotaInfo,
      homeQuantityError: state.quantityError,
      homeCanSubmit: state.canSubmit
    })

    if (!state.canSubmit) {
      showError(state.quantityError || '请输入有效的完成数量')
      return false
    }
    return true
  },

  async onSubmitHomeWorklog() {
    const selected = this.data.selectedHomeProcess
    if (!selected) {
      showError('请先选择工序')
      return
    }

    const state = buildQuantityState(this.data.homeQuantity, this.data.homeQuotaInfo, selected)
    if (!state.canSubmit) {
      showError(state.quantityError || '请输入有效的完成数量')
      return
    }

    try {
      const canSubmit = await this.verifyHomeQuotaBeforeSubmit()
      if (!canSubmit) return
    } catch (err) {
      showError(err.message || '获取剩余可报数量失败')
      return
    }

    this.setData({ loading: true })
    showLoading('提交中...')

    try {
      await callCloud('worklog', {
        action: 'submit',
        user_id: this.data.userInfo._id,
        user_name: this.data.userInfo.name,
        process_id: selected._id,
        order_id: selected.order_id,
        quantity: this.data.homeQuantity
      })

      hideLoading()
      showSuccess('报工成功')
      this.applyHomeQuantityState(0, this.data.homeQuotaInfo, selected)
      this.loadTodayEarnings()
      this.loadHomeAssignedProcesses()
    } catch (err) {
      hideLoading()
      showError(err.message || '报工失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadMonthlyHours() {
    try {
      const res = await callCloud('attendance', {
        action: 'getMonthlyHours',
        user_id: this.data.userInfo._id
      })
      this.setData({
        monthHours: (res.data && res.data.hours != null) ? Number(res.data.hours).toFixed(1) : '0.0'
      })
    } catch (e) {
      console.error('加载月工时失败', e)
    }
  },

  async loadJoinDate() {
    try {
      const res = await callCloud('user', {
        action: 'get',
        user_id: this.data.userInfo._id
      })
      if (res.data && res.data.join_date) {
        // 格式化为 YYYY年MM月DD日
        const parts = res.data.join_date.split('-')
        if (parts.length === 3) {
          this.setData({
            joinDateDisplay: `${parts[0]}年${parseInt(parts[1])}月${parseInt(parts[2])}日`
          })
        } else {
          this.setData({ joinDateDisplay: res.data.join_date })
        }
      } else {
        this.setData({ joinDateDisplay: '' })
      }
    } catch (e) {
      console.error('加载入厂时间失败', e)
    }
  },

  async onClockIn() {
    if (this.data.clockedIn) return
    await this.doClock('clockIn')
  },

  async onClockOut() {
    if (!this.data.clockedIn) return
    await this.doClock('clockOut')
  },

  async doClock(type) {
    if (this._clocking) {
      return
    }
    this._clocking = true
    this.setData({ loading: true })

    try {
      // 1. 检查定位权限
      const perm = await checkLocationPermission()
      if (perm.preciseDenied) {
        wx.showModal({
          title: '定位权限未开启',
          content: '签到需要定位权限，请在手机设置中允许微信获取位置权限',
          confirmText: '去设置',
          success(res) {
            if (res.confirm) wx.openSetting()
          }
        })
        return
      }

      // 2. 多次采样定位
      showLoading('正在定位（等待GPS稳定，约3-5秒）...')
      const location = await sampleLocationAndPickBest(wx, 3, 800)
      hideLoading()

      // 3. 坐标合法性检查
      if (!isValidCoordinate(location.latitude, location.longitude)) {
        showError('定位失败，获取到的位置无效，请到室外重试')
        return
      }

      // 4. 精度过低提醒
      if (location.accuracy > 500) {
        const goOn = await new Promise((resolve) => {
          wx.showModal({
            title: '定位精度较低',
            content: `当前定位精度约${Math.round(location.accuracy)}米，可能导致签到失败。建议开启GPS、连接WiFi后重试。是否继续？`,
            success(res) { resolve(res.confirm) }
          })
        })
        if (!goOn) return
      }

      // 5. 获取设备信息用于诊断
      let deviceInfo = ''
      try {
        const deviceInfoRes = wx.getDeviceInfo ? wx.getDeviceInfo() : {}
        const appBaseInfoRes = wx.getAppBaseInfo ? wx.getAppBaseInfo() : {}
        const host = [deviceInfoRes.brand, deviceInfoRes.model].filter(Boolean).join(' ')
        const system = deviceInfoRes.system || ''
        const version = appBaseInfoRes.version || ''
        deviceInfo = `${host} | ${system} | 微信${version}`.replace(/^\s*\|\s*|\s*\|\s*$/g, '')
      } catch (e) {}

      // 5b. 尝试获取Wi-Fi BSSID（用于辅助定位判定）
      let wifiBssid = ''
      try {
        const wifiInfo = await new Promise((resolve, reject) => {
          wx.getConnectedWifi({
            success: (res) => resolve(res.wifi || {}),
            fail: () => resolve({})
          })
        })
        wifiBssid = wifiInfo.BSSID || ''
      } catch (e) {}

      // 6. 提交签到
      showLoading('打卡中...')
      const res = await callCloud('attendance', {
        action: type,
        user_id: this.data.userInfo._id,
        latitude: location.latitude,
        longitude: location.longitude,
        accuracy: location.accuracy,
        location_timestamp: location.timestamp,
        device_info: deviceInfo,
        wifi_bssid: wifiBssid,
        raw_samples: location.allSamples ? location.allSamples.map(s => ({
          lat: s.latitude, lng: s.longitude, acc: s.accuracy, err: s.error, t: s.timestamp
        })) : [],
        source: this.data.clockSource,
        qr_id: this.data.qrToken
      })

      hideLoading()

      // 7. 处理不同结果状态
      if (res.code === -2) {
        // retry: 定位不稳定，建议重试
        wx.showModal({
          title: '定位不稳定',
          content: (res.msg || '定位质量较低，建议移到空旷处重试') +
            (res.data && res.data.distance != null ? `（距离约${res.data.distance}米）` : ''),
          confirmText: '重试',
          success: (modalRes) => {
            if (modalRes.confirm) this.doClock(type)
          }
        })
        return
      }

      if (res.code !== 0) {
        throw new Error(res.msg || '打卡失败')
      }

      // 8. 打卡成功
      const distMsg = res.data && res.data.distance != null ? `（距离${res.data.distance}米）` : ''
      showSuccess((type === 'clockIn' ? '上班打卡成功' : '下班打卡成功') + distMsg)

      // 重新加载状态（支持多次签到签退）
      await this.loadTodayAttendance()
      this.loadMonthlyHours()

      if (type === 'clockIn' && this.data.clockSource === 'qrcode') {
        this.setData({ clockSource: 'normal', qrToken: '' })
      }
    } catch (err) {
      hideLoading()
      const message = err.message || '打卡失败'
      console.error('[doClock] 失败详情:', type, message, err)
      if (message.includes('今日已签到') || message.includes('今日已签退') || message.includes('请先签到')) {
        await this.loadTodayAttendance()
      }
      // 对距离超出的错误提供更详细的提示
      if (message.includes('不在工厂范围内')) {
        wx.showModal({
          title: '签到失败',
          content: message,
          showCancel: false
        })
      } else {
        showError(message)
      }
    } finally {
      this._clocking = false
      this.setData({ loading: false })
    }
  },

  goToWorklog(e) {
    const processId = e && e.currentTarget && e.currentTarget.dataset ? e.currentTarget.dataset.id : ''
    const query = processId ? `?process_id=${encodeURIComponent(processId)}` : ''
    wx.navigateTo({ url: `/pages/employee/worklog/worklog${query}` })
  },

  // 扫码打卡（体验版：员工在小程序内扫老板生成的二维码）
  async onScanQR() {
    try {
      const scanRes = await new Promise((resolve, reject) => {
        wx.scanCode({
          onlyFromCamera: true,
          success: resolve,
          fail: reject
        })
      })
      const scanResult = scanRes.result || ''
      // 解析 scene：内容格式为 q=xxx&n=yyy
      const match = /(?:^|&)q=([^&]+)/.exec(scanResult)
      const qrId = match && match[1] ? match[1] : ''
      if (!qrId) {
        showError('无效的考勤二维码')
        return
      }
      // 验证二维码
      showLoading('验证中...')
      await callCloud('qrcode', { action: 'verify', qr_id: qrId })
      hideLoading()
      // 验证通过，设置扫码标记
      this.setData({ clockSource: 'qrcode', qrToken: qrId })
      showSuccess('扫码成功\n请点击上班打卡')
    } catch (err) {
      hideLoading()
      if (err.errMsg && err.errMsg.includes('cancel')) {
        return // 用户取消扫码
      }
      showError(err.message || '扫码失败，请重试')
    }
  },

  goToProfile() {
    wx.navigateTo({ url: '/pages/employee/profile/profile' })
  },

  goToLeaderboard() {
    wx.navigateTo({ url: '/pages/employee/leaderboard/leaderboard' })
  },

  checkLeaderboardVisible() {
    var that = this
    callCloud('settings', { action: 'getPublic' }).then(function(res) {
      that.setData({ leaderboardVisible: !!(res.data && res.data.leaderboard_visible) })
    }).catch(function() {})
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
  },

  onLogout() {
    app.logout()
  }
})
