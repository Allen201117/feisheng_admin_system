// app.js - 工厂记账小程序入口
const { getStoredUser, clearUser } = require('./utils/auth')
const { hasCurrentConsent } = require('./utils/privacy')

App({
  onLaunch: function () {
    if (!wx.cloud) {
      console.error('请使用 2.2.3 或以上的基础库以使用云能力')
      return
    }
    wx.cloud.init({
      env: wx.cloud.DYNAMIC_CURRENT_ENV,
      traceUser: true
    })
    this.checkLogin()
  },

  globalData: {
    userInfo: null,
    isLoggedIn: false
  },

  checkLogin: function () {
    const user = getStoredUser()
    if (user && user._id && hasCurrentConsent()) {
      this.globalData.userInfo = user
      this.globalData.isLoggedIn = true
      this.routeByRole(user.role)
      return
    }
    // 如果没有存储的用户信息，留在登录页
  },

  routeByRole: function (role) {
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
    wx.reLaunch({ url: '/pages/login/login' })
  }
})
