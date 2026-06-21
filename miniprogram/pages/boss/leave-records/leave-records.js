// pages/boss/leave-records/leave-records.js
// 老板：请假提醒列表。打开即把未读标记为已读（清红点）。
const { callCloud, showError } = require('../../../utils/util')

function formatMonthLabel(m) {
  if (!m || m.length < 7) return m || ''
  const p = m.split('-')
  return `${p[0]}年${parseInt(p[1])}月`
}

// ['2026-06-12','2026-06-13'] → '6月12、13日'
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

Page({
  data: {
    list: [],
    loading: false
  },

  onShow() {
    this.load()
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
  }
})
