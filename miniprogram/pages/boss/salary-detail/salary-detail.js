// pages/boss/salary-detail/salary-detail.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, formatMoney, showConfirm } = require('../../../utils/util')
const { getStoredUser } = require('../../../utils/auth')

Page({
  data: {
    userId: '',
    userName: '',
    month: '',
    salaryData: null,
    adjustments: [],
    workLogs: [],
    isPaidLocked: false,
    showAddAdj: false,
    newAdj: {
      amount: '',
      reason: '',
      isReward: true
    },
    loading: false,
    // 编辑报工
    showEditWorkLog: false,
    editWL: null,
    editWLQuantity: 0,
    editWLNote: '',
    editWLReason: '',
    editWLReasonIndex: -1,
    editWLReasons: ['录入错误', '数量填多了', '数量填少了', '工序选错', '其他原因'],
    // 编辑奖惩
    showEditAdj: false,
    editAdj: null,
    editAdjAmount: '',
    editAdjReason: '',
    editAdjEditReason: ''
  },

  onLoad(options) {
    const now = new Date()
    this.setData({
      userId: options.id,
      userName: decodeURIComponent(options.name || ''),
      month: options.month || `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
    wx.setNavigationBarTitle({ title: `${this.data.userName} - 薪资详情` })
  },

  onShow() {
    this.loadSalaryDetail()
  },

  async loadSalaryDetail() {
    try {
      const res = await callCloud('salary', {
        action: 'getUserMonthlySalaryByBoss',
        user_id: this.data.userId,
        month: this.data.month
      })
      const data = res.data || {}
      const ws = data.work_stats || {}
      const isPaid = !!data.is_paid
      const logs = (data.logs || []).map(item => {
        const amount = (item.quantity || 0) * Number(item.snapshot_price || 0)
        return {
          ...item,
          amount_display: formatMoney(Math.round(amount * 100) / 100),
          is_locked: isPaid
        }
      })
      this.setData({
        isPaidLocked: isPaid,
        salaryData: {
          baseSalary: formatMoney(data.piece_rate || 0),
          adjustmentTotal: formatMoney((data.reward || 0) - (data.penalty || 0)),
          finalSalary: formatMoney(data.total || 0),
          monthlyHours: (ws.total_hours || 0).toFixed(1),
          totalOutput: ws.total_quantity || 0,
          totalPassed: ws.total_passed || 0,
          passRate: (ws.pass_rate || 0).toFixed(1)
        },
        adjustments: (data.adjustments || []).map(a => ({
          ...a,
          is_locked: isPaid
        })),
        workLogs: logs
      })
    } catch (e) {
      showError('加载失败')
    }
  },

  toggleAddAdj() {
    this.setData({ showAddAdj: !this.data.showAddAdj })
  },

  onAdjAmountInput(e) {
    this.setData({ 'newAdj.amount': e.detail.value })
  },

  onAdjReasonInput(e) {
    this.setData({ 'newAdj.reason': e.detail.value })
  },

  toggleAdjType() {
    this.setData({ 'newAdj.isReward': !this.data.newAdj.isReward })
  },

  async onSubmitAdj() {
    const { amount, reason, isReward } = this.data.newAdj
    if (!amount || parseFloat(amount) <= 0) {
      showError('请输入有效金额')
      return
    }
    if (!reason) {
      showError('请输入原因')
      return
    }

    const finalAmount = parseFloat(amount)
    const confirmed = await showConfirm(
      '确认操作',
      `${isReward ? '奖励' : '扣款'} ¥${finalAmount} \n原因: ${reason}`
    )
    if (!confirmed) return

    showLoading('提交中...')
    try {
      const bossUser = getStoredUser()
      await callCloud('salary', {
        action: 'addAdjustment',
        user_id: this.data.userId,
        user_name: this.data.userName,
        type: isReward ? 'reward' : 'penalty',
        amount: finalAmount,
        reason
      })
      hideLoading()
      showSuccess('操作成功')
      this.setData({
        showAddAdj: false,
        newAdj: { amount: '', reason: '', isReward: true }
      })
      this.loadSalaryDetail()
    } catch (err) {
      hideLoading()
      showError(err.message || '操作失败')
    }
  },

  // ========== 编辑报工记录（管理员端） ==========
  onEditWorkLog(e) {
    const log = e.currentTarget.dataset.log
    this.setData({
      showEditWorkLog: true,
      editWL: log,
      editWLQuantity: log.quantity,
      editWLNote: log.note || '',
      editWLReason: '',
      editWLReasonIndex: -1
    })
  },

  closeEditWorkLog() {
    this.setData({ showEditWorkLog: false, editWL: null })
  },

  onEditWLQtyInput(e) {
    this.setData({ editWLQuantity: parseInt(e.detail.value) || 0 })
  },

  onEditWLNoteInput(e) {
    this.setData({ editWLNote: e.detail.value })
  },

  onEditWLReasonChange(e) {
    const idx = parseInt(e.detail.value)
    this.setData({
      editWLReasonIndex: idx,
      editWLReason: this.data.editWLReasons[idx]
    })
  },

  onEditWLReasonCustom(e) {
    this.setData({ editWLReason: e.detail.value })
  },

  async onSaveEditWorkLog() {
    if (this.data.editWLQuantity <= 0) {
      showError('报工数量必须大于0')
      return
    }
    if (!this.data.editWLReason) {
      showError('请选择或输入修改原因')
      return
    }

    showLoading('修改中...')
    try {
      await callCloud('worklog', {
        action: 'updateWorkLog',
        log_id: this.data.editWL._id,
        quantity: this.data.editWLQuantity,
        note: this.data.editWLNote,
        reason: this.data.editWLReason
      })
      hideLoading()
      showSuccess('修改成功')
      this.setData({ showEditWorkLog: false, editWL: null })
      this.loadSalaryDetail()
    } catch (err) {
      hideLoading()
      showError(err.message || '修改失败')
    }
  },

  // ========== 编辑奖惩（管理员端） ==========
  onEditAdj(e) {
    const adj = e.currentTarget.dataset.adj
    this.setData({
      showEditAdj: true,
      editAdj: adj,
      editAdjAmount: String(adj.amount),
      editAdjReason: adj.reason,
      editAdjEditReason: ''
    })
  },

  closeEditAdj() {
    this.setData({ showEditAdj: false, editAdj: null })
  },

  onEditAdjAmountInput(e) {
    this.setData({ editAdjAmount: e.detail.value })
  },

  onEditAdjReasonInput(e) {
    this.setData({ editAdjReason: e.detail.value })
  },

  onEditAdjEditReasonInput(e) {
    this.setData({ editAdjEditReason: e.detail.value })
  },

  async onSaveEditAdj() {
    if (!this.data.editAdjAmount || parseFloat(this.data.editAdjAmount) <= 0) {
      showError('请输入有效金额')
      return
    }
    if (!this.data.editAdjEditReason) {
      showError('请输入修改原因')
      return
    }

    showLoading('修改中...')
    try {
      await callCloud('salary', {
        action: 'updateAdjustment',
        adjustment_id: this.data.editAdj._id,
        amount: parseFloat(this.data.editAdjAmount),
        reason: this.data.editAdjReason,
        edit_reason: this.data.editAdjEditReason
      })
      hideLoading()
      showSuccess('修改成功')
      this.setData({ showEditAdj: false, editAdj: null })
      this.loadSalaryDetail()
    } catch (err) {
      hideLoading()
      showError(err.message || '修改失败')
    }
  },

  async onDeleteAdj(e) {
    const adj = e.currentTarget.dataset.adj
    wx.showModal({
      title: '删除奖惩',
      content: `确定删除该${adj.type === 'reward' ? '奖励' : '处罚'}记录（¥${adj.amount}）？`,
      editable: true,
      placeholderText: '请输入删除原因',
      success: async (res) => {
        if (res.confirm && res.content) {
          showLoading('删除中...')
          try {
            await callCloud('salary', {
              action: 'deleteAdjustment',
              adjustment_id: adj._id,
              delete_reason: res.content
            })
            hideLoading()
            showSuccess('已删除')
            this.loadSalaryDetail()
          } catch (err) {
            hideLoading()
            showError(err.message || '删除失败')
          }
        } else if (res.confirm) {
          showError('请输入删除原因')
        }
      }
    })
  }
})
