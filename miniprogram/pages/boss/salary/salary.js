// pages/boss/salary/salary.js
const { callCloud, showError, formatMoney } = require('../../../utils/util')
const { filterListByKeyword } = require('../../../utils/list-search')

const SALARY_SEARCH_FIELDS = [
  'user_name',
  'baseSalary',
  'adjustmentTotal',
  'finalSalary',
  (employee) => employee.paid ? '已发' : '未发'
]

function formatMonthLabel(monthValue) {
  const parts = monthValue.split('-')
  return `${parts[0]}年${parseInt(parts[1])}月`
}

Page({
  data: {
    employees: [],
    filteredEmployees: [],
    salarySearchKeyword: '',
    totalSalary: '0.00',
    currentMonth: '',
    currentMonthValue: '',
    availableMonths: [],
    monthLabels: [],
    payrollMode: 'monthly',
    orders: [],
    orderLabels: [],
    selectedOrderIndex: 0,
    currentOrderId: '',
    currentOrderName: '',
    selectedMonthIndex: 0,
    loading: false,
    paidMap: {},
    paidCount: 0,
    leaveUnread: 0
  },

  onLoad() {
    const bjTime = require('../../../utils/beijing-time')
    const monthValue = bjTime.getBeijingMonth()
    this.setData({
      currentMonth: formatMonthLabel(monthValue),
      currentMonthValue: monthValue
    })
  },

  onShow() {
    this.loadPayrollMode()
    this.loadLeaveUnread()
  },

  async loadLeaveUnread() {
    try {
      const res = await callCloud('attendance', { action: 'getUnreadLeaveCount' })
      this.setData({ leaveUnread: (res.data && res.data.count) || 0 })
    } catch (e) {
      // 静默：红点失败不影响主流程
    }
  },

  goLeaveRecords() {
    wx.navigateTo({ url: '/pages/boss/leave-records/leave-records' })
  },

  async loadPayrollMode() {
    try {
      const res = await callCloud('settings', { action: 'getAll' })
      const mode = res.data && res.data.salary_payroll_mode === 'order' ? 'order' : 'monthly'
      this.setData({ payrollMode: mode })
      if (mode === 'order') this.loadOrders()
      else this.loadAvailableMonths()
    } catch (e) {
      this.setData({ payrollMode: 'monthly' })
      this.loadAvailableMonths()
    }
  },

  async loadOrders() {
    this.setData({ loading: true })
    try {
      const res = await callCloud('order', { action: 'list' })
      const orders = res.data || []
      const labels = orders.map(order => `${order.order_name}${order.status === 'completed' ? '（已完成）' : ''}`)
      const selectedIdx = Math.min(this.data.selectedOrderIndex || 0, Math.max(orders.length - 1, 0))
      const currentOrder = orders[selectedIdx] || null
      this.setData({
        orders,
        orderLabels: labels,
        selectedOrderIndex: selectedIdx,
        currentOrderId: currentOrder ? currentOrder._id : '',
        currentOrderName: currentOrder ? currentOrder.order_name : '',
        currentMonth: currentOrder ? currentOrder.order_name : '请选择订单'
      })
      if (currentOrder) this.loadSalaryOverview()
      else this.setData({ employees: [], filteredEmployees: [], totalSalary: '0.00', paidMap: {}, paidCount: 0, loading: false })
    } catch (e) {
      this.setData({ loading: false })
      showError('加载订单失败')
    }
  },

  async loadAvailableMonths() {
    try {
      const res = await callCloud('salary', { action: 'getAvailableMonths' })
      const months = res.data || [this.data.currentMonthValue]
      const labels = months.map(m => formatMonthLabel(m))
      let selectedIdx = months.indexOf(this.data.currentMonthValue)
      if (selectedIdx < 0) selectedIdx = 0
      this.setData({
        availableMonths: months,
        monthLabels: labels,
        selectedMonthIndex: selectedIdx,
        currentMonthValue: months[selectedIdx],
        currentMonth: labels[selectedIdx]
      })
      this.loadSalaryOverview()
    } catch (e) {
      this.loadSalaryOverview()
    }
  },

  onMonthTap(e) {
    const idx = e.currentTarget.dataset.idx
    if (idx === this.data.selectedMonthIndex) return
    const months = this.data.availableMonths
    this.setData({
      selectedMonthIndex: idx,
      currentMonthValue: months[idx],
      currentMonth: this.data.monthLabels[idx]
    })
    this.loadSalaryOverview()
  },

  onOrderTap(e) {
    const idx = e.currentTarget.dataset.idx
    if (idx === this.data.selectedOrderIndex) return
    const order = this.data.orders[idx]
    if (!order) return
    this.setData({
      selectedOrderIndex: idx,
      currentOrderId: order._id,
      currentOrderName: order.order_name,
      currentMonth: order.order_name
    })
    this.loadSalaryOverview()
  },

  onPullDownRefresh() {
    this.loadSalaryOverview().finally(() => wx.stopPullDownRefresh())
  },

  async loadSalaryOverview() {
    this.setData({ loading: true })
    try {
      // 并行加载薪资列表和发放状态
      const isOrderMode = this.data.payrollMode === 'order'
      if (isOrderMode && !this.data.currentOrderId) {
        this.setData({ employees: [], filteredEmployees: [], totalSalary: '0.00', paidMap: {}, paidCount: 0 })
        return
      }
      const salaryPayload = isOrderMode
        ? { action: 'getAllOrderSalary', order_id: this.data.currentOrderId }
        : { action: 'getAllMonthlySalary', month: this.data.currentMonthValue }
      const paidPayload = isOrderMode
        ? { action: 'getPaidStatus', order_id: this.data.currentOrderId }
        : { action: 'getPaidStatus', month: this.data.currentMonthValue }
      // 全勤/请假标记：按月模式取选中月，按订单模式取当前自然月（订单跨月，作粗略提示）
      const bjTime = require('../../../utils/beijing-time')
      const leaveMonth = isOrderMode ? bjTime.getBeijingMonth() : this.data.currentMonthValue
      const [salaryRes, paidRes, leaveRes] = await Promise.all([
        callCloud('salary', salaryPayload),
        callCloud('salary', paidPayload),
        callCloud('attendance', { action: 'getMonthLeaveSummary', month: leaveMonth }).catch(() => ({ data: {} }))
      ])

      const resData = salaryRes.data || {}
      const list = resData.list || []
      const paidMap = paidRes.data || {}
      const leaveMap = (leaveRes && leaveRes.data) || {}

      let paidCount = 0
      const employees = list.map(emp => {
        const isPaid = !!(paidMap[emp.user_id] && paidMap[emp.user_id].paid)
        if (isPaid) paidCount++
        const leaveDays = leaveMap[emp.user_id] || 0
        return {
          ...emp,
          baseSalary: formatMoney(emp.piece_rate || 0),
          adjustmentTotal: formatMoney((emp.reward || 0) - (emp.penalty || 0)),
          finalSalary: formatMoney(emp.total || 0),
          paid: isPaid,
          leaveDays: leaveDays,
          attendFull: leaveDays === 0,
          attendBadgeText: leaveDays === 0 ? '全勤' : ('请假' + leaveDays + '天')
        }
      })
      this.setData({
        employees,
        totalSalary: formatMoney(resData.total_expenditure || 0),
        paidMap,
        paidCount
      })
      this.refreshFilteredEmployees()
    } catch (e) {
      showError('加载薪资数据失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  refreshFilteredEmployees() {
    const filteredEmployees = filterListByKeyword(this.data.employees, this.data.salarySearchKeyword, SALARY_SEARCH_FIELDS)
      .map((employee) => ({
        ...employee,
        _sourceIndex: this.data.employees.findIndex(item => item.user_id === employee.user_id)
      }))
    this.setData({ filteredEmployees })
  },

  onSalarySearchInput(e) {
    this.setData({ salarySearchKeyword: e.detail.value }, () => this.refreshFilteredEmployees())
  },

  clearSalarySearch() {
    if (!this.data.salarySearchKeyword) return
    this.setData({ salarySearchKeyword: '' }, () => this.refreshFilteredEmployees())
  },

  async onTogglePaid(e) {
    const userId = e.currentTarget.dataset.id
    const userName = e.currentTarget.dataset.name
    const idx = Number(e.currentTarget.dataset.idx)
    if (!this.data.employees[idx]) return
    const currentPaid = this.data.employees[idx].paid

    try {
      const res = await callCloud('salary', {
        action: 'markPaid',
        user_id: userId,
        user_name: userName,
        month: this.data.currentMonthValue,
        order_id: this.data.payrollMode === 'order' ? this.data.currentOrderId : '',
        order_name: this.data.payrollMode === 'order' ? this.data.currentOrderName : '',
        paid: !currentPaid
      })

      // 更新本地状态（shallow copy to avoid direct mutation）
      const employees = this.data.employees.map((emp, i) => {
        if (i === idx) return { ...emp, paid: !currentPaid }
        return { ...emp }
      })
      let paidCount = 0
      employees.forEach(emp => { if (emp.paid) paidCount++ })
      this.setData({ employees, paidCount })
      this.refreshFilteredEmployees()

      wx.showToast({
        title: !currentPaid ? '已标记发放' : '已取消标记',
        icon: 'success'
      })

      // 发薪即完成（CLAUDE.md §2.3）：订单全员发薪后提醒老板把订单标记为已完成
      const flag = (res && res.data) || {}
      if (flag.order_fully_paid && flag.order_id && flag.order_status !== 'completed') {
        this.promptCompleteOrder(flag.order_id, flag.order_name)
      }
    } catch (e) {
      console.error('标记发薪失败', e)
      showError(e.message || '操作失败')
    }
  },

  promptCompleteOrder(orderId, orderName) {
    wx.showModal({
      title: '订单已全员发薪',
      content: `订单「${orderName || ''}」所有参与员工都已发薪，是否将订单标记为已完成？完成后该订单数据将被锁定，不可再修改。`,
      confirmText: '标记完成',
      cancelText: '暂不',
      success: async (modalRes) => {
        if (!modalRes.confirm) return
        try {
          await callCloud('order', {
            action: 'updateStatus',
            order_id: orderId,
            status: 'completed'
          })
          wx.showToast({ title: '订单已完成', icon: 'success' })
        } catch (err) {
          showError(err.message || '订单状态更新失败')
        }
      }
    })
  },

  goDetail(e) {
    const userId = e.currentTarget.dataset.id
    const userName = e.currentTarget.dataset.name
    const month = this.data.currentMonthValue
    const orderQuery = this.data.payrollMode === 'order'
      ? `&order_id=${this.data.currentOrderId}&order_name=${encodeURIComponent(this.data.currentOrderName)}`
      : ''
    wx.navigateTo({
      url: `/pages/boss/salary-detail/salary-detail?id=${userId}&name=${encodeURIComponent(userName)}&month=${month}${orderQuery}`
    })
  }
})
