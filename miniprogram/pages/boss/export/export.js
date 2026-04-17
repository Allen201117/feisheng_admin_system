// pages/boss/export/export.js — V2: 按月/按年/按订单 × 汇总/细节
const { callCloud, showError, showSuccess, showLoading, hideLoading, showConfirm } = require('../../../utils/util')

Page({
  data: {
    // —— 第一层：统计维度 ——
    dimension: 'month', // 'month' | 'year' | 'order'
    // —— 第二层：报表类型 ——
    reportType: 'summary', // 'summary' | 'detail'

    // 筛选条件
    month: '',
    year: '',
    orderList: [],
    selectedOrderIdx: 0,
    selectedOrderName: '',
    selectedOrderId: '',

    // 路径提示
    pathHint: '',

    // 状态
    loading: false,
    exporting: false,

    // 表格
    tableTitle: '',
    tableHeaders: [],
    tableRows: [],
    tableLoaded: false,

    // 导出历史
    historyList: []
  },

  async downloadAndOpenFile(fileId, successMessage) {
    showLoading('正在下载文件...')

    try {
      const downloadRes = await wx.cloud.downloadFile({
        fileID: fileId
      })

      if (!downloadRes.tempFilePath) {
        throw new Error('未获取到临时文件')
      }

      const saveRes = await wx.saveFile({
        tempFilePath: downloadRes.tempFilePath
      })

      hideLoading()

      const savedFilePath = saveRes.savedFilePath || downloadRes.tempFilePath
      wx.openDocument({
        filePath: savedFilePath,
        fileType: 'xlsx',
        showMenu: true,
        success: () => {
          showSuccess(successMessage || '文件已保存并打开')
        },
        fail: () => {
          showSuccess('文件已保存到本地')
        }
      })

      return savedFilePath
    } catch (err) {
      hideLoading()
      throw err
    }
  },

  onLoad() {
    const bjTime = require('../../../utils/beijing-time')
    const f = bjTime.getBeijingFields()
    this.setData({
      month: f.year + '-' + String(f.month).padStart(2, '0'),
      year: String(f.year)
    })
    this._updatePathHint()
    this._loadHistory()
  },

  onShow() {
    // 如果当前是按订单维度，刷新订单列表
    if (this.data.dimension === 'order' && this.data.orderList.length === 0) {
      this._loadOrders()
    }
  },

  // ========== 维度切换 ==========
  switchDimension(e) {
    const dim = e.currentTarget.dataset.dim
    this.setData({
      dimension: dim,
      tableLoaded: false,
      tableHeaders: [],
      tableRows: [],
      tableTitle: ''
    })
    this._updatePathHint()
    if (dim === 'order' && this.data.orderList.length === 0) {
      this._loadOrders()
    }
  },

  // ========== 报表类型切换 ==========
  switchReportType(e) {
    const type = e.currentTarget.dataset.type
    this.setData({
      reportType: type,
      tableLoaded: false,
      tableHeaders: [],
      tableRows: [],
      tableTitle: ''
    })
    this._updatePathHint()
  },

  // ========== 筛选条件 ==========
  onMonthChange(e) {
    this.setData({ month: e.detail.value })
    this._updatePathHint()
  },

  onYearChange(e) {
    this.setData({ year: e.detail.value })
    this._updatePathHint()
  },

  onOrderChange(e) {
    const idx = parseInt(e.detail.value)
    const order = this.data.orderList[idx]
    if (order) {
      this.setData({
        selectedOrderIdx: idx,
        selectedOrderName: order.order_name,
        selectedOrderId: order._id
      })
      this._updatePathHint()
    }
  },

  // ========== 路径提示 ==========
  _updatePathHint() {
    const dim = this.data.dimension
    const rt = this.data.reportType
    const dimLabels = { month: '按月', year: '按年', order: '按订单' }
    const rtLabels = { summary: '汇总表', detail: '明细表' }

    let filterLabel = ''
    if (dim === 'month') filterLabel = this.data.month || '未选'
    else if (dim === 'year') filterLabel = this.data.year + '年'
    else filterLabel = this.data.selectedOrderName || '未选'

    this.setData({
      pathHint: `${dimLabels[dim]} → ${rtLabels[rt]}（${filterLabel}）`
    })
  },

  // ========== 加载订单列表 ==========
  async _loadOrders() {
    try {
      const res = await callCloud('export', { action: 'getOrderList' })
      const list = res.data || []
      this.setData({ orderList: list })
      if (list.length > 0 && !this.data.selectedOrderId) {
        this.setData({
          selectedOrderIdx: 0,
          selectedOrderName: list[0].order_name,
          selectedOrderId: list[0]._id
        })
        this._updatePathHint()
      }
    } catch (err) {
      console.error('加载订单列表失败', err)
    }
  },

  // ========== 加载导出历史 ==========
  async _loadHistory() {
    try {
      const res = await callCloud('export', { action: 'getHistory' })
      this.setData({ historyList: res.data || [] })
    } catch (err) {
      console.error('加载历史失败', err)
    }
  },

  // ========== 预览报表 ==========
  async onLoadTable() {
    const { dimension, reportType, month, year, selectedOrderId } = this.data

    // 参数校验
    if (dimension === 'order' && !selectedOrderId) {
      return showError('请先选择订单')
    }

    this.setData({ loading: true, tableLoaded: false })
    showLoading('加载报表数据...')

    try {
      const res = await callCloud('export', {
        action: 'getTableDataV2',
        dimension,
        report_type: reportType,
        month,
        year,
        order_id: selectedOrderId
      })

      hideLoading()
      const data = res.data || {}
      this.setData({
        tableTitle: data.title || '',
        tableHeaders: data.headers || [],
        tableRows: data.rows || [],
        tableLoaded: true
      })

      if ((data.rows || []).length === 0) {
        showError('该条件下无数据')
      }
    } catch (err) {
      hideLoading()
      showError(err.message || '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  // ========== 导出Excel ==========
  async onExport() {
    if (!this.data.tableLoaded || this.data.tableRows.length === 0) {
      return showError('请先预览报表，确认数据后再导出')
    }

    const { dimension, reportType, month, year, selectedOrderId } = this.data
    const rtLabel = reportType === 'summary' ? '汇总表' : '明细表'
    const dimLabels = { month: '按月', year: '按年', order: '按订单' }

    const confirmed = await showConfirm(
      '确认导出',
      `将导出「${dimLabels[dimension]} · ${rtLabel}」为Excel文件（${this.data.tableRows.length}行数据），确定吗？`
    )
    if (!confirmed) return

    this.setData({ exporting: true })
    showLoading('正在生成Excel...')

    try {
      const res = await callCloud('export', {
        action: 'exportToFileV2',
        dimension,
        report_type: reportType,
        month,
        year,
        order_id: selectedOrderId
      })

      hideLoading()

      if (res.data && res.data.file_id) {
        await this.downloadAndOpenFile(res.data.file_id, '导出成功，文件已保存')
        this._loadHistory()
      }
    } catch (err) {
      hideLoading()
      showError(err.message || '导出失败')
    } finally {
      this.setData({ exporting: false })
    }
  },

  // ========== 重新下载历史文件 ==========
  async onRedownload(e) {
    const fileId = e.currentTarget.dataset.fileid
    if (!fileId) return showError('文件记录异常')

    try {
      await this.downloadAndOpenFile(fileId, '文件已重新下载并打开')
    } catch (err) {
      showError('下载失败，文件可能已过期')
    }
  }
})