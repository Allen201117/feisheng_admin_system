// pages/boss/leave-records/leave-records.js
// 老板：请假提醒列表。打开即把未读标记为已读（清红点）。
// 「代员工请假」：帮不会自助操作的（多为大龄）员工补录请假，允许选已过去的日期。
const { callCloud, showError, showSuccess, showConfirm } = require('../../../utils/util')
const bjTime = require('../../../utils/beijing-time')
const {
  buildLeaveCalendar,
  summarizeDays,
  formatMonthLabel
} = require('../../../utils/leave-calendar.logic')

// 列表展示：['2026-06-12','2026-06-13'] → '6月12、13日'（按月分组更紧凑）
function formatDatesCn(dates) {
  if (!dates || !dates.length) return ''
  const byMonth = {}
  dates.forEach((d) => {
    const parts = String(d).split('-')
    if (parts.length < 3) return
    const mk = parseInt(parts[1]) + '月'
    if (!byMonth[mk]) byMonth[mk] = []
    byMonth[mk].push(parseInt(parts[2]))
  })
  return Object.keys(byMonth).map((mk) => mk + byMonth[mk].join('、') + '日').join('，')
}

// 老板补录允许往前翻的月份下限：当前月往前 6 个月
function calcMinMonth(currentMonth) {
  let m = currentMonth
  for (let i = 0; i < 6; i++) m = bjTime.getBeijingPrevMonth(m)
  return m
}

Page({
  data: {
    list: [],
    loading: false,
    // 员工列表（代录选人）
    employees: [],
    empIndex: -1,
    // 代录弹窗
    showAdd: false,
    weekHeaders: ['日', '一', '二', '三', '四', '五', '六'],
    addMonth: '',
    addMonthLabel: '',
    addToday: '',
    addMinMonth: '',
    canPrev: false,
    addCells: [],
    addSelectedDates: [],
    addSummary: '',
    addReason: '',
    submitting: false
  },

  onShow() {
    this.load()
    this.loadEmployees()
  },

  onPullDownRefresh() {
    this.load().finally(() => wx.stopPullDownRefresh())
  },

  load() {
    this.setData({ loading: true })
    return callCloud('attendance', { action: 'getLeaveRequestsForBoss' }).then((res) => {
      const list = (res.data || []).map((r) => ({
        ...r,
        monthLabel: formatMonthLabel(r.month),
        datesText: formatDatesCn(r.dates)
      }))
      this.setData({ list })
      // 打开请假列表即清红点
      callCloud('attendance', { action: 'markLeavesRead' }).catch(() => {})
    }).catch(() => {
      showError('加载请假记录失败')
    }).then(() => {
      this.setData({ loading: false })
    })
  },

  loadEmployees() {
    return callCloud('user', { action: 'listEmployees' }).then((res) => {
      this.setData({ employees: res.data || [] })
    }).catch(() => {})
  },

  // ===== 代员工请假 =====
  openAdd() {
    if (!this.data.employees.length) {
      showError('暂无可选择员工')
      this.loadEmployees()
      return
    }
    const month = bjTime.getBeijingMonth()
    const today = bjTime.getBeijingToday()
    this.setData({
      showAdd: true,
      empIndex: -1,
      addMonth: month,
      addMonthLabel: formatMonthLabel(month),
      addToday: today,
      addMinMonth: calcMinMonth(month),
      addSelectedDates: [],
      addReason: '',
      submitting: false
    }, () => this.rebuildAdd())
  },

  closeAdd() {
    this.setData({ showAdd: false })
  },

  rebuildAdd() {
    this.setData({
      // allowPast=true：老板补录可选当月任意日期（含已过去的）
      addCells: buildLeaveCalendar(this.data.addMonth, this.data.addSelectedDates, this.data.addToday, true),
      canPrev: this.data.addMonth > this.data.addMinMonth,
      addSummary: summarizeDays(this.data.addSelectedDates)
    })
  },

  onEmpChange(e) {
    this.setData({ empIndex: Number(e.detail.value) })
  },

  onAddPrevMonth() {
    if (this.data.addMonth <= this.data.addMinMonth) return
    const month = bjTime.getBeijingPrevMonth(this.data.addMonth)
    this.setData({ addMonth: month, addMonthLabel: formatMonthLabel(month), addSelectedDates: [] }, () => this.rebuildAdd())
  },

  onAddNextMonth() {
    const month = bjTime.getBeijingNextMonth(this.data.addMonth)
    this.setData({ addMonth: month, addMonthLabel: formatMonthLabel(month), addSelectedDates: [] }, () => this.rebuildAdd())
  },

  onAddDayTap(e) {
    const cell = e.currentTarget.dataset.cell
    if (!cell || cell.empty || !cell.selectable) return
    const set = this.data.addSelectedDates.slice()
    const idx = set.indexOf(cell.dateStr)
    if (idx >= 0) set.splice(idx, 1)
    else set.push(cell.dateStr)
    set.sort()
    this.setData({ addSelectedDates: set }, () => this.rebuildAdd())
  },

  onAddReasonInput(e) {
    this.setData({ addReason: e.detail.value })
  },

  onSubmitAdd() {
    const emp = this.data.employees[this.data.empIndex]
    if (!emp || !emp._id) { showError('请先选择员工'); return }
    const dates = this.data.addSelectedDates
    if (!dates.length) { showError('请选择请假日期'); return }
    showConfirm('确认代录请假', `${emp.name}：${this.data.addMonthLabel} 共 ${dates.length} 天\n${this.data.addSummary}`).then((ok) => {
      if (!ok) return
      this.setData({ submitting: true })
      callCloud('attendance', {
        action: 'bossAddLeave',
        user_id: emp._id,
        month: this.data.addMonth,
        dates,
        reason: this.data.addReason
      }).then(() => {
        showSuccess('已添加请假')
        this.setData({ showAdd: false })
        this.load()
      }).catch((err) => {
        showError(err.message || '添加失败')
      }).then(() => {
        this.setData({ submitting: false })
      })
    })
  },

  // 老板删除请假（员工提报的 + 老板代录的都可删）。软删，删后不再计入全勤。
  onDeleteLeave(e) {
    const id = e.currentTarget.dataset.id
    const name = e.currentTarget.dataset.name || '该员工'
    if (!id) return
    showConfirm('删除请假', `确定删除${name}的这条请假吗？\n删除后该请假不再计入全勤统计。`).then((ok) => {
      if (!ok) return
      callCloud('attendance', { action: 'bossDeleteLeave', leave_id: id }).then(() => {
        showSuccess('已删除')
        this.load()
      }).catch((err) => {
        showError(err.message || '删除失败')
      })
    })
  }
})
