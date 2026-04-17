// pages/employee/worklog/worklog.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, formatMoney } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const { normalizeAssignedProcessForEmployee } = require('./worklog.logic')

Page({
  data: {
    userInfo: null,
    processes: [],
    selectedProcess: null,
    selectedProcessIndex: -1,
    quantity: 0,
    quickQuantities: [50, 100, 200, 500],
    quotaInfo: null,
    quotaLoading: false,
    todayLogs: [],
    todayTotal: '0.00',
    loading: false,
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
    this.loadAssignedProcesses()
    this.loadTodayLogs()
  },

  async loadAssignedProcesses() {
    try {
      const res = await callCloud('order', {
        action: 'getAssignedProcesses',
        user_id: this.data.userInfo._id
      })
      const processes = (res.data || []).map(normalizeAssignedProcessForEmployee)
      this.setData({ processes })
    } catch (e) {
      console.error('加载工序失败', e)
    }
  },

  async loadTodayLogs() {
    try {
      const res = await callCloud('worklog', {
        action: 'getTodayEarnings',
        user_id: this.data.userInfo._id
      })
      const data = res.data || {}
      const logs = data.logs || []
      this.setData({
        todayLogs: logs,
        todayTotal: formatMoney(data.earnings || 0)
      })
    } catch (e) {
      console.error('加载今日报工失败', e)
    }
  },

  onProcessChange(e) {
    const idx = Number(e.detail.value)
    this.setData({
      selectedProcessIndex: idx,
      selectedProcess: this.data.processes[idx],
      quotaInfo: null
    })
    this.loadProcessQuota()
  },

  onQuantityInput(e) {
    const val = parseInt((e.detail.value || '').replace(/[^0-9]/g, ''), 10) || 0
    this.setData({ quantity: val })
    this.warnIfQuantityExceeded(val)
  },

  onQuickQuantityTap(e) {
    const val = parseInt(e.currentTarget.dataset.value, 10) || 0
    this.setData({ quantity: val })
    this.warnIfQuantityExceeded(val)
  },

  onClearQuantity() {
    this.setData({ quantity: 0 })
  },

  async loadProcessQuota() {
    if (!this.data.selectedProcess) return

    this.setData({ quotaLoading: true })
    try {
      const res = await callCloud('worklog', {
        action: 'getProcessQuota',
        order_id: this.data.selectedProcess.order_id,
        process_id: this.data.selectedProcess._id
      })
      this.setData({ quotaInfo: res.data || null })
      this.warnIfQuantityExceeded(this.data.quantity)
    } catch (err) {
      this.setData({ quotaInfo: null })
    } finally {
      this.setData({ quotaLoading: false })
    }
  },

  warnIfQuantityExceeded(inputQty) {
    const quota = this.data.quotaInfo
    if (!quota) return
    if (inputQty > (quota.remaining_quantity || 0)) {
      showError('报工数量超过剩余可报数量')
    }
  },

  async verifyQuotaBeforeSubmit() {
    const selected = this.data.selectedProcess
    const qty = this.data.quantity
    if (!selected) return false

    const res = await callCloud('worklog', {
      action: 'getProcessQuota',
      order_id: selected.order_id,
      process_id: selected._id
    })

    const quota = res.data || {}
    this.setData({ quotaInfo: quota })

    if (qty > (quota.remaining_quantity || 0)) {
      showError('报工数量超过剩余可报数量')
      return false
    }
    return true
  },

  async onSubmit() {
    if (!this.data.selectedProcess) {
      showError('请先选择工序')
      return
    }
    if (this.data.quantity <= 0) {
      showError('请输入有效的完成数量')
      return
    }

    try {
      const canSubmit = await this.verifyQuotaBeforeSubmit()
      if (!canSubmit) return
    } catch (err) {
      showError(err.message || '获取剩余可报数量失败')
      return
    }

    this.setData({ loading: true })
    showLoading('提交中...')

    try {
      await callCloud('worklog', {
        action: 'submit',
        user_id: this.data.userInfo._id,
        user_name: this.data.userInfo.name,
        process_id: this.data.selectedProcess._id,
        order_id: this.data.selectedProcess.order_id,
        quantity: this.data.quantity
      })

      hideLoading()
      showSuccess('报工成功')
      this.setData({ quantity: 0 })
      this.loadProcessQuota()
      this.loadTodayLogs()
    } catch (err) {
      hideLoading()
      showError(err.message || '报工失败')
    } finally {
      this.setData({ loading: false })
    }
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
      this.loadTodayLogs()
    } catch (err) {
      hideLoading()
      showError(err.message || '修改失败')
    }
  },

  async onCancelLog(e) {
    const log = e.currentTarget.dataset.log
    if (!log || !log._id) return

    if (log.is_locked) {
      showError(log.lock_reason || '该记录已锁定')
      return
    }

    if (!log.is_today) {
      showError('仅支持撤销当日报工记录')
      return
    }

    wx.showModal({
      title: '确认撤销',
      content: `工序：${log.process_name || '未知'}\n数量：${log.quantity || 0}件\n\n撤销后本条报工将删除并立即影响统计与薪资。`,
      confirmText: '撤销',
      confirmColor: '#FF4D4F',
      success: async (res) => {
        if (!res.confirm) return
        showLoading('撤销中...')
        try {
          await callCloud('worklog', {
            action: 'cancelOwnWorkLog',
            log_id: log._id,
            reason: '员工前端主动撤销误报'
          })
          hideLoading()
          showSuccess('撤销成功')
          this.loadTodayLogs()
          this.loadProcessQuota()
        } catch (err) {
          hideLoading()
          showError(err.message || '撤销失败')
        }
      }
    })
  }
})
