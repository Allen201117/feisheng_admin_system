// pages/boss/data-center/data-center.js
const { callCloud, showError, showLoading, hideLoading, formatMoney, formatDateTime, getToday } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')

Page({
  data: {
    // 视图模式: 'month' | 'order'
    viewMode: 'month',
    // 按月查看
    month: '',
    activeTab: 0, // 0=考勤 1=报工 2=薪资
    tabs: ['考勤', '报工', '薪资'],
    // 考勤数据
    attendanceSummary: {},
    attendanceList: [],
    // 报工数据
    worklogSummary: {},
    worklogList: [],
    // 薪资数据
    salarySummary: {},
    salaryList: [],
    // 按订单查看
    orderList: [],
    selectedOrder: null,
    orderWorklogs: [],
    orderSummary: {},
    // 状态
    loading: false
  },

  onLoad() {
    const user = getStoredUser()
    if (!user || user.role !== 'boss') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    const now = new Date()
    this.setData({
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
    this.loadMonthData()
  },

  // ========== 视图切换 ==========
  switchMode(e) {
    const mode = e.currentTarget.dataset.mode
    this.setData({ viewMode: mode })
    if (mode === 'month') {
      this.loadMonthData()
    } else {
      this.loadOrders()
    }
  },

  // ========== 按月模式 ==========
  onMonthChange(e) {
    this.setData({ month: e.detail.value })
    this.loadMonthData()
  },

  switchTab(e) {
    const idx = parseInt(e.currentTarget.dataset.idx)
    this.setData({ activeTab: idx })
    if (idx === 0 && this.data.attendanceList.length === 0) this.loadAttendance()
    if (idx === 1 && this.data.worklogList.length === 0) this.loadWorklogs()
    if (idx === 2 && this.data.salaryList.length === 0) this.loadSalary()
  },

  async loadMonthData() {
    this.setData({
      attendanceList: [],
      worklogList: [],
      salaryList: [],
      attendanceSummary: {},
      worklogSummary: {},
      salarySummary: {}
    })
    const tab = this.data.activeTab
    if (tab === 0) await this.loadAttendance()
    else if (tab === 1) await this.loadWorklogs()
    else await this.loadSalary()
  },

  // 加载考勤数据
  async loadAttendance() {
    this.setData({ loading: true })
    showLoading('加载考勤数据...')
    try {
      const res = await callCloud('attendance', {
        action: 'getDailyRecords',
        date: this.data.month + '-01'
      })
      hideLoading()
      const records = res.data || []
      // 按日期分组统计
      const dayMap = {}
      let totalPresent = 0
      let totalLate = 0
      records.forEach(r => {
        const day = r.date || ''
        if (!dayMap[day]) dayMap[day] = { present: 0, late: 0, records: [] }
        dayMap[day].present++
        totalPresent++
        if (r.is_late) {
          dayMap[day].late++
          totalLate++
        }
        dayMap[day].records.push(r)
      })
      // 转为列表
      const attendanceList = Object.keys(dayMap).sort().reverse().map(day => ({
        date: day,
        present: dayMap[day].present,
        late: dayMap[day].late,
        records: dayMap[day].records
      }))

      this.setData({
        attendanceSummary: {
          totalRecords: totalPresent,
          totalLate: totalLate,
          workDays: Object.keys(dayMap).length
        },
        attendanceList
      })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载考勤失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  // 加载报工数据
  async loadWorklogs() {
    this.setData({ loading: true })
    showLoading('加载报工数据...')
    try {
      const res = await callCloud('worklog', {
        action: 'getMonthLogs',
        month: this.data.month
      })
      hideLoading()
      const logs = res.data || []
      let totalQty = 0
      let totalAmount = 0
      let passedQty = 0
      logs.forEach(l => {
        totalQty += l.quantity || 0
        totalAmount += l.amount || 0
        passedQty += l.passed_qty || 0
      })
      // 按日期分组
      const dayMap = {}
      logs.forEach(l => {
        const day = l.date || ''
        if (!dayMap[day]) dayMap[day] = []
        dayMap[day].push(l)
      })
      const worklogList = Object.keys(dayMap).sort().reverse().map(day => ({
        date: day,
        logs: dayMap[day],
        dayQty: dayMap[day].reduce((s, l) => s + (l.quantity || 0), 0),
        dayAmount: dayMap[day].reduce((s, l) => s + (l.amount || 0), 0)
      }))

      this.setData({
        worklogSummary: {
          totalLogs: logs.length,
          totalQty,
          totalAmount: formatMoney(totalAmount),
          passedQty
        },
        worklogList
      })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载报工失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  // 加载薪资数据
  async loadSalary() {
    this.setData({ loading: true })
    showLoading('加载薪资数据...')
    try {
      const [salaryRes, paidRes, usersRes] = await Promise.all([
        callCloud('salary', {
          action: 'getAllMonthlySalary',
          month: this.data.month
        }),
        callCloud('salary', {
          action: 'getPaidStatus',
          month: this.data.month
        }),
        callCloud('user', { action: 'list' })
      ])
      hideLoading()
      const list = salaryRes.data || {}
      const salaryDataList = list.list || []
      const paidMap = paidRes.data || {}
      const allUsers = usersRes.data || []
      // Build user join_date map
      const joinDateMap = {}
      allUsers.forEach(function(u) {
        if (u.join_date) joinDateMap[u._id] = u.join_date
      })

      let totalSalary = 0
      let paidCount = 0
      salaryDataList.forEach(item => {
        totalSalary += item.total || 0
        if (paidMap[item.user_id] && paidMap[item.user_id].paid) paidCount++
      })
      const salaryList = salaryDataList.map(item => ({
        ...item,
        displaySalary: formatMoney(item.total || 0),
        displayPiece: formatMoney(item.piece_rate || 0),
        paid: !!(paidMap[item.user_id] && paidMap[item.user_id].paid),
        join_date: joinDateMap[item.user_id] || ''
      }))

      this.setData({
        salarySummary: {
          headcount: salaryDataList.length,
          totalSalary: formatMoney(totalSalary),
          paidCount
        },
        salaryList
      })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载薪资失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  // ========== 按订单模式 ==========
  async loadOrders() {
    this.setData({ loading: true, selectedOrder: null, orderWorklogs: [], orderSummary: {} })
    showLoading('加载订单列表...')
    try {
      const res = await callCloud('order', {
        action: 'list'
      })
      hideLoading()
      const orders = (res.data || []).map(o => ({
        ...o,
        displayAmount: formatMoney(o.total_amount || 0),
        statusText: o.status === 'completed' ? '已完成' : o.status === 'cancelled' ? '已取消' : '进行中'
      }))
      this.setData({ orderList: orders })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载订单失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  async onOrderTap(e) {
    const order = e.currentTarget.dataset.order
    this.setData({ selectedOrder: order, loading: true })
    showLoading('加载订单详情...')
    try {
      const res = await callCloud('order', {
        action: 'getDetail',
        order_id: order._id
      })
      hideLoading()
      const detail = res.data || {}
      const worklogs = detail.worklogs || []
      let totalCost = 0
      let totalQty = 0
      worklogs.forEach(w => {
        totalCost += w.amount || 0
        totalQty += w.quantity || 0
      })
      this.setData({
        orderWorklogs: worklogs,
        orderSummary: {
          totalCost: formatMoney(totalCost),
          totalQty,
          logCount: worklogs.length,
          processes: detail.processes || []
        }
      })
    } catch (err) {
      hideLoading()
      showError(err.message || '加载订单详情失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  onBackToOrders() {
    this.setData({ selectedOrder: null, orderWorklogs: [], orderSummary: {} })
  },

  onPullDownRefresh() {
    if (this.data.viewMode === 'month') {
      this.loadMonthData().finally(() => wx.stopPullDownRefresh())
    } else {
      this.loadOrders().finally(() => wx.stopPullDownRefresh())
    }
  }
})
