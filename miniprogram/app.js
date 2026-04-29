// app.js - 工厂记账小程序入口
const { getStoredUser, storeUser, clearUser } = require('./utils/auth')
const { hasCurrentConsent } = require('./utils/privacy')
const { getStartupSessionAction } = require('./app.logic')

App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: 'cloud1-5gr08st9c198f437',
      traceUser: true
    })
    this.checkLogin()
  },

  globalData: {
    userInfo: null,
    isLoggedIn: false
  },

  checkLogin: async function () {
    const user = getStoredUser()
    const action = getStartupSessionAction({
      user,
      hasConsent: hasCurrentConsent()
    })

    if (action === 'clear') {
      clearUser()
      this.globalData.userInfo = null
      this.globalData.isLoggedIn = false
      return
    }

    if (action === 'resume') {
      const resumed = await this.resumeSession(user, true)
      if (resumed) {
        const currentUser = this.globalData.userInfo || user
        this.routeByRole(currentUser.role)
      }
      return
    }
    // 如果没有存储的用户信息，留在登录页
  },

  resumeSession: async function (user, silent) {
    if (!user || !user._id || !user.session_token) {
      clearUser()
      this.globalData.userInfo = null
      this.globalData.isLoggedIn = false
      return false
    }

    try {
      const res = await wx.cloud.callFunction({
        name: 'login',
        data: {
          action: 'verifyToken',
          user_id: user._id,
          session_token: user.session_token
        }
      })

      if (res.result && res.result.code === 0) {
        const latestUser = Object.assign({}, user, res.result.data || {})
        storeUser(latestUser)
        this.globalData.userInfo = latestUser
        this.globalData.isLoggedIn = true
        return true
      }
    } catch (err) {}

    clearUser()
    this.globalData.userInfo = null
    this.globalData.isLoggedIn = false
    wx.removeStorageSync('clock_source')
    wx.removeStorageSync('scan_qr_token')
    if (!silent) {
      wx.showToast({ title: '登录已失效，请重新登录', icon: 'none', duration: 2500 })
    }
    return false
  },

  routeByRole: function (role) {
    const currentUser = this.globalData.userInfo || getStoredUser()
    if (currentUser && currentUser.platform_role === 'platform_admin') {
      wx.reLaunch({ url: '/pages/platform/home/home' })
      return
    }

    let url = ''
    switch (role) {
      case 'boss':
        url = '/pages/boss/home/home'
        break
      case 'qc':
        url = '/pages/qc/home/home'
        break
      case 'employee':
        url = '/pages/employee/home/home'
        break
      default:
        url = '/pages/login/login'
    }
    wx.reLaunch({ url })
  },

  logout: function () {
    clearUser()
    this.globalData.userInfo = null
    this.globalData.isLoggedIn = false
    wx.removeStorageSync('clock_source')
    wx.removeStorageSync('scan_qr_token')
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
