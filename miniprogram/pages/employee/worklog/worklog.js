// pages/employee/worklog/worklog.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, formatMoney, formatDateTime, getToday } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')

Page({
  data: {
    userInfo: null,
    processes: [],
    selectedProcess: null,
    selectedProcessIndex: -1,
    quantity: 0,
    todayLogs: [],
    todayTotal: '0.00',
    loading: false,
    // 编辑报工
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
      const processes = (res.data || []).map(p => ({
        ...p,
        display: `${p.order_name} - ${p.process_name} (¥${p.current_price}/件)`
      }))
      this.setData({ processes })
    } catch (e) {
      console.error('加载工序失败', e)
    }
  },

  async loadTodayLogs() {
    try {
      const res = await callCloud('worklog', {
        action: 'getUserLogs',
        user_id: this.data.userInfo._id
      })
      const logs = res.data || []
      let total = 0
      logs.forEach(log => {
        total += (log.quantity || 0) * (log.snapshot_price || 0)
      })
      this.setData({
        todayLogs: logs,
        todayTotal: formatMoney(total)
      })
    } catch (e) {
      console.error('加载今日报工失败', e)
    }
  },

  onProcessChange(e) {
    const idx = Number(e.detail.value)
    this.setData({
      selectedProcessIndex: idx,
      selectedProcess: this.data.processes[idx]
    })
  },

  onQuantityInput(e) {
    const val = parseInt(e.detail.value) || 0
    this.setData({ quantity: val })
  },

  addQty() {
    this.setData({ quantity: this.data.quantity + 1 })
  },

  subQty() {
    if (this.data.quantity > 0) {
      this.setData({ quantity: this.data.quantity - 1 })
    }
  },

  addQty10() {
    this.setData({ quantity: this.data.quantity + 10 })
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
      this.loadTodayLogs()
    } catch (err) {
      hideLoading()
      showError(err.message || '报工失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  getStatusText(status) {
    return status === 'inspected' ? '已质检' : '待质检'
  },

  // ========== 编辑报工 ==========
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
    this.setData({ editQuantity: parseInt(e.detail.value) || 0 })
  },

  onEditNoteInput(e) {
    this.setData({ editNote: e.detail.value })
  },

  onEditReasonChange(e) {
    const idx = parseInt(e.detail.value)
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
  }
})
