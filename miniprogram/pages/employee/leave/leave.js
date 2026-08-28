// pages/employee/leave/leave.js
// 员工请假：选月份 + 在日历上点选要请假的日期 + 选填原因 → 提交。自助生效、无需审批。
// 连点同一天循环切换：未选 → 全天 → 上午 → 下午 → 未选（半天记 0.5 天）。
// 日历布局用纯算法（不依赖 new Date 做"当下"判断），唯一的"今天"来自 beijing-time（§1.3）。
// 日历/选中态的算法统一在 utils/leave-calendar.logic.js，老板代录页共用同一份，避免两处各写一遍。
const { callCloud, showError, showSuccess, showConfirm } = require('../../../utils/util')
const bjTime = require('../../../utils/beijing-time')
const {
  buildLeaveCalendar,
  cycleLeaveSelection,
  selectionDates,
  selectionHalfDays,
  selectionDayCount,
  summarizeLeaveSelection,
  formatMonthLabel,
  datesToCn
} = require('../../../utils/leave-calendar.logic')

// 请假记录列表里把半天标出来：'8月1日、8月3日(上午)'
function formatLeaveDatesWithHalf(dates, halfDays) {
  const half = halfDays || {}
  return (dates || []).map((d) => {
    const p = String(d).split('-')
    const suffix = half[d] === 'am' ? '(上午)' : (half[d] === 'pm' ? '(下午)' : '')
    return parseInt(p[1]) + '月' + parseInt(p[2]) + '日' + suffix
  }).join('、')
}

Page({
  data: {
    weekHeaders: ['日', '一', '二', '三', '四', '五', '六'],
    month: '',
    monthLabel: '',
    minMonth: '',
    canPrev: false,
    today: '',
    cells: [],
    selection: {},
    selectedCount: 0,
    selectedDayCount: 0,
    selectedSummary: '',
    reason: '',
    myLeaves: [],
    submitting: false
  },

  onLoad() {
    const month = bjTime.getBeijingMonth()
    const today = bjTime.getBeijingToday()
    this.setData({ month, minMonth: month, today, monthLabel: formatMonthLabel(month) })
    this.rebuild()
    this.loadMyLeaves()
  },

  rebuild() {
    const selection = this.data.selection
    this.setData({
      cells: buildLeaveCalendar(this.data.month, selection, this.data.today, false),
      canPrev: this.data.month > this.data.minMonth,
      selectedCount: selectionDates(selection).length,
      selectedDayCount: selectionDayCount(selection),
      selectedSummary: summarizeLeaveSelection(selection)
    })
  },

  onPrevMonth() {
    if (this.data.month <= this.data.minMonth) return
    const month = bjTime.getBeijingPrevMonth(this.data.month)
    this.setData({ month, monthLabel: formatMonthLabel(month), selection: {} }, () => this.rebuild())
  },

  onNextMonth() {
    const month = bjTime.getBeijingNextMonth(this.data.month)
    this.setData({ month, monthLabel: formatMonthLabel(month), selection: {} }, () => this.rebuild())
  },

  onDayTap(e) {
    const cell = e.currentTarget.dataset.cell
    if (!cell || cell.empty || !cell.selectable) return
    this.setData({ selection: cycleLeaveSelection(this.data.selection, cell.dateStr) }, () => this.rebuild())
  },

  onReasonInput(e) {
    this.setData({ reason: e.detail.value })
  },

  onSubmit() {
    const selection = this.data.selection
    const dates = selectionDates(selection)
    if (!dates.length) { showError('请先选择请假日期'); return }
    showConfirm('确认请假', `${this.data.monthLabel} 共 ${this.data.selectedDayCount} 天\n${this.data.selectedSummary}`).then((ok) => {
      if (!ok) return
      this.setData({ submitting: true })
      callCloud('attendance', {
        action: 'requestLeave',
        month: this.data.month,
        dates,
        half_days: selectionHalfDays(selection),
        reason: this.data.reason
      }).then(() => {
        showSuccess('请假已提交')
        this.setData({ selection: {}, reason: '' }, () => this.rebuild())
        this.loadMyLeaves()
      }).catch((err) => {
        showError(err.message || '提交失败')
      }).then(() => {
        this.setData({ submitting: false })
      })
    })
  },

  loadMyLeaves() {
    callCloud('attendance', { action: 'getMyLeaves' }).then((res) => {
      const myLeaves = (res.data || []).map((r) => ({
        ...r,
        monthLabel: formatMonthLabel(r.month),
        datesText: r.half_days && Object.keys(r.half_days).length
          ? formatLeaveDatesWithHalf(r.dates, r.half_days)
          : datesToCn(r.dates),
        statusText: r.status === 'cancelled' ? '已撤销' : '已请假'
      }))
      this.setData({ myLeaves })
    }).catch(() => {})
  },

  onCancelLeave(e) {
    const id = e.currentTarget.dataset.id
    showConfirm('撤销请假', '确定撤销这条请假吗？').then((ok) => {
      if (!ok) return
      callCloud('attendance', { action: 'cancelLeave', leave_id: id }).then(() => {
        showSuccess('已撤销')
        this.loadMyLeaves()
      }).catch((err) => {
        showError(err.message || '撤销失败')
      })
    })
  }
})
