// pages/employee/leave/leave.js
// 员工请假：选月份 + 在日历上点选要请假的日期（可多选）+ 选填原因 → 提交。
// 自助生效、无需审批。日历布局用纯算法（不依赖 new Date 做"当下"判断），
// 唯一的"今天"来自 beijing-time（§1.3）。
const { callCloud, showError, showSuccess, showConfirm } = require('../../../utils/util')
const bjTime = require('../../../utils/beijing-time')

function isLeap(y) {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0
}

function daysInMonth(y, m) {
  return [31, isLeap(y) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]
}

// Sakamoto 算法：返回 (y, m, 1) 是星期几（0=周日 … 6=周六），纯算术、确定性。
function firstWeekday(y, m) {
  const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4]
  let yy = y
  if (m < 3) yy -= 1
  return (yy + Math.floor(yy / 4) - Math.floor(yy / 100) + Math.floor(yy / 400) + t[m - 1] + 1) % 7
}

function pad2(n) {
  return n < 10 ? '0' + n : '' + n
}

function buildCalendar(month, selectedDates, today) {
  const parts = month.split('-')
  const y = parseInt(parts[0])
  const m = parseInt(parts[1])
  const lead = firstWeekday(y, m)
  const total = daysInMonth(y, m)
  const cells = []
  for (let i = 0; i < lead; i++) cells.push({ empty: true, key: 'e' + i })
  for (let d = 1; d <= total; d++) {
    const dateStr = `${month}-${pad2(d)}`
    cells.push({
      empty: false,
      key: dateStr,
      day: d,
      dateStr,
      selectable: dateStr >= today,
      selected: selectedDates.indexOf(dateStr) >= 0,
      isToday: dateStr === today
    })
  }
  return cells
}

function formatMonthLabel(m) {
  const p = m.split('-')
  return `${p[0]}年${parseInt(p[1])}月`
}

function summarize(selectedDates) {
  if (!selectedDates.length) return ''
  const days = selectedDates.map((d) => parseInt(d.split('-')[2])).sort((a, b) => a - b)
  return days.join('、') + ' 日'
}

function datesToCn(dates) {
  return (dates || []).map((d) => {
    const p = String(d).split('-')
    return parseInt(p[1]) + '月' + parseInt(p[2]) + '日'
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
    selectedDates: [],
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
    this.setData({
      cells: buildCalendar(this.data.month, this.data.selectedDates, this.data.today),
      canPrev: this.data.month > this.data.minMonth,
      selectedSummary: summarize(this.data.selectedDates)
    })
  },

  onPrevMonth() {
    if (this.data.month <= this.data.minMonth) return
    const month = bjTime.getBeijingPrevMonth(this.data.month)
    this.setData({ month, monthLabel: formatMonthLabel(month), selectedDates: [] }, () => this.rebuild())
  },

  onNextMonth() {
    const month = bjTime.getBeijingNextMonth(this.data.month)
    this.setData({ month, monthLabel: formatMonthLabel(month), selectedDates: [] }, () => this.rebuild())
  },

  onDayTap(e) {
    const cell = e.currentTarget.dataset.cell
    if (!cell || cell.empty || !cell.selectable) return
    const set = this.data.selectedDates.slice()
    const idx = set.indexOf(cell.dateStr)
    if (idx >= 0) set.splice(idx, 1)
    else set.push(cell.dateStr)
    set.sort()
    this.setData({ selectedDates: set }, () => this.rebuild())
  },

  onReasonInput(e) {
    this.setData({ reason: e.detail.value })
  },

  onSubmit() {
    const dates = this.data.selectedDates
    if (!dates.length) { showError('请先选择请假日期'); return }
    showConfirm('确认请假', `${this.data.monthLabel} 共 ${dates.length} 天\n${this.data.selectedSummary}`).then((ok) => {
      if (!ok) return
      this.setData({ submitting: true })
      callCloud('attendance', {
        action: 'requestLeave',
        month: this.data.month,
        dates,
        reason: this.data.reason
      }).then(() => {
        showSuccess('请假已提交')
        this.setData({ selectedDates: [], reason: '' }, () => this.rebuild())
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
        datesText: datesToCn(r.dates),
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
