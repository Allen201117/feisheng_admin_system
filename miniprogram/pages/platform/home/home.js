const { callCloud, showError, showSuccess, showLoading, hideLoading, trim } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const app = getApp()

Page({
  data: {
    userInfo: null,
    organizations: [],
    factoryAdmins: [],
    orgForm: {
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
    loading: false
  },

  onLoad() {
    const user = getStoredUser()
    if (!user || user.platform_role !== 'platform_admin') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({ userInfo: user })
    this.loadOrganizations()
  },

  onPullDownRefresh() {
    this.loadOrganizations().finally(() => wx.stopPullDownRefresh())
  },

  async loadOrganizations() {
    this.setData({ loading: true })
    try {
      const res = await callCloud('platform', { action: 'listOrganizations' })
      this.setData({ organizations: res.data || [] })
    } catch (err) {
      showError(err.message || '加载工厂失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  onOrgInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['orgForm.' + field]: e.detail.value })
  },

  onAdminInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['adminForm.' + field]: e.detail.value })
  },

  chooseAdminOrg(e) {
    const index = Number(e.detail.value)
    const org = this.data.organizations[index]
    if (!org) return
    this.setData({ 'adminForm.org_id': org._id })
    this.loadFactoryAdmins(org._id)
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

  async toggleOrganization(e) {
    const org = this.data.organizations[Number(e.currentTarget.dataset.index)]
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
      this.setData({ adminForm: { org_id: '', name: '', phone: '', password: '' } })
      this.setData({ factoryAdmins: [] })
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
