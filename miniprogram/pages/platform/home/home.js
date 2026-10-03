const { callCloud, showError, showSuccess } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')
const orgBilling = require('../../../utils/org-billing.logic')
const listLogic = require('./org-list.logic')
const app = getApp()

const EMPTY_CREATE_FORM = { org_name: '', factory_code: '', contact_name: '', contact_phone: '' }

Page({
  data: {
    userInfo: null,
    organizations: [],
    rows: [],
    overviewCards: listLogic.buildOverviewCards([], 'all'),
    activeFilter: 'all',
    orgSearchKeyword: '',
    sortMode: 'due',
    sortLabel: listLogic.SORT_MODES.due,
    loading: true,
    loadError: '',
    showCreate: false,
    createForm: Object.assign({}, EMPTY_CREATE_FORM),
    createError: '',
    creating: false
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

  // 从工厂详情返回时刷新（续费/停用/改名后列表要跟着变）
  onShow() {
    if (this._loadedOnce) this.loadOrganizations({ silent: true })
  },

  onPullDownRefresh() {
    this.loadOrganizations().finally(() => wx.stopPullDownRefresh())
  },

  async loadOrganizations(options) {
    const silent = options && options.silent
    if (!silent) this.setData({ loading: true, loadError: '' })
    try {
      const res = await callCloud('platform', { action: 'listOrganizations' })
      this._loadedOnce = true
      this.setData({ organizations: res.data || [], loadError: '' })
      this.refreshRows()
    } catch (err) {
      const msg = err.message || '加载工厂失败'
      // 静默刷新失败时保留已有列表，只提示；首次加载失败显示错误态
      if (silent) showError(msg)
      else this.setData({ loadError: msg })
    } finally {
      this.setData({ loading: false })
    }
  },

  refreshRows() {
    const { organizations, activeFilter, orgSearchKeyword, sortMode } = this.data
    this.setData({
      overviewCards: listLogic.buildOverviewCards(organizations, activeFilter),
      rows: listLogic.buildOrgRows(organizations, { filter: activeFilter, keyword: orgSearchKeyword, sort: sortMode })
    })
  },

  onOverviewTap(e) {
    const activeFilter = listLogic.nextFilter(this.data.activeFilter, e.currentTarget.dataset.key)
    this.setData({ activeFilter }, () => this.refreshRows())
  },

  onOrgSearchInput(e) {
    this.setData({ orgSearchKeyword: e.detail.value }, () => this.refreshRows())
  },

  clearOrgSearch() {
    if (!this.data.orgSearchKeyword) return
    this.setData({ orgSearchKeyword: '' }, () => this.refreshRows())
  },

  clearAllFilters() {
    this.setData({ orgSearchKeyword: '', activeFilter: 'all' }, () => this.refreshRows())
  },

  toggleSort() {
    const sortMode = this.data.sortMode === 'due' ? 'created' : 'due'
    this.setData({ sortMode, sortLabel: listLogic.SORT_MODES[sortMode] }, () => this.refreshRows())
  },

  openOrg(e) {
    const id = e.currentTarget.dataset.id
    if (!id) return
    wx.navigateTo({ url: '/pages/platform/org-detail/org-detail?id=' + encodeURIComponent(id) })
  },

  openCreate() {
    this.setData({ showCreate: true, createForm: Object.assign({}, EMPTY_CREATE_FORM), createError: '' })
  },

  closeCreate() {
    if (this.data.creating) return
    this.setData({ showCreate: false })
  },

  onCreateInput(e) {
    const field = e.currentTarget.dataset.field
    this.setData({ ['createForm.' + field]: e.detail.value, createError: '' })
  },

  async submitCreate() {
    if (this.data.creating) return
    const form = this.data.createForm
    const orgName = (form.org_name || '').trim()
    if (!orgName) {
      this.setData({ createError: '请填写工厂名称' })
      return
    }
    const codeCheck = orgBilling.validateFactoryCode(form.factory_code)
    if (!codeCheck.ok) {
      this.setData({ createError: codeCheck.msg })
      return
    }

    this.setData({ creating: true, createError: '' })
    try {
      const res = await callCloud('platform', {
        action: 'createOrganization',
        org_name: orgName,
        factory_code: codeCheck.code,
        contact_name: (form.contact_name || '').trim(),
        contact_phone: (form.contact_phone || '').trim()
      })
      this.setData({ creating: false, showCreate: false })
      showSuccess('工厂已创建')
      const orgId = res.data && res.data.org_id
      if (orgId) {
        wx.navigateTo({ url: '/pages/platform/org-detail/org-detail?id=' + encodeURIComponent(orgId) + '&fresh=1' })
      } else {
        this.loadOrganizations({ silent: true })
      }
    } catch (err) {
      // 网络超时后 callCloud 自动重试可能撞上「工厂码已被使用」——其实第一次已经建好了，刷新列表让它露出来
      const msg = err.message || '创建失败'
      const maybeCreated = msg.indexOf('已被其他工厂使用') >= 0
      this.setData({ creating: false, createError: maybeCreated ? msg + '。如果是刚刚建的，关掉弹窗在列表里就能看到' : msg })
      if (maybeCreated) this.loadOrganizations({ silent: true })
    }
  },

  onLogout() {
    app.logout()
  }
})
