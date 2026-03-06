// pages/boss/attendance/attendance.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, showConfirm, formatDate, getToday } = require('../../../utils/util')

Page({
  data: {
    records: [],
    abnormalRecords: [],
    selectedDate: '',
    activeTab: 'today',
    loading: false,
    showSupplement: false,
    supplementData: {
      user_id: '',
      user_name: '',
      date: '',
      clock_out_time: ''
    },
    employees: []
  },

  onLoad() {
    this.setData({ selectedDate: getToday() })
  },

  onShow() {
    this.loadTodayRecords()
    this.loadAbnormalRecords()
    this.loadEmployees()
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab })
  },

  async loadTodayRecords() {
    this.setData({ loading: true })
    try {
      const res = await callCloud('attendance', {
        action: 'getDailyRecords',
        date: this.data.selectedDate
      })
      this.setData({ records: res.data || [] })
    } catch (e) {
      showError('加载考勤记录失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadAbnormalRecords() {
    try {
      const res = await callCloud('attendance', {
        action: 'getAbnormalRecords'
      })
      this.setData({ abnormalRecords: res.data || [] })
    } catch (e) {
      console.error('加载异常记录失败', e)
    }
  },

  async loadEmployees() {
    try {
      const res = await callCloud('user', {
        action: 'listEmployees'
      })
      this.setData({ employees: res.data || [] })
    } catch (e) {
      console.error(e)
    }
  },

  onDateChange(e) {
    this.setData({ selectedDate: e.detail.value })
    this.loadTodayRecords()
  },

  showSupplementForm(e) {
    const record = e.currentTarget.dataset.record
    this.setData({
      showSupplement: true,
      supplementData: {
        attendance_id: record._id,
        user_id: record.user_id,
        user_name: record.user_name,
        date: record.date,
        clock_out_time: '18:00'
      }
    })
  },

  hideSupplementForm() {
    this.setData({ showSupplement: false })
  },

  onSupplementTimeChange(e) {
    this.setData({ 'supplementData.clock_out_time': e.detail.value })
  },

  async onSubmitSupplement() {
    const { attendance_id, user_id, date, clock_out_time } = this.data.supplementData
    if (!clock_out_time) {
      showError('请选择下班时间')
      return
    }

    const confirmed = await showConfirm('确认补签', `确定为该员工补签下班时间 ${clock_out_time} 吗？`)
    if (!confirmed) return

    showLoading('提交中...')
    try {
      await callCloud('attendance', {
        action: 'supplement',
        attendance_id,
        user_id,
        date,
        clock_out_time: `${date} ${clock_out_time}:00`
      })
      hideLoading()
      showSuccess('补签成功')
      this.setData({ showSupplement: false })
      this.loadTodayRecords()
      this.loadAbnormalRecords()
    } catch (err) {
      hideLoading()
      showError(err.message || '补签失败')
    }
  }
})
