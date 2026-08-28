// pages/boss/attendance/attendance.js
// 老板端考勤管理（2026-08-29 重做）：
//   一级视图 = 员工列表（按月），一眼看谁全勤谁不全勤；
//   二级视图 = 点员工弹出日历抽屉，当月每天绿=出勤 / 橙=请假 / 红=缺勤 / 灰=未到，下面附出勤明细和补签。
// 全勤口径：当月请假合计 ≤ 2 天算全勤（半天记 0.5 天），见 cloudfunctions/attendance/leave.logic.js。
const { callCloud, showError, showSuccess, showLoading, hideLoading, showConfirm } = require('../../../utils/util')
const { filterListByKeyword } = require('../../../utils/list-search')
const bjTime = require('../../../utils/beijing-time')
const { formatMonthLabel } = require('../../../utils/leave-calendar.logic')
const {
  buildAttendanceCalendar,
  buildEmployeeRows,
  buildDaysIndex,
  buildOverviewText
} = require('../../../utils/attendance-calendar.logic')

const EMP_SEARCH_FIELDS = ['user_name']

const ABNORMAL_SEARCH_FIELDS = [
  'user_name',
  'date',
  'clock_in_display'
]

// 抽屉里的出勤明细：只列已经发生过的日子（未到的日期没什么可看）
function buildDetailRows(days) {
  return (days || [])
    .filter(d => d.status !== 'future')
    .map(d => ({
      ...d,
      statusText: d.status === 'present' ? '出勤' : (d.status === 'leave' ? '请假' : '缺勤'),
      statusClass: d.status === 'present' ? 'badge-green' : (d.status === 'leave' ? 'badge-amber' : 'badge-red'),
      timeText: d.status === 'present'
        ? `${d.clock_in_display || '--'} → ${d.clock_out_display || '--'}`
        : (d.status === 'leave' ? (d.leave_kind === 'am' ? '请假 上午' : (d.leave_kind === 'pm' ? '请假 下午' : '请假 全天')) : '无打卡记录'),
      canSupplement: d.att_status === 'abnormal'
    }))
    .reverse()
}

Page({
  data: {
    weekHeaders: ['日', '一', '二', '三', '四', '五', '六'],
    month: '',
    monthLabel: '',
    canNext: false,
    loading: false,
    activeTab: 'employees',

    overview: null,
    rawEmployees: [],
    employees: [],
    empKeyword: '',

    rawAbnormalRecords: [],
    abnormalRecords: [],

    // 员工日历抽屉
    showDrawer: false,
    drawerEmp: null,
    drawerCells: [],
    drawerDetails: [],

    showSupplement: false,
    supplementData: { attendance_id: '', user_id: '', user_name: '', date: '', clock_out_time: '' },
    leaveUnread: 0
  },

  onLoad() {
    const month = bjTime.getBeijingMonth()
    this.setData({ month, monthLabel: formatMonthLabel(month) })
  },

  onShow() {
    this.loadOverview()
    this.loadAbnormalRecords()
    this.loadLeaveUnread()
  },

  onPullDownRefresh() {
    Promise.all([this.loadOverview(), this.loadAbnormalRecords()])
      .catch(() => {})
      .then(() => wx.stopPullDownRefresh())
  },

  // ===== 月份切换 =====
  onPrevMonth() {
    const month = bjTime.getBeijingPrevMonth(this.data.month)
    this.setData({ month, monthLabel: formatMonthLabel(month) }, () => this.loadOverview())
  },

  onNextMonth() {
    if (this.data.month >= bjTime.getBeijingMonth()) return
    const month = bjTime.getBeijingNextMonth(this.data.month)
    this.setData({ month, monthLabel: formatMonthLabel(month) }, () => this.loadOverview())
  },

  loadOverview() {
    this.setData({ loading: true })
    return callCloud('attendance', {
      action: 'getMonthAttendanceOverview',
      month: this.data.month
    }).then((res) => {
      const data = res.data || {}
      const rawEmployees = buildEmployeeRows(data.employees || [])
      // 每天的明细挂在页面实例上，不进 setData（见 buildEmployeeRows 注释）
      this._daysIndex = buildDaysIndex(data.employees || [])
      this.setData({
        overview: buildOverviewText(data.summary),
        rawEmployees,
        canNext: this.data.month < bjTime.getBeijingMonth()
      })
      this.refreshEmpFilter()
      // 抽屉开着时跟着刷新，避免看到上个月的日历
      if (this.data.showDrawer && this.data.drawerEmp) {
        const fresh = rawEmployees.find(e => e.user_id === this.data.drawerEmp.user_id)
        if (fresh) this.openDrawerFor(fresh)
        else this.closeDrawer()
      }
    }).catch((err) => {
      showError(err.message || '加载考勤总览失败')
    }).then(() => {
      this.setData({ loading: false })
    })
  },

  loadAbnormalRecords() {
    return callCloud('attendance', { action: 'getAbnormalRecords' }).then((res) => {
      this.setData({ rawAbnormalRecords: res.data || [] })
      this.refreshEmpFilter()
    }).catch(() => {})
  },

  loadLeaveUnread() {
    return callCloud('attendance', { action: 'getUnreadLeaveCount' }).then((res) => {
      this.setData({ leaveUnread: (res.data && res.data.count) || 0 })
    }).catch(() => {
      // 静默：红点失败不影响考勤主流程
    })
  },

  goLeaveRecords() {
    wx.navigateTo({ url: '/pages/boss/leave-records/leave-records' })
  },

  switchTab(e) {
    this.setData({ activeTab: e.currentTarget.dataset.tab })
  },

  // ===== 搜索 =====
  refreshEmpFilter() {
    this.setData({
      employees: filterListByKeyword(this.data.rawEmployees, this.data.empKeyword, EMP_SEARCH_FIELDS),
      abnormalRecords: filterListByKeyword(this.data.rawAbnormalRecords, this.data.empKeyword, ABNORMAL_SEARCH_FIELDS)
    })
  },

  onAttendanceSearchInput(e) {
    this.setData({ empKeyword: e.detail.value }, () => this.refreshEmpFilter())
  },

  clearAttendanceSearch() {
    if (!this.data.empKeyword) return
    this.setData({ empKeyword: '' }, () => this.refreshEmpFilter())
  },

  // ===== 员工日历抽屉 =====
  onEmployeeTap(e) {
    const emp = e.currentTarget.dataset.emp
    if (!emp) return
    this.openDrawerFor(emp)
  },

  openDrawerFor(emp) {
    const days = (this._daysIndex || {})[emp.user_id] || []
    this.setData({
      showDrawer: true,
      drawerEmp: emp,
      drawerCells: buildAttendanceCalendar(this.data.month, days),
      drawerDetails: buildDetailRows(days)
    })
  },

  closeDrawer() {
    this.setData({ showDrawer: false, drawerEmp: null, drawerCells: [], drawerDetails: [] })
  },

  noop() {},

  // ===== 补签 =====
  showSupplementForm(e) {
    const record = e.currentTarget.dataset.record
    if (!record) return
    this.setData({
      showSupplement: true,
      supplementData: {
        attendance_id: record._id || record.attendance_id || '',
        user_id: record.user_id || (this.data.drawerEmp && this.data.drawerEmp.user_id) || '',
        user_name: record.user_name || (this.data.drawerEmp && this.data.drawerEmp.user_name) || '',
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
      this.loadOverview()
      this.loadAbnormalRecords()
    } catch (err) {
      hideLoading()
      showError(err.message || '补签失败')
    }
  }
})
