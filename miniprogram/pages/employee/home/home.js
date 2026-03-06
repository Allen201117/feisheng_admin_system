// pages/employee/home/home.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, formatTime, formatDate, formatMoney, getToday } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const app = getApp()

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
    // 修改密码
    showChangePwd: false,
    changePwdData: { oldPassword: '', newPassword: '', confirmPassword: '' },
    showOldPwd: false,
    showNewPwd: false,
    changePwdLoading: false
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
    this.loadMonthlyHours()
    this.loadJoinDate()
    this.tryAutoClockInFromScan()
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

  async loadMonthlyHours() {
    try {
      const res = await callCloud('attendance', {
        action: 'getMonthlyHours',
        user_id: this.data.userInfo._id
      })
      this.setData({
        monthHours: res.data ? res.data.hours.toFixed(1) : '0.0'
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
    showLoading('正在定位...')

    try {
      const location = await this.getLocation()
      hideLoading()
      showLoading('打卡中...')

      const res = await callCloud('attendance', {
        action: type,
        user_id: this.data.userInfo._id,
        latitude: location.latitude,
        longitude: location.longitude,
        source: this.data.clockSource,
        qr_id: this.data.qrToken
      })

      hideLoading()
      showSuccess(type === 'clockIn' ? '上班打卡成功' : '下班打卡成功')

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
      showError(message)
    } finally {
      this._clocking = false
      this.setData({ loading: false })
    }
  },

  wait(ms) {
    return new Promise(resolve => setTimeout(resolve, ms))
  },

  getLocation() {
    const getOnce = () => new Promise((resolve, reject) => {
      wx.getFuzzyLocation({
        type: 'wgs84',
        success: (res) => {
          const location = {
            latitude: res.latitude,
            longitude: res.longitude
          }
          this._lastLocation = {
            ...location,
            ts: Date.now()
          }
          resolve(location)
        },
        fail: (err) => reject(err)
      })
    })

    return getOnce().catch(async (err) => {
      const message = (err && err.errMsg) || ''
      const isFrequentCall = message.includes('频繁调用')

      if (isFrequentCall) {
        // 开发工具中短时间重复调用 getLocation 可能被限制，延迟后重试一次
        await this.wait(1200)
        try {
          return await getOnce()
        } catch (retryErr) {
          const hasRecentCache = this._lastLocation && (Date.now() - this._lastLocation.ts < 3 * 60 * 1000)
          if (hasRecentCache) {
            return {
              latitude: this._lastLocation.latitude,
              longitude: this._lastLocation.longitude
            }
          }
          console.error('定位失败(重试后):', retryErr)
          throw new Error('定位调用过于频繁，请等待2秒后重试')
        }
      }

      console.error('定位失败:', err)
      throw new Error('定位失败，请检查是否开启位置权限')
    })
  },

  goToWorklog() {
    wx.navigateTo({ url: '/pages/employee/worklog/worklog' })
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
