const { callCloud, showError, showSuccess, showLoading, hideLoading, formatMoney, getToday } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const { filterProcessesByKeyword } = require('../process-search.logic')

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
    progressData: null,
    progressProcessKeyword: '',
    filteredProgressProcesses: [],

    // 工序报工明细
    processDetail: null,
    showEditWorkLog: false,
    editWL: null,
    editWLQuantity: 0,
    editWLNote: '',
    editWLReason: '',
    editWLReasonIndex: -1,
    editWLReasons: ['员工少报/多报修正', '老板代员工修正', '录入错误', '工序数量核对后修正', '其他'],
    processEmployees: [],
    processEmployeeIndex: -1,
    selectedProcessEmployee: null,
    showAddWorkLog: false,
    addWLQuantity: 0,
    addWLNote: ''
  },

  onLoad(options = {}) {
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

    if (options.mode === 'process') {
      this.setData({
        mainTab: 'process',
        processDetail: {
          order_id: options.order_id || '',
          process_id: options.process_id || '',
          order_name: decodeURIComponent(options.order_name || ''),
          process_name: decodeURIComponent(options.process_name || '')
        }
      })
    }

    this.loadOrders().then(() => {
      if (this.data.mainTab === 'process') {
        this.loadProcessLogs()
        this.loadProcessEmployees()
      } else if (this.data.mainTab === 'progress') {
        this.autoSelectProgressOrder()
      } else {
        this.loadLogs()
      }
    })
  },

  onPullDownRefresh() {
    const p = this.data.mainTab === 'process'
      ? this.loadProcessLogs()
      : (this.data.mainTab === 'progress' ? this.loadOrderProgress() : this.loadLogs())
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

  goProcessWorklogs(e) {
    const process = e.currentTarget.dataset.process
    const order = this.data.progressOrder || {}
    if (!process || !process._id || !order._id) {
      showError('缺少工序信息')
      return
    }
    const params = [
      'mode=process',
      `order_id=${encodeURIComponent(order._id)}`,
      `process_id=${encodeURIComponent(process._id)}`,
      `order_name=${encodeURIComponent(order.order_name || this.data.progressOrder.order_name || '')}`,
      `process_name=${encodeURIComponent(process.process_name || '')}`
    ].join('&')
    wx.navigateTo({ url: `/pages/boss/worklog-manage/worklog-manage?${params}` })
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
      this.setData({ progressData: null, filteredProgressProcesses: [] })
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
      const progressData = res.data || null
      const processes = progressData && Array.isArray(progressData.processes) ? progressData.processes : []
      this.setData({
        progressData,
        filteredProgressProcesses: filterProcessesByKeyword(processes, this.data.progressProcessKeyword)
      })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载进度失败')
      this.setData({ progressData: null, filteredProgressProcesses: [] })
    } finally {
      this.setData({ loading: false })
    }
  },

  applyProgressProcessSearch(keyword) {
    const progressData = this.data.progressData
    const processes = progressData && Array.isArray(progressData.processes) ? progressData.processes : []
    this.setData({
      progressProcessKeyword: keyword,
      filteredProgressProcesses: filterProcessesByKeyword(processes, keyword)
    })
  },

  onProgressProcessSearchInput(e) {
    this.applyProgressProcessSearch(e.detail.value)
  },

  clearProgressProcessSearch() {
    if (!this.data.progressProcessKeyword) return
    this.applyProgressProcessSearch('')
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

  async loadProcessLogs() {
    const detail = this.data.processDetail
    if (!detail || !detail.order_id || !detail.process_id) {
      this.setData({
        groupedLogs: [],
        summary: { count: 0, quantity: 0, amount: '0.00' }
      })
      return
    }

    this.setData({ loading: true })
    showLoading('加载工序明细...')
    try {
      const res = await callCloud('worklog', {
        action: 'getManageLogs',
        view_type: 'process',
        order_id: detail.order_id,
        process_id: detail.process_id
      })
      hideLoading()
      this.normalizeLogs(res.data || [])
    } catch (err) {
      hideLoading()
      showError(err.message || '加载工序明细失败')
      this.setData({
        groupedLogs: [],
        summary: { count: 0, quantity: 0, amount: '0.00' }
      })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadProcessEmployees() {
    try {
      const res = await callCloud('user', { action: 'listEmployees' })
      const employees = res.data || []
      this.setData({
        processEmployees: employees,
        processEmployeeIndex: employees.length > 0 ? 0 : -1,
        selectedProcessEmployee: employees[0] || null
      })
    } catch (err) {
      this.setData({
        processEmployees: [],
        processEmployeeIndex: -1,
        selectedProcessEmployee: null
      })
    }
  },

  reloadCurrentLogs() {
    if (this.data.mainTab === 'process') return this.loadProcessLogs()
    return this.loadLogs()
  },

  onEditWorkLog(e) {
    const log = e.currentTarget.dataset.log
    if (!log || !log._id) return
    this.setData({
      showEditWorkLog: true,
      editWL: log,
      editWLQuantity: log.quantity,
      editWLNote: log.note || '',
      editWLReason: '',
      editWLReasonIndex: -1
    })
  },

  closeEditWorkLog() {
    this.setData({ showEditWorkLog: false, editWL: null })
  },

  stopBubble() {},

  onEditWLQtyInput(e) {
    this.setData({ editWLQuantity: parseInt(e.detail.value, 10) || 0 })
  },

  onEditWLNoteInput(e) {
    this.setData({ editWLNote: e.detail.value })
  },

  onEditWLReasonChange(e) {
    const idx = parseInt(e.detail.value, 10)
    this.setData({
      editWLReasonIndex: idx,
      editWLReason: this.data.editWLReasons[idx] || ''
    })
  },

  onEditWLReasonCustom(e) {
    this.setData({ editWLReason: e.detail.value })
  },

  async onSaveEditWorkLog() {
    if (!this.data.editWL || !this.data.editWL._id) return
    if (this.data.editWLQuantity <= 0) {
      showError('报工数量必须大于0')
      return
    }
    if (!this.data.editWLReason) {
      showError('请选择或输入修改原因')
      return
    }

    showLoading('保存修改...')
    try {
      await callCloud('worklog', {
        action: 'updateWorkLog',
        log_id: this.data.editWL._id,
        quantity: this.data.editWLQuantity,
        note: this.data.editWLNote,
        reason: this.data.editWLReason
      })
      hideLoading()
      showSuccess('修改成功')
      this.setData({ showEditWorkLog: false, editWL: null })
      this.reloadCurrentLogs()
      if (this.data.mainTab === 'progress') this.loadOrderProgress()
    } catch (err) {
      hideLoading()
      showError(err.message || '修改失败')
    }
  },

  async openAddWorkLog() {
    if (!this.data.processDetail || !this.data.processDetail.order_id || !this.data.processDetail.process_id) {
      showError('缺少工序信息')
      return
    }
    if (this.data.processEmployees.length === 0) {
      await this.loadProcessEmployees()
    }
    if (this.data.processEmployees.length === 0) {
      showError('暂无可选择员工')
      return
    }
    this.setData({
      showAddWorkLog: true,
      addWLQuantity: 0,
      addWLNote: ''
    })
  },

  closeAddWorkLog() {
    this.setData({ showAddWorkLog: false })
  },

  onAddEmployeeChange(e) {
    const idx = Number(e.detail.value)
    this.setData({
      processEmployeeIndex: idx,
      selectedProcessEmployee: this.data.processEmployees[idx] || null
    })
  },

  onAddWLQtyInput(e) {
    this.setData({ addWLQuantity: parseInt(e.detail.value, 10) || 0 })
  },

  onAddWLNoteInput(e) {
    this.setData({ addWLNote: e.detail.value })
  },

  async onSubmitAddWorkLog() {
    const employee = this.data.selectedProcessEmployee
    const detail = this.data.processDetail
    if (!employee || !employee._id) {
      showError('请选择员工')
      return
    }
    if (this.data.addWLQuantity <= 0) {
      showError('请输入有效的报工数量')
      return
    }

    showLoading('新增报工...')
    try {
      await callCloud('worklog', {
        action: 'submit',
        user_id: employee._id,
        user_name: employee.name,
        order_id: detail.order_id,
        process_id: detail.process_id,
        quantity: this.data.addWLQuantity,
        note: this.data.addWLNote
      })
      hideLoading()
      showSuccess('新增成功')
      this.setData({ showAddWorkLog: false, addWLQuantity: 0, addWLNote: '' })
      this.loadProcessLogs()
    } catch (err) {
      hideLoading()
      showError(err.message || '新增失败')
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
          this.reloadCurrentLogs()
        } catch (err) {
          hideLoading()
          showError(err.message || '删除失败')
        }
      }
    })
  }
})
