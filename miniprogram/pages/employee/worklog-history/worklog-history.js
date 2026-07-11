// pages/employee/worklog-history/worklog-history.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, formatMoney } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const { buildWorklogHistoryView, formatLogAmountText } = require('../worklog/worklog.logic')
const { filterListByKeyword } = require('../../../utils/list-search')

const HISTORY_SEARCH_FIELDS = [
  'order_name',
  'process_name',
  'date',
  'report_time_text',
  'note',
  'quantity',
  (log) => log.status === 'inspected' ? '已质检' : '待质检'
]

Page({
  data: {
    userInfo: null,
    rawHistoryLogs: [],
    historyLogs: [],
    historySearchKeyword: '',
    overviewCards: [],
    payrollMode: 'monthly',
    historySummaryLabel: '本月报工金额',
    historyTotal: '0.00',
    historyQuantity: 0,
    historyCount: 0,
    showEditLog: false,
    editLog: null,
    editQuantity: 0,
    editNote: '',
    editReason: '',
    editReasonIndex: -1,
    editReasons: ['录入错误', '数量填多了', '数量填少了', '其他原因']
  },

  onLoad() {
    const user = getStoredUser()
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({ userInfo: user })
  },

  onShow() {
    this.loadHistoryLogs()
  },

  onPullDownRefresh() {
    this.loadHistoryLogs().then(() => wx.stopPullDownRefresh())
  },

  async loadHistoryLogs() {
    try {
      const res = await callCloud('worklog', {
        action: 'getUserPayrollLogs',
        user_id: this.data.userInfo._id
      })
      const payload = res.data || {}
      const logs = Array.isArray(payload) ? payload : (payload.logs || [])
      const payrollMode = payload.payroll_mode === 'order' ? 'order' : 'monthly'
      this.setData({
        rawHistoryLogs: logs,
        payrollMode,
        historySummaryLabel: payrollMode === 'order' ? '订单报工金额' : '本月报工金额'
      })
      this.applyHistorySearch(this.data.historySearchKeyword, logs)
    } catch (e) {
      console.error('加载历史报工失败', e)
      this.setData({
        rawHistoryLogs: [],
        historyLogs: [],
        overviewCards: [],
        historyTotal: '0.00',
        historyQuantity: 0,
        historyCount: 0
      })
    }
  },

  applyHistorySearch(keyword, sourceLogs) {
    const rawLogs = Array.isArray(sourceLogs) ? sourceLogs : this.data.rawHistoryLogs
    const filtered = filterListByKeyword(rawLogs, keyword, HISTORY_SEARCH_FIELDS)
    // 明细金额在数据层格式化为两位小数，避免 WXML 模板直接算 quantity*snapshot_price 露出浮点误差
    const historyLogs = filtered.map((log) => ({ ...log, amount_text: formatLogAmountText(log) }))
    const view = buildWorklogHistoryView(filtered)
    this.setData({
      historySearchKeyword: keyword,
      historyLogs,
      overviewCards: view.overviewCards,
      historyTotal: view.hasHiddenAmount ? '已隐藏' : formatMoney(view.totalAmount || 0),
      historyQuantity: view.totalQuantity || 0,
      historyCount: view.totalCount || 0
    })
  },

  onHistorySearchInput(e) {
    this.applyHistorySearch(e.detail.value)
  },

  clearHistorySearch() {
    if (!this.data.historySearchKeyword) return
    this.applyHistorySearch('')
  },

  onEditLog(e) {
    const log = e.currentTarget.dataset.log
    if (log.is_locked) {
      showError(log.lock_reason || '该记录已锁定')
      return
    }
    this.setData({
      showEditLog: true,
      editLog: log,
      editQuantity: log.quantity,
      editNote: log.note || '',
      editReason: '',
      editReasonIndex: -1
    })
  },

  closeEditLog() {
    this.setData({ showEditLog: false, editLog: null })
  },

  onEditQtyInput(e) {
    this.setData({ editQuantity: parseInt(e.detail.value, 10) || 0 })
  },

  onEditNoteInput(e) {
    this.setData({ editNote: e.detail.value })
  },

  onEditReasonChange(e) {
    const idx = parseInt(e.detail.value, 10)
    this.setData({
      editReasonIndex: idx,
      editReason: this.data.editReasons[idx]
    })
  },

  onEditReasonInput(e) {
    this.setData({ editReason: e.detail.value })
  },

  async onSaveEditLog() {
    if (this.data.editQuantity <= 0) {
      showError('报工数量必须大于0')
      return
    }
    if (!this.data.editReason) {
      showError('请选择或输入修改原因')
      return
    }

    showLoading('修改中...')
    try {
      await callCloud('worklog', {
        action: 'updateWorkLog',
        log_id: this.data.editLog._id,
        quantity: this.data.editQuantity,
        note: this.data.editNote,
        reason: this.data.editReason
      })
      hideLoading()
      showSuccess('修改成功')
      this.setData({ showEditLog: false, editLog: null })
      this.loadHistoryLogs()
    } catch (err) {
      hideLoading()
      showError(err.message || '修改失败')
    }
  },

  async onDeleteLog(e) {
    const log = e.currentTarget.dataset.log
    if (!log || !log._id) return

    if (log.is_locked) {
      showError(log.lock_reason || '该记录已锁定')
      return
    }

    wx.showModal({
      title: '确认删除',
      content: `工序：${log.process_name || '未知'}\n数量：${log.quantity || 0}件\n\n删除后本条历史报工将移除，并立即影响统计与薪资。`,
      confirmText: '删除',
      confirmColor: '#FF4D4F',
      success: async (res) => {
        if (!res.confirm) return
        showLoading('删除中...')
        try {
          await callCloud('worklog', {
            action: 'cancelOwnWorkLog',
            log_id: log._id,
            reason: '员工删除历史误报'
          })
          hideLoading()
          showSuccess('删除成功')
          this.loadHistoryLogs()
        } catch (err) {
          hideLoading()
          showError(err.message || '删除失败')
        }
      }
    })
  }
})
