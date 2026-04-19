// pages/employee/leaderboard/leaderboard.js
var util = require('../../../utils/util')
var callCloud = util.callCloud
var showError = util.showError
var { getStoredUser } = require('../../../utils/auth')

Page({
  data: {
    visible: false,
    checked: false,
    myUserId: '',
    periodTab: 'monthly',
    periodTabs: [
      { key: 'monthly', label: '本月' },
      { key: 'yearly', label: '年度' }
    ],
    dimTab: 'hours',
    dimTabs: [
      { key: 'hours', label: '工时' },
      { key: 'salary', label: '薪资' },
      { key: 'quality', label: '品质' }
    ],
    month: '',
    monthDisplay: '',
    year: '',
    yearDisplay: '',
    rankList: [],
    totalEmployees: 0,
    loading: false
  },

  onLoad: function() {
    var user = getStoredUser()
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }

    var bjTime = require('../../../utils/beijing-time')
    var f = bjTime.getBeijingFields()
    this.setData({
      myUserId: user._id,
      month: f.year + '-' + String(f.month).padStart(2, '0'),
      monthDisplay: f.year + '年' + f.month + '月',
      year: String(f.year),
      yearDisplay: f.year + '年'
    })

    this.checkVisibility()
  },

  onShow: function() {
    if (this.data.visible) this.loadRank()
  },

  onPullDownRefresh: function() {
    this.loadRank().then(function() { wx.stopPullDownRefresh() })
  },

  checkVisibility: function() {
    var that = this
    callCloud('settings', { action: 'getPublic' }).then(function(res) {
      var visible = !!(res.data && res.data.leaderboard_visible)
      that.setData({ visible: visible, checked: true })
      if (visible) that.loadRank()
    }).catch(function() {
      that.setData({ visible: false, checked: true })
    })
  },

  switchPeriod: function(e) {
    this.setData({ periodTab: e.currentTarget.dataset.key, rankList: [] })
    this.loadRank()
  },

  switchDim: function(e) {
    this.setData({ dimTab: e.currentTarget.dataset.key })
    this.loadRank()
  },

  onMonthChange: function(e) {
    var val = e.detail.value
    var parts = val.split('-')
    this.setData({ month: val, monthDisplay: parts[0] + '年' + parseInt(parts[1]) + '月' })
    this.loadRank()
  },

  onYearChange: function(e) {
    var idx = parseInt(e.detail.value)
    var bjTime = require('../../../utils/beijing-time')
    var now = bjTime.getBeijingFields().year
    var years = []
    for (var i = now; i >= now - 5; i--) years.push(i)
    var y = years[idx]
    this.setData({ year: String(y), yearDisplay: y + '年' })
    this.loadRank()
  },

  loadRank: function() {
    var that = this
    var period = this.data.periodTab
    var dim = this.data.dimTab
    var actionMap = { monthly: 'getMonthlyRank', yearly: 'getYearlyRank' }
    var params = { action: actionMap[period], dimension: dim }

    if (period === 'monthly') params.month = this.data.month
    else if (period === 'yearly') params.year = this.data.year

    that.setData({ loading: true })
    return callCloud('leaderboard', params).then(function(res) {
      if (res.code !== 0) {
        that.setData({ rankList: [], loading: false })
        return
      }
      var data = res.data || {}
      var list = data.list || []
      list = list.map(function(item) {
        if (dim === 'hours') {
          item.displayValue = (item.total_hours || 0) + 'h'
          item.displaySub = '出勤' + (item.attend_days || 0) + '天'
        } else if (dim === 'salary') {
          item.displayValue = '¥' + Number(item.total_salary || 0).toFixed(2)
          item.displaySub = ''
        } else {
          item.displayValue = (item.pass_rate || 0) + '%'
          item.displaySub = '合格' + (item.total_passed || 0) + '/' + (item.total_quantity || 0) + '件'
        }
        return item
      })
      that.setData({
        rankList: list,
        totalEmployees: data.total_employees || list.length
      })
    }).catch(function() {
      showError('加载排行榜失败')
    }).then(function() {
      that.setData({ loading: false })
    })
  }
})
