const { callCloud, showError, showLoading, hideLoading, formatMoney } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const {
  getInitialPeriodState,
  isPeriodMode,
  getPeriodDisplayLabel,
  getReportRequestParams,
  getPeriodPathHint,
  getEmptyTableState
} = require('./data-center.logic')

Page({
  data: {
    viewMode: 'month',
    month: '',
    year: '',
    reportType: 'summary',
    periodDisplayLabel: '',
    pathHint: '',
    tableTitle: '',
    tableHeaders: [],
    tableRows: [],
    tableLoaded: false,
    orderList: [],
    selectedOrder: null,
    orderWorklogs: [],
    orderSummary: {},
    loading: false
  },

  onLoad() {
    const user = getStoredUser()
    if (!user || user.role !== 'boss') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }

    const initialState = getInitialPeriodState()
    this.setData({
      ...initialState,
      periodDisplayLabel: getPeriodDisplayLabel('month', initialState),
      pathHint: getPeriodPathHint('month', initialState.reportType, initialState)
    })
    this.loadPeriodTable()
  },

  getCurrentPeriodState(overrides = {}) {
    const nextState = {
      month: overrides.month !== undefined ? overrides.month : this.data.month,
      year: overrides.year !== undefined ? overrides.year : this.data.year,
      reportType: overrides.reportType !== undefined ? overrides.reportType : this.data.reportType
    }

    return {
      ...nextState,
      periodDisplayLabel: getPeriodDisplayLabel(this.data.viewMode, nextState),
      pathHint: getPeriodPathHint(this.data.viewMode, nextState.reportType, nextState)
    }
  },

  resetReportTable() {
    this.setData(getEmptyTableState())
  },

  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    if (!mode || mode === this.data.viewMode) return

    if (isPeriodMode(mode)) {
      const nextState = {
        viewMode: mode,
        selectedOrder: null,
        orderWorklogs: [],
        orderSummary: {},
        ...getEmptyTableState(),
        periodDisplayLabel: getPeriodDisplayLabel(mode, this.data),
        pathHint: getPeriodPathHint(mode, this.data.reportType, this.data)
      }
      this.setData(nextState)
      this.loadPeriodTable()
      return
    }

    this.setData({
      viewMode: mode,
      selectedOrder: null,
      orderWorklogs: [],
      orderSummary: {}
    })
    this.loadOrders()
  },

  onMonthChange(e) {
    const nextState = this.getCurrentPeriodState({ month: e.detail.value })
    this.setData({
      month: nextState.month,
      periodDisplayLabel: nextState.periodDisplayLabel,
      pathHint: nextState.pathHint,
      ...getEmptyTableState()
    })
    this.loadPeriodTable()
  },

  onYearChange(e) {
    const nextState = this.getCurrentPeriodState({ year: e.detail.value })
    this.setData({
      year: nextState.year,
      periodDisplayLabel: nextState.periodDisplayLabel,
      pathHint: nextState.pathHint,
      ...getEmptyTableState()
    })
    this.loadPeriodTable()
  },

  switchReportType(e) {
    const reportType = e.currentTarget.dataset.type
    if (!reportType || reportType === this.data.reportType) return

    const nextState = this.getCurrentPeriodState({ reportType })
    this.setData({
      reportType: nextState.reportType,
      periodDisplayLabel: nextState.periodDisplayLabel,
      pathHint: nextState.pathHint,
      ...getEmptyTableState()
    })
    this.loadPeriodTable()
  },

  getReportParams() {
    return getReportRequestParams(this.data.viewMode, this.data)
  },

  async loadPeriodTable() {
    if (!isPeriodMode(this.data.viewMode)) return

    this.setData({ loading: true })
    showLoading('加载报表数据...')

    try {
      const res = await callCloud('export', {
        action: 'getTableDataV2',
        ...this.getReportParams()
      })
      hideLoading()

      const tableData = res.data || {}
      this.setData({
        tableTitle: tableData.title || '',
        tableHeaders: tableData.headers || [],
        tableRows: tableData.rows || [],
        tableLoaded: true
      })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载报表失败')
      this.setData(getEmptyTableState())
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadOrders() {
    this.setData({
      loading: true,
      selectedOrder: null,
      orderWorklogs: [],
      orderSummary: {}
    })
    showLoading('加载订单列表...')

    try {
      const res = await callCloud('order', { action: 'list' })
      hideLoading()

      const orderList = (res.data || []).map((order) => ({
        ...order,
        displayAmount: formatMoney(order.total_amount || 0),
        statusText: order.status === 'completed'
          ? '已完成'
          : order.status === 'cancelled'
            ? '已取消'
            : '进行中'
      }))

      this.setData({ orderList })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载订单失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  async onOrderTap(e) {
    const order = e.currentTarget.dataset.order
    if (!order) return

    this.setData({ selectedOrder: order, loading: true })
    showLoading('加载订单详情...')

    try {
      const res = await callCloud('order', {
        action: 'getDetail',
        order_id: order._id
      })
      hideLoading()

      const detail = res.data || {}
      const worklogs = detail.worklogs || []
      let totalCost = 0
      let totalQty = 0

      worklogs.forEach((worklog) => {
        totalCost += worklog.amount || 0
        totalQty += worklog.quantity || 0
      })

      this.setData({
        orderWorklogs: worklogs,
        orderSummary: {
          totalCost: formatMoney(totalCost),
          totalQty,
          logCount: worklogs.length,
          processes: detail.processes || []
        }
      })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载订单详情失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  onBackToOrders() {
    this.setData({
      selectedOrder: null,
      orderWorklogs: [],
      orderSummary: {}
    })
  },

  onPullDownRefresh() {
    const loader = isPeriodMode(this.data.viewMode)
      ? this.loadPeriodTable.bind(this)
      : this.loadOrders.bind(this)

    loader().finally(() => wx.stopPullDownRefresh())
  }
})
