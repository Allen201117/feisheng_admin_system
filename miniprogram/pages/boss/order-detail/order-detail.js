// pages/boss/order-detail/order-detail.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, showConfirm, formatMoney } = require('../../../utils/util')

Page({
  data: {
    orderId: '',
    order: null,
    processes: [],
    filteredProcesses: [],
    allEmployees: [],
    employeeMap: {},  // id → name
    assignedCount: 0,
    unassignedCount: 0,
    processFilter: 'all', // all | unassigned | assigned

    showAddProcess: false,
    newProcess: { process_name: '', current_price: '' },

    // 分配面板
    showAssign: false,
    assignProcessId: '',
    assignProcessName: '',
    assignedUserIds: [],
    originalAssignedIds: [], // 用于 diff 比较
    assignHasChange: false,

    // 编辑工序
    showEditProcess: false,
    editProcessId: '',
    editProcessName: '',
    editProcessNote: '',
    editProcessPrice: '',

    loading: false
  },

  onLoad(options) {
    this.setData({ orderId: options.id })
  },

  onShow() {
    this.loadOrderDetail()
    this.loadAllEmployees()
  },

  async loadOrderDetail() {
    try {
      const res = await callCloud('order', {
        action: 'getDetail',
        order_id: this.data.orderId
      })
      if (res.data) {
        const processes = (res.data.processes || []).map(p => {
          const ids = p.assigned_user_ids || []
          const names = p.assigned_names ? p.assigned_names.split('、') : []
          return { ...p, assigned_user_ids: ids, _assignedNames: names }
        })
        const assignedCount = processes.filter(p => p.assigned_user_ids.length > 0).length
        this.setData({
          order: res.data.order,
          processes,
          assignedCount,
          unassignedCount: processes.length - assignedCount
        })
        this.applyFilter()
      }
    } catch (e) {
      showError('加载订单详情失败')
    }
  },

  async loadAllEmployees() {
    try {
      const res = await callCloud('user', { action: 'listEmployees' })
      const list = res.data || []
      const map = {}
      list.forEach(e => { map[e._id] = e.name })
      this.setData({ allEmployees: list, employeeMap: map })
    } catch (e) {
      console.error('加载员工列表失败', e)
    }
  },

  // ===== 工序筛选 =====
  onProcessFilter(e) {
    this.setData({ processFilter: e.currentTarget.dataset.filter })
    this.applyFilter()
  },

  applyFilter() {
    const { processes, processFilter } = this.data
    let filtered
    if (processFilter === 'unassigned') {
      filtered = processes.filter(p => !p.assigned_user_ids || p.assigned_user_ids.length === 0)
    } else if (processFilter === 'assigned') {
      filtered = processes.filter(p => p.assigned_user_ids && p.assigned_user_ids.length > 0)
    } else {
      filtered = processes
    }
    this.setData({ filteredProcesses: filtered })
  },

  // ===== 添加工序 =====
  toggleAddProcess() {
    this.setData({ showAddProcess: !this.data.showAddProcess })
  },

  onInputProcessName(e) {
    this.setData({ 'newProcess.process_name': e.detail.value })
  },

  onInputProcessPrice(e) {
    this.setData({ 'newProcess.current_price': e.detail.value })
  },

  async onAddProcess() {
    const { process_name, current_price } = this.data.newProcess
    if (!process_name) { showError('请输入工序名称'); return }
    if (!current_price || parseFloat(current_price) <= 0) { showError('请输入有效的单价'); return }

    showLoading('添加中...')
    try {
      await callCloud('order', {
        action: 'addProcess',
        order_id: this.data.orderId,
        process_name,
        current_price: parseFloat(current_price)
      })
      hideLoading()
      showSuccess('工序添加成功')
      this.setData({ showAddProcess: false, newProcess: { process_name: '', current_price: '' } })
      this.loadOrderDetail()
    } catch (err) {
      hideLoading()
      showError(err.message || '添加失败')
    }
  },

  // ===== 编辑工序 =====
  onEditProcess(e) {
    const process = e.currentTarget.dataset.process
    this.setData({
      showEditProcess: true,
      editProcessId: process._id,
      editProcessName: process.process_name,
      editProcessNote: process.note || '',
      editProcessPrice: String(process.current_price)
    })
  },

  closeEditProcess() {
    this.setData({ showEditProcess: false })
  },

  onEditProcessNameInput(e) { this.setData({ editProcessName: e.detail.value }) },
  onEditProcessNoteInput(e) { this.setData({ editProcessNote: e.detail.value }) },
  onEditProcessPriceInput(e) { this.setData({ editProcessPrice: e.detail.value }) },

  async onSaveEditProcess() {
    const { editProcessId, editProcessName, editProcessNote, editProcessPrice } = this.data
    if (!editProcessName) { showError('工序名称不能为空'); return }
    const price = parseFloat(editProcessPrice)
    if (isNaN(price) || price <= 0) { showError('请输入有效的单价'); return }

    showLoading('保存中...')
    try {
      await callCloud('order', {
        action: 'updateProcess',
        process_id: editProcessId,
        process_name: editProcessName,
        note: editProcessNote,
        current_price: price
      })
      hideLoading()
      showSuccess('工序已更新')
      this.setData({ showEditProcess: false })
      this.loadOrderDetail()
    } catch (err) {
      hideLoading()
      showError(err.message || '更新失败')
    }
  },

  // ===== 分配员工面板 =====
  showAssignPanel(e) {
    const processId = e.currentTarget.dataset.id
    const process = this.data.processes.find(p => p._id === processId)
    const ids = process ? [...(process.assigned_user_ids || [])] : []
    this.setData({
      showAssign: true,
      assignProcessId: processId,
      assignProcessName: process ? process.process_name : '',
      assignedUserIds: ids,
      originalAssignedIds: [...ids],
      assignHasChange: false
    })
  },

  hideAssign() {
    this.setData({ showAssign: false })
  },

  stopBubble() {},

  toggleAssignUser(e) {
    const userId = e.currentTarget.dataset.id
    let ids = [...this.data.assignedUserIds]
    const idx = ids.indexOf(userId)
    if (idx >= 0) {
      ids.splice(idx, 1)
    } else {
      ids.push(userId)
    }
    // 计算是否有变更
    const original = this.data.originalAssignedIds
    const hasChange = this._arraysChanged(original, ids)
    this.setData({ assignedUserIds: ids, assignHasChange: hasChange })
  },

  clearAssignment() {
    const original = this.data.originalAssignedIds
    const hasChange = original.length > 0
    this.setData({ assignedUserIds: [], assignHasChange: hasChange })
  },

  _arraysChanged(a, b) {
    if (a.length !== b.length) return true
    const sortedA = [...a].sort()
    const sortedB = [...b].sort()
    return sortedA.some((v, i) => v !== sortedB[i])
  },

  // 点击保存 → 原生确认弹窗
  onConfirmAssign() {
    if (!this.data.assignHasChange) {
      showError('未修改分配')
      return
    }
    const { assignedUserIds, employeeMap } = this.data
    const names = assignedUserIds.slice(0, 5).map(id => employeeMap[id] || '未知')
    let content = '工序：' + this.data.assignProcessName + '\n'
    if (assignedUserIds.length > 0) {
      content += '将分配给：' + names.join('、')
      if (assignedUserIds.length > 5) content += ' 等' + assignedUserIds.length + '人'
    } else {
      content += '将清空该工序的所有分配'
    }
    wx.showModal({
      title: '确认保存工序分配',
      content: content,
      confirmText: '确认保存',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) {
          this.doSaveAssignment()
        }
      }
    })
  },

  async doSaveAssignment() {
    showLoading('保存中...')
    try {
      await callCloud('order', {
        action: 'assignProcess',
        process_id: this.data.assignProcessId,
        user_ids: this.data.assignedUserIds
      })
      hideLoading()
      showSuccess('分配成功')
      this.setData({ showAssign: false })
      this.loadOrderDetail()
    } catch (err) {
      hideLoading()
      showError(err.message || '分配失败')
    }
  },

  // ===== 删除工序 =====
  async onDeleteProcess(e) {
    const process = e.currentTarget.dataset.process
    const confirmed = await showConfirm('确认删除', `确定删除工序"${process.process_name}"吗？`)
    if (!confirmed) return

    showLoading('删除中...')
    try {
      await callCloud('order', {
        action: 'deleteProcess',
        process_id: process._id
      })
      hideLoading()
      showSuccess('已删除')
      this.loadOrderDetail()
    } catch (err) {
      hideLoading()
      showError(err.message || '删除失败')
    }
  }
})
