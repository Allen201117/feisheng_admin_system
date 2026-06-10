const { callCloud, showError, showLoading, hideLoading } = require('../../../utils/util')
const { buildTableColumnMeta } = require('../../../utils/table-meta.logic')
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
    tableColMeta: [],
    tableLoaded: false,
    orderList: [],
    selectedOrder: null,
    orderReportType: 'detail', // detail=报工核算表 / summary=工资核算表
    orderTableTitle: '',
    orderTableHeaders: [],
    orderTableRows: [],
    orderTableColMeta: [],
    orderTableLoaded: false,
    orderProgress: [],
    orderOverallProgress: 0,
    orderTotalReported: 0,
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
        orderTableLoaded: false,
        orderProgress: [],
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
      orderTableLoaded: false,
      orderProgress: []
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
        tableColMeta: buildTableColumnMeta(tableData.headers || [], tableData.rows || []),
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
      orderTableLoaded: false,
      orderProgress: []
    })
    showLoading('加载订单列表...')

    try {
      const res = await callCloud('order', { action: 'list' })
      hideLoading()

      const orderList = (res.data || []).map((order) => ({
        ...order,
        totalQuantity: order.total_quantity || order.order_total_quantity || 0,
        processCount: order.process_count || 0,
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

  onOrderTap(e) {
    const order = e.currentTarget.dataset.order
    if (!order) return
    this.setData({ selectedOrder: order, orderReportType: 'detail' })
    this.loadOrderReport()
    this.loadOrderProgress()
  },

  switchOrderReportType(e) {
    const type = e.currentTarget.dataset.type
    if (!type || type === this.data.orderReportType) return
    this.setData({
      orderReportType: type,
      orderTableTitle: '',
      orderTableHeaders: [],
      orderTableRows: [],
      orderTableColMeta: [],
      orderTableLoaded: false
    })
    this.loadOrderReport()
  },

  // 订单核算表预览：复用 export.getTableDataV2（与导出同一份口径，避免第5套统计）
  async loadOrderReport() {
    const order = this.data.selectedOrder
    if (!order) return

    this.setData({ loading: true })
    showLoading('加载核算表...')

    try {
      const res = await callCloud('export', {
        action: 'getTableDataV2',
        dimension: 'order',
        order_id: order._id,
        report_type: this.data.orderReportType
      })
      hideLoading()

      const tableData = res.data || {}
      this.setData({
        orderTableTitle: tableData.title || '',
        orderTableHeaders: tableData.headers || [],
        orderTableRows: tableData.rows || [],
        orderTableColMeta: buildTableColumnMeta(tableData.headers || [], tableData.rows || []),
        orderTableLoaded: true
      })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载核算表失败')
      this.setData({
        orderTableTitle: '',
        orderTableHeaders: [],
        orderTableRows: [],
        orderTableColMeta: [],
        orderTableLoaded: true
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  // 工序进度（真实报工聚合，替代原先永远为 0 的假数据）
  async loadOrderProgress() {
    const order = this.data.selectedOrder
    if (!order) return

    try {
      const res = await callCloud('worklog', {
        action: 'getOrderProgress',
        order_id: order._id
      })
      const data = res.data || {}
      const progressList = (data.processes || []).map(item => ({
        ...item,
        progress_percent: Math.min(item.progress_percent || 0, 100)
      }))
      let totalReported = 0
      progressList.forEach(item => { totalReported += item.total_reported || 0 })
      this.setData({
        orderProgress: progressList,
        orderOverallProgress: data.overall_percent || 0,
        orderTotalReported: totalReported
      })
    } catch (err) {
      // 进度加载失败不阻塞核算表展示，但要让老板知道
      console.error('[data-center] 加载工序进度失败', err)
      this.setData({ orderProgress: [], orderOverallProgress: 0, orderTotalReported: 0 })
    }
  },

  onBackToOrders() {
    this.setData({
      selectedOrder: null,
      orderTableTitle: '',
      orderTableHeaders: [],
      orderTableRows: [],
      orderTableColMeta: [],
      orderTableLoaded: false,
      orderProgress: [],
      orderOverallProgress: 0,
      orderTotalReported: 0
    })
  },

  onPullDownRefresh() {
    let loader
    if (isPeriodMode(this.data.viewMode)) {
      loader = this.loadPeriodTable.bind(this)
    } else if (this.data.selectedOrder) {
      loader = () => Promise.all([this.loadOrderReport(), this.loadOrderProgress()])
    } else {
      loader = this.loadOrders.bind(this)
    }

    loader().finally(() => wx.stopPullDownRefresh())
  }
})
