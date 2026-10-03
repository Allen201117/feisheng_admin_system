const { callCloud, showError } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const detailLogic = require('./org-detail.logic')

const EMPTY_ADMIN_FORM = { name: '', phone: '' }

// 带对勾的 success toast 最多显示 7 个字，「已生效，到期 2028-03-18」会被截断，这里统一用纯文字提示
function toast(msg) {
  wx.showToast({ title: msg, icon: 'none', duration: 2500 })
}
// 自家工厂（永久免费）后端禁止停用，前端不给入口
const PERMANENT_HOME_ORG_ID = 'org_home'

Page({
  data: {
    orgId: '',
    fresh: false,
    loading: true,
    loadError: '',
    org: null,
    admins: [],
    activeAdminCount: 0,
    billingOrders: [],
    employeeCount: 0,
    subAction: detailLogic.buildSubscriptionAction(null),
    canToggleOrg: true,

    plans: [],
    plansError: '',
    showRenew: false,
    renew: { planId: '', duration: 0, amount: '', remark: '' },
    renewView: null,
    renewing: false,
    renewError: '',
    // 提交失败后锁住内容：同一个请求编号只能对应同一份内容，再点只会按刚才的内容补完
    renewLocked: false,

    showAdmin: false,
    adminForm: Object.assign({}, EMPTY_ADMIN_FORM),
    adminError: '',
    savingAdmin: false,

    showEdit: false,
    editForm: { org_name: '', factory_code: '', contact_name: '', contact_phone: '' },
    editCodeChanged: false,
    editNewCode: '',
    editCodeLocked: false,
    editError: '',
    savingEdit: false
  },

  onLoad(options) {
    const user = getStoredUser()
    if (!user || user.platform_role !== 'platform_admin') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    const orgId = options && options.id ? decodeURIComponent(options.id) : ''
    if (!orgId) {
      this.setData({ loading: false, loadError: '缺少工厂编号，请返回列表重新进入' })
      return
    }
    this.setData({ orgId, fresh: options.fresh === '1' })
    this.loadDetail()
    this.loadPlans()
  },

  onPullDownRefresh() {
    this.loadDetail().finally(() => wx.stopPullDownRefresh())
  },

  async loadDetail() {
    if (!this.data.orgId) return
    // 首次加载/失败重试显示骨架；已有数据时静默刷新
    this.setData({ loadError: '', loading: !this.data.org })
    try {
      const res = await callCloud('platform', { action: 'getOrganizationDetail', org_id: this.data.orgId })
      const data = res.data || {}
      const org = data.organization || null
      this.setData({
        org,
        admins: data.admins || [],
        activeAdminCount: data.active_admin_count || 0,
        billingOrders: data.billing_orders || [],
        employeeCount: data.employee_count || 0,
        subAction: detailLogic.buildSubscriptionAction(org),
        canToggleOrg: !!org && org._id !== PERMANENT_HOME_ORG_ID
      })
      if (org) wx.setNavigationBarTitle({ title: org.org_name || '工厂详情' })
    } catch (err) {
      this.setData({ loadError: err.message || '获取工厂详情失败' })
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadPlans() {
    try {
      const res = await callCloud('billing', { action: 'listPlans' })
      this.setData({ plans: res.data || [], plansError: '' })
    } catch (err) {
      // 不再静默回退写死的套餐：拿不到就明说，打开续费时再试一次
      this.setData({ plans: [], plansError: err.message || '套餐列表加载失败' })
    }
  },

  // ───────── 续费 / 开通 ─────────

  async openRenew() {
    const org = this.data.org
    if (!org || this.data.subAction.disabled) return
    if (!this.data.plans.length) {
      await this.loadPlans()
      if (!this.data.plans.length) {
        showError(this.data.plansError || '套餐列表加载失败，请稍后再试')
        return
      }
    }
    const selection = detailLogic.defaultRenewSelection(org, this.data.plans)
    if (!selection) {
      showError('没有可开通的套餐')
      return
    }
    // 一次弹层一个请求编号：网络自动重试、失败后再点确认都用它，后端据此保证只续一次
    this._renewRequestId = detailLogic.createRequestId(Date.now(), Math.random().toString(36).slice(2))
    this._lockedRenewView = null
    this.setData({
      showRenew: true,
      renewError: '',
      renewLocked: false,
      renew: { planId: selection.planId, duration: selection.duration, amount: selection.amount, remark: '' }
    }, () => this.refreshRenewView())
  },

  closeRenew() {
    if (this.data.renewing) return
    this.setData({ showRenew: false })
  },

  refreshRenewView() {
    this.setData({
      renewView: detailLogic.buildRenewView(this.data.org, this.data.plans, this.data.renew, Date.now())
    })
  },

  onRenewPlanTap(e) {
    if (this.data.renewLocked) return
    const planId = e.currentTarget.dataset.id
    if (!planId || planId === this.data.renew.planId) return
    const plan = detailLogic.findPlan(this.data.plans, planId)
    const trial = detailLogic.isTrialPlan(plan)
    const duration = trial ? Number(plan.trial_days || 7) : 12
    this.setData({
      renew: Object.assign({}, this.data.renew, {
        planId,
        duration,
        amount: trial ? '0' : detailLogic.defaultAmountYuan(plan, duration)
      }),
      renewError: ''
    }, () => this.refreshRenewView())
  },

  onRenewDurationTap(e) {
    if (this.data.renewLocked) return
    const duration = Number(e.currentTarget.dataset.value)
    if (!duration) return
    const plan = detailLogic.findPlan(this.data.plans, this.data.renew.planId)
    const trial = detailLogic.isTrialPlan(plan)
    this.setData({
      renew: Object.assign({}, this.data.renew, {
        duration,
        amount: trial ? '0' : detailLogic.defaultAmountYuan(plan, duration)
      }),
      renewError: ''
    }, () => this.refreshRenewView())
  },

  onRenewAmountInput(e) {
    if (this.data.renewLocked) return
    this.setData({ 'renew.amount': e.detail.value, renewError: '' }, () => this.refreshRenewView())
  },

  onRenewRemarkInput(e) {
    this.setData({ 'renew.remark': e.detail.value })
  },

  submitRenew() {
    if (this.data.renewing) return
    // 上次提交没确认成功：已经确认过一次，直接按同一份内容重发（服务端按请求编号去重/补完）
    if (this.data.renewLocked && this._lockedRenewView) {
      this.doRenew(this._lockedRenewView)
      return
    }
    const { org, plans, renew } = this.data
    const view = detailLogic.buildRenewView(org, plans, renew, Date.now())
    if (!view.canSubmit) {
      this.setData({ renewView: view, renewError: view.error })
      return
    }
    const plan = detailLogic.findPlan(plans, renew.planId)
    wx.showModal({
      title: view.isTrial ? '确认开通试用' : '确认已收款',
      content: detailLogic.buildRenewConfirmContent(org, plan, view, renew.amount),
      confirmText: '确认',
      success: (res) => {
        if (res.confirm) this.doRenew(view)
      }
    })
  },

  async doRenew(view) {
    const { org, renew } = this.data
    this.setData({ renewing: true, renewError: '' })
    try {
      const res = await callCloud('billing', {
        action: 'openSubscription',
        org_id: org._id,
        plan_id: renew.planId,
        period_months: view.isTrial ? undefined : renew.duration,
        trial_days: view.isTrial ? renew.duration : undefined,
        amount_yuan: String(renew.amount || '').trim(),
        // 0 元（试用/赠送）记「平台赠送」，收了钱记「微信收款」——与开通记录里的中文渠道对应
        payment_channel: Number(String(renew.amount || '0').trim() || 0) > 0 ? 'manual_wechat' : 'gift',
        remark: String(renew.remark || '').trim(),
        request_id: this._renewRequestId
      })
      this.setData({ renewing: false, showRenew: false, renewLocked: false })
      this._renewRequestId = ''
      this._lockedRenewView = null
      const data = res.data || {}
      if (data.resumed_previous) {
        // 补上的是上次没完成的那笔，不是这次填的内容：必须让人看清楚，不能一闪而过
        wx.showModal({ title: '补上了上次那笔', content: res.msg, showCancel: false, confirmText: '知道了' })
      } else {
        toast(data.end_at_text ? '已生效，到期 ' + data.end_at_text : (res.msg || '已生效'))
      }
      this.loadDetail()
    } catch (err) {
      // 失败保留弹层和同一个请求编号并锁住内容：再点确认是安全的，不会重复续费。
      // 同时刷新详情——服务端可能其实已经写进去了，页面上要看得到
      this._lockedRenewView = view
      this.setData({ renewing: false, renewLocked: true, renewError: err.message || '开通失败，请重试' })
      this.loadDetail()
    }
  },

  // ───────── 老板账号 ─────────

  openAdmin() {
    if (!this.data.org || this.data.org.status !== 'active') {
      showError('工厂已停用，先启用工厂再添加老板账号')
      return
    }
    this.setData({ showAdmin: true, adminForm: Object.assign({}, EMPTY_ADMIN_FORM), adminError: '' })
  },

  closeAdmin() {
    if (this.data.savingAdmin) return
    this.setData({ showAdmin: false })
  },

  onAdminInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['adminForm.' + field]: e.detail.value, adminError: '' })
  },

  async submitAdmin() {
    if (this.data.savingAdmin) return
    const check = detailLogic.validateAdminForm(this.data.adminForm)
    if (!check.ok) {
      this.setData({ adminError: check.msg })
      return
    }
    this.setData({ savingAdmin: true, adminError: '' })
    try {
      const res = await callCloud('platform', Object.assign({ action: 'createFactoryAdmin', org_id: this.data.orgId }, check.data))
      this.setData({ savingAdmin: false, showAdmin: false })
      toast(res.msg || '老板账号已创建')
      this.loadDetail()
    } catch (err) {
      this.setData({ savingAdmin: false, adminError: err.message || '创建失败' })
    }
  },

  copyLoginInfo(e) {
    const admin = this.data.admins[Number(e.currentTarget.dataset.index)]
    if (!admin) return
    wx.setClipboardData({
      data: detailLogic.buildLoginInfoText(this.data.org, admin),
      success: () => toast('已复制，发给老板即可'),
      fail: () => showError('复制失败，请手动抄写工厂码和手机号')
    })
  },

  resetAdminPassword(e) {
    const admin = this.data.admins[Number(e.currentTarget.dataset.index)]
    if (!admin) return
    wx.showModal({
      title: '重置密码',
      content: '把「' + admin.name + '」的密码重置为手机号，并让他退出登录？',
      confirmText: '重置',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await callCloud('platform', { action: 'resetFactoryAdminPassword', user_id: admin._id })
          toast(r.msg || '已重置')
          this.loadDetail()
        } catch (err) {
          showError(err.message || '重置失败')
        }
      }
    })
  },

  toggleAdminStatus(e) {
    const admin = this.data.admins[Number(e.currentTarget.dataset.index)]
    if (!admin) return
    const disabling = admin.status === 'active'
    wx.showModal({
      title: disabling ? '停用老板账号' : '恢复老板账号',
      content: disabling
        ? '停用后「' + admin.name + '」马上被退出登录，之后也登录不了。数据不受影响，可以随时恢复。'
        : '恢复后「' + admin.name + '」可以重新登录。',
      confirmText: disabling ? '停用' : '恢复',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await callCloud('platform', {
            action: 'setFactoryAdminStatus',
            user_id: admin._id,
            status: disabling ? 'disabled' : 'active'
          })
          toast(r.msg || '已更新')
          this.loadDetail()
        } catch (err) {
          showError(err.message || '操作失败')
        }
      }
    })
  },

  // ───────── 编辑资料 ─────────

  openEdit() {
    const org = this.data.org
    if (!org) return
    this.setData({
      showEdit: true,
      editError: '',
      editCodeChanged: false,
      editCodeLocked: org._id === PERMANENT_HOME_ORG_ID,
      editForm: {
        org_name: org.org_name || '',
        factory_code: org.factory_code || '',
        contact_name: org.contact_name || '',
        contact_phone: org.contact_phone || ''
      }
    })
  },

  closeEdit() {
    if (this.data.savingEdit) return
    this.setData({ showEdit: false })
  },

  onEditInput(e) {
    const field = e.currentTarget.dataset.field
    const next = Object.assign({}, this.data.editForm, { [field]: e.detail.value })
    const check = detailLogic.validateOrgForm(next, this.data.org.factory_code)
    const typedCode = String(next.factory_code || '').trim().toUpperCase()
    this.setData({
      editForm: next,
      editError: '',
      editCodeChanged: !!typedCode && typedCode !== String(this.data.org.factory_code || '').trim().toUpperCase(),
      editNewCode: check.ok ? check.data.factory_code : typedCode
    })
  },

  submitEdit() {
    if (this.data.savingEdit) return
    const check = detailLogic.validateOrgForm(this.data.editForm, this.data.org.factory_code)
    if (!check.ok) {
      this.setData({ editError: check.msg })
      return
    }
    if (!check.codeChanged) {
      this.doSaveEdit(check.data)
      return
    }
    const people = this.data.employeeCount + this.data.activeAdminCount
    wx.showModal({
      title: '确认修改工厂码',
      content: '工厂码改成 ' + check.data.factory_code + ' 后，全厂 ' + people + ' 个账号下次登录都要输新工厂码。请先通知老板。',
      confirmText: '确认修改',
      success: (res) => {
        if (res.confirm) this.doSaveEdit(check.data)
      }
    })
  },

  async doSaveEdit(data) {
    this.setData({ savingEdit: true, editError: '' })
    try {
      const res = await callCloud('platform', Object.assign({ action: 'updateOrganization', org_id: this.data.orgId }, data))
      this.setData({ savingEdit: false, showEdit: false })
      toast(res.msg || '已保存')
      this.loadDetail()
    } catch (err) {
      this.setData({ savingEdit: false, editError: err.message || '保存失败' })
    }
  },

  // ───────── 停用 / 启用工厂 ─────────

  toggleOrgStatus() {
    const org = this.data.org
    if (!org || !this.data.canToggleOrg) return
    const disabling = org.status === 'active'
    wx.showModal({
      title: disabling ? '停用工厂' : '启用工厂',
      content: disabling
        ? '停用后「' + org.org_name + '」所有人马上登录不了，数据保留，可以随时再启用。'
        : '启用后「' + org.org_name + '」的人可以重新登录。',
      confirmText: disabling ? '停用' : '启用',
      success: async (res) => {
        if (!res.confirm) return
        try {
          const r = await callCloud('platform', { action: disabling ? 'disableOrganization' : 'enableOrganization', org_id: org._id })
          toast(r.msg || '已更新')
          this.loadDetail()
        } catch (err) {
          showError(err.message || '操作失败')
        }
      }
    })
  },

  noop() {}
})
