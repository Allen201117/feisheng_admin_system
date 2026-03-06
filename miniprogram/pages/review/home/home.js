Page({
  data: {
    mockStats: {
      todayAttendance: 23,
      pendingQC: 2,
      activeOrders: 4,
      monthSalary: '132560.00'
    }
  },

  goPrivacyPolicy() {
    wx.navigateTo({ url: '/pages/privacy-policy/privacy-policy' })
  },

  goUserAgreement() {
    wx.navigateTo({ url: '/pages/user-agreement/user-agreement' })
  },

  goLogin() {
    wx.navigateTo({ url: '/pages/login/login' })
  }
})
