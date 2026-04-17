// pages/boss/salary/salary.js
const { callCloud, showError, formatMoney } = require('../../../utils/util')

function formatMonthLabel(monthValue) {
  const parts = monthValue.split('-')
  return `${parts[0]}年${parseInt(parts[1])}月`
}

Page({
  data: {
    employees: [],
    totalSalary: '0.00',
    currentMonth: '',
    currentMonthValue: '',
    availableMonths: [],
    monthLabels: [],
    selectedMonthIndex: 0,
    loading: false,
    paidMap: {},
    paidCount: 0
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
    this.loadAvailableMonths()
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

  onPullDownRefresh() {
    this.loadSalaryOverview().finally(() => wx.stopPullDownRefresh())
  },

  async loadSalaryOverview() {
    this.setData({ loading: true })
    try {
      // 并行加载薪资列表和发放状态
      const [salaryRes, paidRes] = await Promise.all([
        callCloud('salary', {
          action: 'getAllMonthlySalary',
          month: this.data.currentMonthValue
        }),
        callCloud('salary', {
          action: 'getPaidStatus',
          month: this.data.currentMonthValue
        })
      ])

      const resData = salaryRes.data || {}
      const list = resData.list || []
      const paidMap = paidRes.data || {}

      let paidCount = 0
      const employees = list.map(emp => {
        const isPaid = !!(paidMap[emp.user_id] && paidMap[emp.user_id].paid)
        if (isPaid) paidCount++
        return {
          ...emp,
          baseSalary: formatMoney(emp.piece_rate || 0),
          adjustmentTotal: formatMoney((emp.reward || 0) - (emp.penalty || 0)),
          finalSalary: formatMoney(emp.total || 0),
          paid: isPaid
        }
      })
      this.setData({
        employees,
        totalSalary: formatMoney(resData.total_expenditure || 0),
        paidMap,
        paidCount
      })
    } catch (e) {
      showError('加载薪资数据失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  async onTogglePaid(e) {
    const userId = e.currentTarget.dataset.id
    const userName = e.currentTarget.dataset.name
    const idx = e.currentTarget.dataset.idx
    const currentPaid = this.data.employees[idx].paid

    try {
      await callCloud('salary', {
        action: 'markPaid',
        user_id: userId,
        user_name: userName,
        month: this.data.currentMonthValue,
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

      wx.showToast({
        title: !currentPaid ? '已标记发放' : '已取消标记',
        icon: 'success'
      })
    } catch (e) {
      showError('操作失败')
    }
  },

  goDetail(e) {
    const userId = e.currentTarget.dataset.id
    const userName = e.currentTarget.dataset.name
    const month = this.data.currentMonthValue
    wx.navigateTo({
      url: `/pages/boss/salary-detail/salary-detail?id=${userId}&name=${encodeURIComponent(userName)}&month=${month}`
    })
  }
})
