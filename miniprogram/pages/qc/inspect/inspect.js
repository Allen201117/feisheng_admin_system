// pages/qc/inspect/inspect.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, showConfirm } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')

Page({
  data: {
    logId: '',
    logDetail: null,
    passedQty: 0,
    passRateDisplay: '0.0',
    passRateClass: 'text-danger',
    rejectedQty: 0,
    actualAmountDisplay: '0.00',
    loading: false,
    userInfo: null
  },

  onLoad(options) {
    const user = getStoredUser()
    if (!user) {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    // 管理员和质检员都可以质检
    if (user.role !== 'qc' && user.role !== 'boss') {
      wx.reLaunch({ url: '/pages/login/login' })
      return
    }
    this.setData({
      logId: options.id,
      userInfo: user
    })
    this.loadDetail()
  },

  async loadDetail() {
    showLoading('加载中...')
    try {
      const res = await callCloud('worklog', {
        action: 'getLogDetail',
        log_id: this.data.logId
      })
      hideLoading()
      if (res.data) {
        const quantity = Number(res.data.quantity || 0)
        const passedQty = quantity
        this.setData({
          logDetail: res.data,
          passedQty,
          passRateDisplay: quantity > 0 ? '100.0' : '0.0',
          passRateClass: quantity > 0 ? 'text-success' : 'text-danger',
          rejectedQty: 0,
          actualAmountDisplay: (passedQty * Number(res.data.snapshot_price || 0)).toFixed(2)
        })
      }
    } catch (e) {
      hideLoading()
      showError('加载失败')
    }
  },

  onPassedQtyInput(e) {
    let val = parseInt(e.detail.value) || 0
    // 合格数不能超过提交数
    if (val > this.data.logDetail.quantity) {
      val = this.data.logDetail.quantity
      showError('合格数不能超过提交数量')
    }
    if (val < 0) val = 0
    this.updatePreview(val)
  },

  addQty() {
    if (this.data.passedQty < this.data.logDetail.quantity) {
      this.updatePreview(this.data.passedQty + 1)
    }
  },

  subQty() {
    if (this.data.passedQty > 0) {
      this.updatePreview(this.data.passedQty - 1)
    }
  },

  setAllPass() {
    this.updatePreview(this.data.logDetail.quantity)
  },

  updatePreview(passedQty) {
    const quantity = Number((this.data.logDetail && this.data.logDetail.quantity) || 0)
    const snapshotPrice = Number((this.data.logDetail && this.data.logDetail.snapshot_price) || 0)
    const passRate = quantity > 0 ? (passedQty / quantity) * 100 : 0
    const rejectedQty = Math.max(0, quantity - passedQty)
    const amount = passedQty * snapshotPrice

    this.setData({
      passedQty,
      passRateDisplay: passRate.toFixed(1),
      passRateClass: passRate >= 95 ? 'text-success' : 'text-danger',
      rejectedQty,
      actualAmountDisplay: amount.toFixed(2)
    })
  },

  async onSubmitInspect() {
    if (this.data.passedQty < 0) {
      showError('请输入有效的合格数量')
      return
    }
    if (this.data.passedQty > this.data.logDetail.quantity) {
      showError('合格数量不能超过提交数量')
      return
    }

    const passRate = ((this.data.passedQty / this.data.logDetail.quantity) * 100).toFixed(1)
    const confirmed = await showConfirm(
      '确认质检结果',
      `合格数量: ${this.data.passedQty}件\n合格率: ${passRate}%\n确定提交吗？`
    )
    if (!confirmed) return

    this.setData({ loading: true })
    showLoading('提交中...')

    try {
      await callCloud('worklog', {
        action: 'inspect',
        log_id: this.data.logId,
        passed_qty: this.data.passedQty,
        qc_user_id: this.data.userInfo._id,
        qc_user_name: this.data.userInfo.name
      })
      hideLoading()
      showSuccess('质检完成')
      setTimeout(() => wx.navigateBack(), 1500)
    } catch (err) {
      hideLoading()
      showError(err.message || '质检提交失败')
    } finally {
      this.setData({ loading: false })
    }
  }
})
