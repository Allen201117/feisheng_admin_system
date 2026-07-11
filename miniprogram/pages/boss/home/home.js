// pages/boss/home/home.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, formatMoney, getToday } = require('../../../utils/util')
const { getStoredUser, clearUser } = require('../../../utils/auth')
const { rankMenuByUsage, bumpUsage } = require('../../../utils/menu-usage.logic')
const app = getApp()

// 经营概览「常用功能」入口池：默认前 4 = 员工/考勤/报工/订单（老板指定），其余为候选。
// 老板点击任一入口累计频次（本地存储），首页按频次排序取前 4 置顶，后续随使用偏好自动调整。
const USAGE_KEY = 'boss_menu_usage'
const MENU_POOL = [
  { key: 'employees', title: '员工管理', color: 'blue', statField: 'totalEmployees', valueLabel: '员工总数' },
  { key: 'attendance', title: '考勤管理', color: 'green', special: 'attendance' },
  { key: 'worklog-manage', title: '报工管理', color: 'amber', desc: '报工进度 · 代录' },
  { key: 'orders', title: '订单管理', color: 'slate', statField: 'activeOrders', valueLabel: '进行中订单' },
  { key: 'qc', title: '质检管理', color: 'blue', statField: 'pendingQC', valueLabel: '待质检' },
  { key: 'salary', title: '薪酬管理', color: 'amber', desc: '工资发放' },
  { key: 'data-center', title: '数据中心', color: 'slate', desc: '经营数据' },
  { key: 'export', title: '导出报表', color: 'blue', desc: 'Excel 导出' },
  { key: 'leaderboard', title: '排行榜', color: 'green', desc: '产量排名' },
  { key: 'qrcode', title: '考勤码', color: 'amber', desc: '打卡二维码' }
]

function menuUrl(key) {
  if (key === 'qc') return '/pages/qc/home/home'
  return `/pages/boss/${key}/${key}`
}

Page({
  data: {
    userInfo: null,
    todayDate: '',
    stats: {
      totalEmployees: 0,
      todayAttendance: 0,
      activeOrders: 0,
      pendingQC: 0,
      monthSalary: '0.00'
    },
    subscription: null,
    subscriptionStatusClass: 'subscription-normal',
    leaveUnread: 0,
    todayLeave: 0,
    overviewCards: [],
    // 修改密码
    showChangePwd: false,
    changePwdData: { oldPassword: '', newPassword: '', confirmPassword: '' },
    showOldPwd: false,
    showNewPwd: false,
    changePwdLoading: false
  },

  onLoad() {
    const user = getStoredUser()
    if (!user || user.role !== 'boss') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({
      userInfo: user,
      todayDate: getToday()
    })
    this.buildCards()
  },

  onShow() {
    this.buildCards() // 先按最新使用频次排一遍（数值随后各接口回来再刷新）
    this.loadDashboard()
    this.loadSubscription()
    this.loadLeaveInfo()
  },

  // 使用频次存储键按老板区分（同一台设备可能多个老板登录，避免偏好互相污染）
  usageKey() {
    const uid = this.data.userInfo && this.data.userInfo._id
    return uid ? `${USAGE_KEY}_${uid}` : USAGE_KEY
  },

  // 经营概览：按本地累计频次排序取前 4，映射数值 / 考勤特殊卡（今日出勤+请假+红点）
  buildCards() {
    const usage = wx.getStorageSync(this.usageKey()) || {}
    const stats = this.data.stats
    const cards = rankMenuByUsage(MENU_POOL, usage).slice(0, 4).map((m) => {
      if (m.special === 'attendance') {
        return {
          key: m.key, title: m.title, color: m.color, special: 'attendance',
          value: stats.todayAttendance,
          leaveCount: this.data.todayLeave,
          showDot: this.data.leaveUnread > 0,
          dotText: this.data.leaveUnread
        }
      }
      if (m.statField) {
        return { key: m.key, title: m.title, color: m.color, value: stats[m.statField], valueLabel: m.valueLabel }
      }
      return { key: m.key, title: m.title, color: m.color, desc: m.desc }
    })
    this.setData({ overviewCards: cards })
  },

  bumpAndGo(key, url) {
    const storeKey = this.usageKey()
    const usage = bumpUsage(wx.getStorageSync(storeKey) || {}, key)
    try { wx.setStorageSync(storeKey, usage) } catch (e) {}
    wx.navigateTo({ url })
  },

  onOverviewTap(e) {
    const key = e.currentTarget.dataset.key
    if (key) this.bumpAndGo(key, menuUrl(key))
  },

  async loadLeaveInfo() {
    const [unreadRes, todayRes] = await Promise.all([
      callCloud('attendance', { action: 'getUnreadLeaveCount' }).catch(() => ({ data: { count: 0 } })),
      callCloud('attendance', { action: 'getTodayLeaveCount' }).catch(() => ({ data: { count: 0 } }))
    ])
    this.setData({
      leaveUnread: (unreadRes.data && unreadRes.data.count) || 0,
      todayLeave: (todayRes.data && todayRes.data.count) || 0
    })
    this.buildCards()
  },

  onPullDownRefresh() {
    this.loadDashboard().finally(() => wx.stopPullDownRefresh())
  },

  async loadSubscription() {
    try {
      const res = await callCloud('billing', { action: 'getMySubscription' })
      const subscription = res.data ? res.data.subscription : null
      if (!subscription) return
      const status = subscription.billing_status || 'not_enabled'
      this.setData({
        subscription,
        subscriptionStatusClass: status === 'expired' ? 'subscription-expired' : status === 'grace' ? 'subscription-grace' : status === 'trial' ? 'subscription-trial' : 'subscription-normal'
      })
    } catch (err) {
      this.setData({ subscription: null })
    }
  },

  async loadDashboard() {
    try {
      const res = await callCloud('salary', {
        action: 'getDashboard'
      })
      if (res.data) {
        this.setData({
          stats: {
            totalEmployees: res.data.employee_count || 0,
            todayAttendance: res.data.today_attendance || 0,
            activeOrders: res.data.active_orders || 0,
            pendingQC: res.data.pending_qc || 0,
            monthSalary: formatMoney(res.data.monthly_salary || 0)
          }
        }, () => this.buildCards())
      }
    } catch (e) {
      console.error('加载仪表盘失败', e)
      if (e && e.message && e.message.includes('权限不足')) {
        clearUser()
        showError('登录态已失效，请重新登录')
        setTimeout(() => {
          wx.reLaunch({ url: '/pages/login/login' })
        }, 400)
      }
    }
  },

  goTo(e) {
    const page = e.currentTarget.dataset.page
    this.bumpAndGo(page, `/pages/boss/${page}/${page}`)
  },

  onStatTap(e) {
    const target = e.currentTarget.dataset.target
    if (target) this.bumpAndGo(target, menuUrl(target))
  },

  goToQC() {
    this.bumpAndGo('qc', '/pages/qc/home/home')
  },

  goSubscription() {
    wx.navigateTo({ url: '/pages/boss/subscription/subscription' })
  },

  onLogout() {
    app.logout()
  },

  // ========== 修改密码 ==========
  openChangePwd() {
    this.setData({
      showChangePwd: true,
      changePwdData: { oldPassword: '', newPassword: '', confirmPassword: '' }
    })
  },

  closeChangePwd() {
    this.setData({ showChangePwd: false })
  },

  onOldPwdInput(e) {
    this.setData({ 'changePwdData.oldPassword': e.detail.value })
  },

  onNewPwdInput(e) {
    this.setData({ 'changePwdData.newPassword': e.detail.value })
  },

  onConfirmPwdInput(e) {
    this.setData({ 'changePwdData.confirmPassword': e.detail.value })
  },

  toggleOldPwd() {
    this.setData({ showOldPwd: !this.data.showOldPwd })
  },

  toggleNewPwd() {
    this.setData({ showNewPwd: !this.data.showNewPwd })
  },

  onSubmitChangePwd() {
    const d = this.data.changePwdData
    if (!d.oldPassword) { showError('请输入旧密码'); return }
    if (!d.newPassword) { showError('请输入新密码'); return }
    if (d.newPassword.length < 8) { showError('新密码至少8位'); return }
    if (!/[a-zA-Z]/.test(d.newPassword)) { showError('新密码需包含字母'); return }
    if (!/[0-9]/.test(d.newPassword)) { showError('新密码需包含数字'); return }
    if (d.newPassword !== d.confirmPassword) { showError('两次输入不一致'); return }
    if (d.newPassword === d.oldPassword) { showError('新旧密码不能相同'); return }

    this.setData({ changePwdLoading: true })
    showLoading('修改密码...')

    callCloud('login', {
      action: 'changePassword',
      user_id: this.data.userInfo._id,
      old_password: d.oldPassword,
      new_password: d.newPassword
    }).then(() => {
      hideLoading()
      showSuccess('密码修改成功')
      this.setData({ showChangePwd: false })
    }).catch((err) => {
      hideLoading()
      showError(err.message || '修改失败')
    }).then(() => {
      this.setData({ changePwdLoading: false })
    })
  }
})
