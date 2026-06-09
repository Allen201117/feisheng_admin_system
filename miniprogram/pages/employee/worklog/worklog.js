// pages/employee/worklog/worklog.js
const { callCloud, showError, showSuccess, showLoading, hideLoading } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const { normalizeAssignedProcessForEmployee } = require('./worklog.logic')

Page({
  data: {
    userInfo: null,
    processes: [],
    selectedProcess: null,
    selectedProcessIndex: -1,
    initialProcessId: '',
    quantity: 0,
    quickQuantities: [50, 100, 200, 500],
    quotaInfo: null,
    quotaLoading: false,
    loading: false
  },

  onLoad(options = {}) {
    const user = getStoredUser()
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({
      userInfo: user,
      initialProcessId: options.process_id || ''
    })
  },

  onShow() {
    this.loadAssignedProcesses()
  },

  async loadAssignedProcesses() {
    try {
      const res = await callCloud('order', {
        action: 'getAssignedProcesses',
        user_id: this.data.userInfo._id
      })
      const processes = (res.data || []).map(normalizeAssignedProcessForEmployee)
      const targetProcessId = this.data.initialProcessId || (this.data.selectedProcess && this.data.selectedProcess._id) || ''
      const selectedProcessIndex = targetProcessId
        ? processes.findIndex((item) => String(item._id) === String(targetProcessId))
        : -1
      const selectedProcess = selectedProcessIndex >= 0 ? processes[selectedProcessIndex] : null

      this.setData({
        processes,
        selectedProcessIndex,
        selectedProcess,
        quotaInfo: selectedProcess ? null : this.data.quotaInfo
      })

      if (selectedProcess) {
        this.loadProcessQuota()
      }
    } catch (e) {
      console.error('加载工序失败', e)
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
    } catch (err) {
      hideLoading()
      showError(err.message || '报工失败')
    } finally {
      this.setData({ loading: false })
    }
  }
})
