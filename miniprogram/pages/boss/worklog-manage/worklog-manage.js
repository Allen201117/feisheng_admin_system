const { callCloud, showError, showSuccess, showLoading, hideLoading, formatMoney, getToday } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')

Page({
  data: {
    mainTab: 'progress', // progress | detail
    viewType: 'day',
    dayDate: '',
    monthDate: '',
    orderMonth: '',
    orders: [],
    orderIndex: -1,
    selectedOrder: null,
    groupedLogs: [],
    summary: {
      count: 0,
      quantity: 0,
      amount: '0.00'
    },
    loading: false,

    // 进度总览
    progressOrderIndex: -1,
    progressOrder: null,
    progressData: null
  },

  onLoad() {
    const user = getStoredUser()
    if (!user || user.role !== 'boss') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }

    const today = getToday()
    this.setData({
      dayDate: today,
      monthDate: today.slice(0, 7),
      orderMonth: today.slice(0, 7)
    })

    this.loadOrders().then(() => {
      if (this.data.mainTab === 'progress') {
        this.autoSelectProgressOrder()
      } else {
        this.loadLogs()
      }
    })
  },

  onPullDownRefresh() {
    const p = this.data.mainTab === 'progress' ? this.loadOrderProgress() : this.loadLogs()
    p.finally(() => wx.stopPullDownRefresh())
  },

  switchMainTab(e) {
    const tab = e.currentTarget.dataset.tab
    if (tab === this.data.mainTab) return
    this.setData({ mainTab: tab })
    if (tab === 'progress') {
      this.autoSelectProgressOrder()
    } else {
      this.loadLogs()
    }
  },

  autoSelectProgressOrder() {
    if (this.data.orders.length > 0 && this.data.progressOrderIndex < 0) {
      this.setData({ progressOrderIndex: 0, progressOrder: this.data.orders[0] })
    }
    if (this.data.progressOrder) {
      this.loadOrderProgress()
    }
  },

  onProgressOrderChange(e) {
    const idx = Number(e.detail.value)
    this.setData({
      progressOrderIndex: idx,
      progressOrder: this.data.orders[idx] || null
    })
    this.loadOrderProgress()
  },

  async loadOrderProgress() {
    if (!this.data.progressOrder) {
      this.setData({ progressData: null })
      return
    }

    this.setData({ loading: true })
    showLoading('加载进度...')
    try {
      const res = await callCloud('worklog', {
        action: 'getOrderProgress',
        order_id: this.data.progressOrder._id
      })
      hideLoading()
      this.setData({ progressData: res.data || null })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载进度失败')
      this.setData({ progressData: null })
    } finally {
      this.setData({ loading: false })
    }
  },

  switchViewType(e) {
    const viewType = e.currentTarget.dataset.type
    if (viewType === this.data.viewType) return
    const updateData = { viewType, groupedLogs: [] }
    if (viewType === 'order' && !this.data.selectedOrder && this.data.orders.length > 0) {
      updateData.orderIndex = 0
      updateData.selectedOrder = this.data.orders[0]
    }
    this.setData(updateData)
    this.loadLogs()
  },

  onDayChange(e) {
    this.setData({ dayDate: e.detail.value })
    this.loadLogs()
  },

  onMonthChange(e) {
    this.setData({ monthDate: e.detail.value })
    this.loadLogs()
  },

  onOrderMonthChange(e) {
    this.setData({ orderMonth: e.detail.value })
    this.loadLogs()
  },

  onOrderChange(e) {
    const idx = Number(e.detail.value)
    this.setData({
      orderIndex: idx,
      selectedOrder: this.data.orders[idx] || null
    })
    this.loadLogs()
  },

  async loadOrders() {
    try {
      const res = await callCloud('order', { action: 'list' })
      const orders = (res.data || []).map(item => ({
        _id: item._id,
        order_name: item.order_name,
        display: `${item.order_name}（总量${item.total_quantity || 0}件）`
      }))

      this.setData({ orders })
    } catch (err) {
      showError(err.message || '加载订单失败')
    }
  },

  buildQuery() {
    if (this.data.viewType === 'day') {
      return {
        action: 'getManageLogs',
        view_type: 'day',
        date: this.data.dayDate
      }
    }

    if (this.data.viewType === 'month') {
      return {
        action: 'getManageLogs',
        view_type: 'month',
        month: this.data.monthDate
      }
    }

    if (!this.data.selectedOrder) return null
    return {
      action: 'getManageLogs',
      view_type: 'order',
      order_id: this.data.selectedOrder._id,
      month: this.data.orderMonth
    }
  },

  normalizeLogs(logs) {
    let totalQty = 0
    let totalAmount = 0

    const dateMap = {}
    logs.forEach((log) => {
      const day = log.date || '未知日期'
      if (!dateMap[day]) {
        dateMap[day] = {
          date: day,
          dayQty: 0,
          dayAmount: 0,
          items: []
        }
      }

      const qty = Number(log.quantity || 0)
      const amount = Math.round((qty || 0) * Number(log.snapshot_price || 0) * 100) / 100
      totalQty += qty
      totalAmount += amount
      dateMap[day].dayQty += qty
      dateMap[day].dayAmount += amount

      dateMap[day].items.push({
        ...log,
        amountDisplay: formatMoney(amount),
        statusText: log.status === 'inspected' ? '已质检' : '待质检',
        statusClass: log.status === 'inspected' ? 'tag-success' : 'tag-pending'
      })
    })

    const groupedLogs = Object.keys(dateMap)
      .sort()
      .reverse()
      .map((key) => ({
        ...dateMap[key],
        dayAmount: formatMoney(dateMap[key].dayAmount)
      }))

    this.setData({
      groupedLogs,
      summary: {
        count: logs.length,
        quantity: totalQty,
        amount: formatMoney(totalAmount)
      }
    })
  },

  async loadLogs() {
    const query = this.buildQuery()
    if (!query) {
      this.setData({
        groupedLogs: [],
        summary: { count: 0, quantity: 0, amount: '0.00' }
      })
      return
    }

    this.setData({ loading: true })
    showLoading('加载报工记录...')

    try {
      const res = await callCloud('worklog', query)
      hideLoading()
      this.normalizeLogs(res.data || [])
    } catch (err) {
      hideLoading()
      showError(err.message || '加载报工记录失败')
      this.setData({
        groupedLogs: [],
        summary: { count: 0, quantity: 0, amount: '0.00' }
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  onDeleteLog(e) {
    const log = e.currentTarget.dataset.log
    if (!log || !log._id) return

    wx.showModal({
      title: '确认删除',
      content: `员工：${log.user_name || '未知'}\n订单：${log.order_name || '未知'}\n数量：${log.quantity || 0}件\n\n删除后将同步影响统计与报表。`,
      confirmText: '删除',
      confirmColor: '#FF4D4F',
      success: async (res) => {
        if (!res.confirm) return
        showLoading('删除中...')
        try {
          await callCloud('worklog', {
            action: 'deleteWorkLog',
            log_id: log._id,
            reason: '老板在报工管理页面删除记录'
          })
          hideLoading()
          showSuccess('删除成功')
          this.loadLogs()
        } catch (err) {
          hideLoading()
          showError(err.message || '删除失败')
        }
      }
    })
  }
})
