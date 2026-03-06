// pages/boss/leaderboard/leaderboard.js
// 排行榜：3周期(月/订单/年) × 3维度(工时/薪资/品质)
var util = require('../../../utils/util')
var callCloud = util.callCloud
var showError = util.showError

Page({
  data: {
    // 周期 tab: monthly / order / yearly
    periodTab: 'monthly',
    periodTabs: [
      { key: 'monthly', label: '本月' },
      { key: 'order', label: '按订单' },
      { key: 'yearly', label: '年度' }
    ],
    // 维度 tab: hours / salary / quality
    dimTab: 'hours',
    dimTabs: [
      { key: 'hours', label: '工时' },
      { key: 'salary', label: '薪资' },
      { key: 'quality', label: '品质' }
    ],
    // 月份选择
    month: '',
    monthDisplay: '',
    // 年份选择
    year: '',
    yearDisplay: '',
    // 订单选择
    orderList: [],
    orderNames: [],
    selectedOrderIdx: 0,
    selectedOrderId: '',
    // 排行数据
    rankList: [],
    totalEmployees: 0,
    loading: false
  },

  onLoad: function() {
    var now = new Date()
    var y = now.getFullYear()
    var m = now.getMonth() + 1
    this.setData({
      month: y + '-' + String(m).padStart(2, '0'),
      monthDisplay: y + '年' + m + '月',
      year: String(y),
      yearDisplay: y + '年'
    })
  },

  onShow: function() {
    this.loadRank()
  },

  onPullDownRefresh: function() {
    this.loadRank().then(function() {
      wx.stopPullDownRefresh()
    })
  },

  // 切换周期
  switchPeriod: function(e) {
    var tab = e.currentTarget.dataset.key
    this.setData({ periodTab: tab, rankList: [] })
    if (tab === 'order' && this.data.orderList.length === 0) {
      this.loadOrders()
    } else {
      this.loadRank()
    }
  },

  // 切换维度
  switchDim: function(e) {
    var key = e.currentTarget.dataset.key
    this.setData({ dimTab: key })
    this.loadRank()
  },

  // 月份变更
  onMonthChange: function(e) {
    var val = e.detail.value
    var parts = val.split('-')
    this.setData({
      month: val,
      monthDisplay: parts[0] + '年' + parseInt(parts[1]) + '月'
    })
    this.loadRank()
  },

  // 年份变更（用picker列表模拟）
  onYearChange: function(e) {
    var idx = parseInt(e.detail.value)
    var years = this.getYearList()
    var y = years[idx]
    this.setData({
      year: String(y),
      yearDisplay: y + '年'
    })
    this.loadRank()
  },

  getYearList: function() {
    var now = new Date().getFullYear()
    var list = []
    for (var i = now; i >= now - 5; i--) list.push(i)
    return list
  },

  // 订单选择变更
  onOrderChange: function(e) {
    var idx = parseInt(e.detail.value)
    var order = this.data.orderList[idx]
    this.setData({
      selectedOrderIdx: idx,
      selectedOrderId: order ? order._id : ''
    })
    this.loadRank()
  },

  // 加载订单列表
  loadOrders: function() {
    var that = this
    return callCloud('order', { action: 'list' }).then(function(res) {
      var orders = res.data || []
      var names = orders.map(function(o) { return o.order_name || o.name || '未命名' })
      that.setData({
        orderList: orders,
        orderNames: names,
        selectedOrderIdx: 0,
        selectedOrderId: orders.length > 0 ? orders[0]._id : ''
      })
      if (orders.length > 0) that.loadRank()
    }).catch(function() {
      showError('加载订单失败')
    })
  },

  // 加载排行数据
  loadRank: function() {
    var that = this
    var period = this.data.periodTab
    var dim = this.data.dimTab
    var actionMap = { monthly: 'getMonthlyRank', order: 'getOrderRank', yearly: 'getYearlyRank' }
    var params = { action: actionMap[period], dimension: dim }

    if (period === 'monthly') {
      params.month = this.data.month
    } else if (period === 'yearly') {
      params.year = this.data.year
    } else if (period === 'order') {
      if (!this.data.selectedOrderId) {
        that.setData({ rankList: [], totalEmployees: 0 })
        return Promise.resolve()
      }
      params.order_id = this.data.selectedOrderId
    }

    that.setData({ loading: true })
    return callCloud('leaderboard', params).then(function(res) {
      var data = res.data || {}
      var list = data.list || []
      // 格式化显示值
      list = list.map(function(item) {
        if (dim === 'hours') {
          item.displayValue = (item.total_hours || 0) + 'h'
          item.displaySub = '出勤' + (item.attend_days || 0) + '天'
        } else if (dim === 'salary') {
          item.displayValue = '¥' + (item.total_salary || 0).toFixed(2)
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