// pages/boss/employee-salary/employee-salary.js
// 老板：员工工资档案 —— 某员工全部工资期次，点一期下钻到现有 salary-detail 看明细。
const { callCloud, showError, formatMoney } = require('../../../utils/util')

function formatMonthLabel(m) {
  if (!m || m.length < 7) return m || ''
  const parts = m.split('-')
  return `${parts[0]}年${parseInt(parts[1])}月`
}

Page({
  data: {
    userId: '',
    userName: '',
    roleName: '',
    joinDate: '',
    payrollMode: 'monthly',
    totalAll: '0.00',
    periods: [],
    loading: false
  },

  onLoad(options) {
    this.setData({
      userId: options.id || '',
      userName: decodeURIComponent(options.name || ''),
      roleName: decodeURIComponent(options.role || '')
    })
    wx.setNavigationBarTitle({ title: '工资档案' })
  },

  onShow() {
    this.loadHistory()
  },

  onPullDownRefresh() {
    this.loadHistory().finally(() => wx.stopPullDownRefresh())
  },

  loadHistory() {
    if (!this.data.userId) return Promise.resolve()
    this.setData({ loading: true })
    return callCloud('salary', { action: 'getUserSalaryHistory', user_id: this.data.userId }).then((res) => {
      const d = res.data || {}
      const periods = (d.periods || []).map((p) => ({
        ...p,
        label: p.type === 'order' ? (p.order_name || '订单') : formatMonthLabel(p.month),
        totalDisplay: formatMoney(p.total || 0)
      }))
      this.setData({
        payrollMode: d.payroll_mode || 'monthly',
        totalAll: formatMoney(d.total_all || 0),
        roleName: this.data.roleName,
        joinDate: d.join_date || '',
        periods
      })
    }).catch(() => {
      showError('加载工资档案失败')
    }).then(() => {
      this.setData({ loading: false })
    })
  },

  goPeriodDetail(e) {
    const p = e.currentTarget.dataset.period
    if (!p) return
    const name = encodeURIComponent(this.data.userName)
    if (p.type === 'order') {
      wx.navigateTo({
        url: `/pages/boss/salary-detail/salary-detail?id=${this.data.userId}&name=${name}&order_id=${p.order_id}&order_name=${encodeURIComponent(p.order_name || '')}`
      })
    } else {
      wx.navigateTo({
        url: `/pages/boss/salary-detail/salary-detail?id=${this.data.userId}&name=${name}&month=${p.month}`
      })
    }
  }
})
