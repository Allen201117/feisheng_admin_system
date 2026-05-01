const { callCloud, showError, showSuccess, showLoading, hideLoading, trim } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const app = getApp()

Page({
  data: {
    userInfo: null,
    organizations: [],
    selectedOrgId: '',
    selectedOrg: null,
    factoryAdmins: [],
    orgForm: {
      org_name: '',
      factory_code: '',
      contact_name: '',
      contact_phone: ''
    },
    editForm: {
      org_name: '',
      factory_code: '',
      contact_name: '',
      contact_phone: ''
    },
    adminForm: {
      org_id: '',
      name: '',
      phone: '',
      password: ''
    },
    plans: [],
    selectedPlanIndex: 0,
    billingForm: {
      plan_id: 'standard_year',
      period_months: '12',
      trial_days: '7',
      amount_yuan: '1999',
      remark: ''
    },
    billingOrders: [],
    loading: false
  },

  onLoad() {
    const user = getStoredUser()
    if (!user || user.platform_role !== 'platform_admin') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({ userInfo: user })
    this.loadPlans()
    this.loadOrganizations()
  },

  onPullDownRefresh() {
    this.loadOrganizations().finally(() => wx.stopPullDownRefresh())
  },

  async loadOrganizations() {
    this.setData({ loading: true })
    try {
      const res = await callCloud('platform', { action: 'listOrganizations' })
      const organizations = (res.data || []).map(item => this.decorateOrganization(item))
      const currentId = this.data.selectedOrgId
      const selected = organizations.find(item => item._id === currentId) || organizations[0] || null
      this.setData({ organizations })
      if (selected) {
        this.applySelectedOrganization(selected, false)
        this.loadFactoryAdmins(selected._id)
        this.loadBillingOrders(selected._id)
      } else {
        this.setData({
          selectedOrgId: '',
          selectedOrg: null,
          factoryAdmins: [],
          billingOrders: [],
          editForm: { org_name: '', factory_code: '', contact_name: '', contact_phone: '' },
          'adminForm.org_id': ''
        })
      }
    } catch (err) {
      showError(err.message || '加载工厂失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  async loadPlans() {
    try {
      const res = await callCloud('billing', { action: 'listPlans' })
      const plans = res.data || []
      const selectedPlanIndex = Math.max(0, plans.findIndex(item => item.plan_id === this.data.billingForm.plan_id))
      this.setData({ plans, selectedPlanIndex })
      this.applyPlanToBillingForm(plans[selectedPlanIndex])
    } catch (err) {
      this.setData({
        plans: [
          { plan_id: 'trial', plan_name: '试用版', price_yuan: 0, billing_period: 'trial', period_months: 0, trial_days: 7 },
          { plan_id: 'standard_year', plan_name: '标准版年付', price_yuan: 1999, billing_period: 'year', period_months: 12 }
        ],
        selectedPlanIndex: 0
      })
    }
  },

  toTimestamp(input) {
    if (!input) return 0
    if (typeof input === 'number') return input
    if (typeof input === 'string') {
      const t = new Date(input).getTime()
      return Number.isNaN(t) ? 0 : t
    }
    if (input.$date) {
      const t = new Date(input.$date).getTime()
      return Number.isNaN(t) ? 0 : t
    }
    if (input.seconds) {
      return Number(input.seconds) * 1000 + Math.floor((Number(input.nanoseconds) || 0) / 1000000)
    }
    return 0
  },

  formatDate(input) {
    const ts = this.toTimestamp(input)
    if (!ts) return '未设置'
    const d = new Date(ts + 8 * 60 * 60 * 1000)
    return d.getUTCFullYear() + '-' + String(d.getUTCMonth() + 1).padStart(2, '0') + '-' + String(d.getUTCDate()).padStart(2, '0')
  },

  getBillingStatus(org) {
    if (!org) return 'unknown'
    if (org.status === 'disabled' || org.billing_status === 'disabled') return 'disabled'
    const raw = org.billing_status || 'not_enabled'
    if (raw === 'not_enabled') return 'not_enabled'
    if (raw === 'permanent') return 'permanent'
    const now = Date.now()
    const endTs = this.toTimestamp(org.current_period_end || org.trial_end)
    const graceTs = this.toTimestamp(org.grace_until)
    if ((raw === 'active' || raw === 'trial') && endTs && now > endTs) {
      return graceTs && now <= graceTs ? 'grace' : 'expired'
    }
    if (raw === 'grace' && graceTs && now > graceTs) return 'expired'
    return raw
  },

  decorateOrganization(org) {
    const status = this.getBillingStatus(org)
    const labels = {
      not_enabled: '未开通',
      trial: '试用中',
      active: '正常',
      permanent: '永久免费',
      grace: '宽限期',
      expired: '已到期',
      disabled: '已停用',
      unknown: '未知'
    }
    const planMap = {
      trial: '试用版',
      standard_year: status === 'permanent' ? '标准版年付（永久免费）' : '标准版年付'
    }
    const endAt = org.current_period_end || org.trial_end || ''
    return Object.assign({}, org, {
      billing_status_view: status,
      billing_status_label: labels[status] || status,
      billing_status_class: status === 'active' || status === 'permanent' ? 'billing-active' : status === 'trial' ? 'billing-trial' : status === 'grace' ? 'billing-grace' : status === 'expired' ? 'billing-expired' : 'billing-muted',
      plan_name_view: planMap[org.plan_id] || (org.plan_id ? org.plan_id : '未开通'),
      current_period_end_text: status === 'permanent' ? '永久免费' : this.formatDate(endAt),
      grace_until_text: status === 'permanent' ? '无需宽限' : this.formatDate(org.grace_until)
    })
  },

  onOrgInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['orgForm.' + field]: e.detail.value })
  },

  onAdminInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['adminForm.' + field]: e.detail.value })
  },

  onEditInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['editForm.' + field]: e.detail.value })
  },

  selectOrganization(e) {
    const index = Number(e.currentTarget.dataset.index)
    const org = this.data.organizations[index]
    if (!org) return
    this.applySelectedOrganization(this.decorateOrganization(org), true)
    this.loadFactoryAdmins(org._id)
    this.loadBillingOrders(org._id)
  },

  applySelectedOrganization(org, showTip) {
    this.setData({
      selectedOrgId: org._id,
      selectedOrg: org,
      editForm: {
        org_name: org.org_name || '',
        factory_code: org.factory_code || '',
        contact_name: org.contact_name || '',
        contact_phone: org.contact_phone || ''
      },
      'adminForm.org_id': org._id
    })
    if (showTip) {
      showSuccess('已选中' + (org.org_name || '工厂'))
    }
  },

  onBillingInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['billingForm.' + field]: e.detail.value })
  },

  onPlanPickerChange(e) {
    const index = Number(e.detail.value)
    const plan = this.data.plans[index]
    this.setData({ selectedPlanIndex: index })
    this.applyPlanToBillingForm(plan)
  },

  applyPlanToBillingForm(plan) {
    if (!plan) return
    this.setData({
      billingForm: {
        plan_id: plan.plan_id,
        period_months: String(plan.billing_period === 'trial' ? 0 : (plan.period_months || 12)),
        trial_days: String(plan.trial_days || 7),
        amount_yuan: String(plan.price_yuan === undefined ? 0 : plan.price_yuan),
        remark: this.data.billingForm.remark || ''
      }
    })
  },

  async loadBillingOrders(orgId) {
    if (!orgId) {
      this.setData({ billingOrders: [] })
      return
    }
    try {
      const res = await callCloud('billing', {
        action: 'listBillingOrders',
        org_id: orgId
      })
      this.setData({ billingOrders: (res.data || []).slice(0, 5) })
    } catch (err) {
      this.setData({ billingOrders: [] })
    }
  },

  openSubscription() {
    const org = this.data.selectedOrg
    const form = this.data.billingForm
    const plan = this.data.plans[this.data.selectedPlanIndex]
    if (!org) {
      showError('请先选择工厂')
      return
    }
    if (!form.plan_id) {
      showError('请选择套餐')
      return
    }

    const periodMonths = parseInt(form.period_months, 10) || 12
    const trialDays = parseInt(form.trial_days, 10) || 7
    const amountYuan = Number(form.amount_yuan || 0)
    const isTrial = plan && plan.billing_period === 'trial'
    const content = '确认给“' + org.org_name + '”开通/延期 ' +
      (plan ? plan.plan_name : form.plan_id) + ' ' + (isTrial ? trialDays + '天' : periodMonths + '个月') + '？'

    wx.showModal({
      title: '确认开通订阅',
      content,
      success: async (res) => {
        if (!res.confirm) return
        showLoading('开通中...')
        try {
          await callCloud('billing', {
            action: 'openSubscription',
            org_id: org._id,
            plan_id: form.plan_id,
            period_months: periodMonths,
            trial_days: trialDays,
            amount_yuan: Number.isFinite(amountYuan) ? amountYuan : 0,
            payment_channel: 'manual_wechat',
            remark: trim(form.remark)
          })
          hideLoading()
          showSuccess('订阅已开通')
          await this.loadOrganizations()
        } catch (err) {
          hideLoading()
          showError(err.message || '开通失败')
        }
      }
    })
  },

  async loadFactoryAdmins(orgId) {
    if (!orgId) {
      this.setData({ factoryAdmins: [] })
      return
    }
    try {
      const res = await callCloud('platform', {
        action: 'listFactoryAdmins',
        org_id: orgId
      })
      this.setData({ factoryAdmins: res.data || [] })
    } catch (err) {
      this.setData({ factoryAdmins: [] })
    }
  },

  async createOrganization() {
    const form = this.data.orgForm
    const orgName = trim(form.org_name)
    const factoryCode = trim(form.factory_code).toUpperCase()
    if (!orgName || !factoryCode) {
      showError('请填写工厂名称和工厂码')
      return
    }

    showLoading('创建中...')
    try {
      await callCloud('platform', {
        action: 'createOrganization',
        org_name: orgName,
        factory_code: factoryCode,
        contact_name: trim(form.contact_name),
        contact_phone: trim(form.contact_phone)
      })
      hideLoading()
      showSuccess('工厂已创建')
      this.setData({
        orgForm: { org_name: '', factory_code: '', contact_name: '', contact_phone: '' }
      })
      await this.loadOrganizations()
    } catch (err) {
      hideLoading()
      showError(err.message || '创建失败')
    }
  },

  async saveSelectedOrganization() {
    const org = this.data.selectedOrg
    if (!org) {
      showError('请先选择工厂')
      return
    }
    const form = this.data.editForm
    const orgName = trim(form.org_name)
    const factoryCode = trim(form.factory_code).toUpperCase()
    if (!orgName || !factoryCode) {
      showError('工厂名称和工厂码不能为空')
      return
    }

    showLoading('保存中...')
    try {
      await callCloud('platform', {
        action: 'updateOrganization',
        org_id: org._id,
        org_name: orgName,
        factory_code: factoryCode,
        contact_name: trim(form.contact_name),
        contact_phone: trim(form.contact_phone)
      })
      hideLoading()
      showSuccess('已保存')
      await this.loadOrganizations()
    } catch (err) {
      hideLoading()
      showError(err.message || '保存失败')
    }
  },

  async toggleSelectedOrganization() {
    const org = this.data.selectedOrg
    if (!org) return
    const action = org.status === 'active' ? 'disableOrganization' : 'enableOrganization'
    const title = org.status === 'active' ? '停用工厂' : '启用工厂'
    const content = org.status === 'active'
      ? '停用后该工厂用户将无法登录。'
      : '启用后该工厂用户可恢复登录。'

    wx.showModal({
      title,
      content,
      success: async (res) => {
        if (!res.confirm) return
        try {
          await callCloud('platform', { action, org_id: org._id })
          showSuccess(org.status === 'active' ? '已停用' : '已启用')
          await this.loadOrganizations()
        } catch (err) {
          showError(err.message || '操作失败')
        }
      }
    })
  },

  async createFactoryAdmin() {
    const form = this.data.adminForm
    if (!form.org_id || !trim(form.name) || !trim(form.phone)) {
      showError('请选择工厂并填写管理员信息')
      return
    }

    showLoading('创建中...')
    try {
      await callCloud('platform', {
        action: 'createFactoryAdmin',
        org_id: form.org_id,
        name: trim(form.name),
        phone: trim(form.phone),
        password: trim(form.password)
      })
      hideLoading()
      showSuccess('管理员已创建')
      this.setData({ adminForm: { org_id: form.org_id, name: '', phone: '', password: '' } })
      await this.loadFactoryAdmins(form.org_id)
    } catch (err) {
      hideLoading()
      showError(err.message || '创建失败')
    }
  },

  resetFactoryAdminPassword(e) {
    const admin = this.data.factoryAdmins[Number(e.currentTarget.dataset.index)]
    if (!admin) return
    wx.showModal({
      title: '重置密码',
      content: '确认将该管理员密码重置为手机号，并踢下线？',
      success: async (res) => {
        if (!res.confirm) return
        try {
          await callCloud('platform', {
            action: 'resetFactoryAdminPassword',
            user_id: admin._id
          })
          showSuccess('已重置')
        } catch (err) {
          showError(err.message || '重置失败')
        }
      }
    })
  },

  onLogout() {
    app.logout()
  }
})
