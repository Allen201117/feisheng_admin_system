// pages/employee/worklog/worklog.js
const { callCloud, showError, showSuccess, showLoading, hideLoading } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const { normalizeAssignedProcessForEmployee, buildOrderProcessCards, formatEstimateAmount } = require('./worklog.logic')

Page({
  data: {
    userInfo: null,
    processes: [],
    // 第二层：按订单筛出的工序卡片 + 搜索
    orderId: '',
    orderName: '',
    searchKeyword: '',
    displayProcesses: [],
    matchedCount: 0,
    orderProcessTotal: 0,
    // 报工弹窗
    showReportModal: false,
    selectedProcess: null,
    selectedProcessIndex: -1,
    initialProcessId: '',
    quantity: 0,
    estimateText: '0.00',
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
      initialProcessId: options.process_id || '',
      orderId: options.order_id || '',
      orderName: options.order_name ? decodeURIComponent(options.order_name) : ''
    })
    if (this.data.orderName) {
      wx.setNavigationBarTitle({ title: this.data.orderName })
    }
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
      this.setData({ processes })
      this.refreshDisplayProcesses()

      // 从首页订单卡进入时若带具体工序，直接打开报工弹窗
      if (this.data.initialProcessId) {
        const target = processes.find((item) => String(item._id) === String(this.data.initialProcessId))
        if (target) this.openReport(target)
        this.setData({ initialProcessId: '' })
      }
    } catch (e) {
      console.error('加载工序失败', e)
    }
  },

  refreshDisplayProcesses() {
    const view = buildOrderProcessCards(this.data.processes, this.data.orderId, this.data.searchKeyword)
    this.setData({
      displayProcesses: view.items,
      matchedCount: view.matchedCount,
      orderProcessTotal: view.totalCount
    })
  },

  onSearchInput(e) {
    this.setData({ searchKeyword: e.detail.value || '' })
    this.refreshDisplayProcesses()
  },

  onClearSearch() {
    this.setData({ searchKeyword: '' })
    this.refreshDisplayProcesses()
  },

  // 点击工序卡片直接进入报工
  onSelectProcessCard(e) {
    const proc = e.currentTarget.dataset.process
    if (proc) this.openReport(proc)
  },

  openReport(proc) {
    this.setData({
      selectedProcess: proc,
      showReportModal: true,
      quantity: 0,
      estimateText: '0.00',
      quotaInfo: null
    })
    this.loadProcessQuota()
  },

  closeReportModal() {
    this.setData({ showReportModal: false, quantity: 0, estimateText: '0.00' })
  },

  // 预估金额在数据层格式化为两位小数，避免 WXML 模板直接算 quantity*current_price 露出浮点误差
  estimateFor(qty) {
    const price = this.data.selectedProcess ? this.data.selectedProcess.current_price : 0
    return formatEstimateAmount(qty, price)
  },

  onQuantityInput(e) {
    const val = parseInt((e.detail.value || '').replace(/[^0-9]/g, ''), 10) || 0
    this.setData({ quantity: val, estimateText: this.estimateFor(val) })
    this.warnIfQuantityExceeded(val)
  },

  onQuickQuantityTap(e) {
    const val = parseInt(e.currentTarget.dataset.value, 10) || 0
    this.setData({ quantity: val, estimateText: this.estimateFor(val) })
    this.warnIfQuantityExceeded(val)
  },

  onClearQuantity() {
    this.setData({ quantity: 0, estimateText: '0.00' })
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
      this.setData({ quantity: 0, estimateText: '0.00', showReportModal: false })
      this.loadAssignedProcesses()
    } catch (err) {
      hideLoading()
      showError(err.message || '报工失败')
    } finally {
      this.setData({ loading: false })
    }
  }
})
