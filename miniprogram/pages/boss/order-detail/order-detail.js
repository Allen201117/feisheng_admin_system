// pages/boss/order-detail/order-detail.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, showConfirm, formatMoney } = require('../../../utils/util')
const { buildDeleteOrderConfirmContent } = require('../orders/orders.logic')

function parseSafeDate(dateStr) {
  if (!dateStr) return null
  const parsed = new Date(dateStr.replace(/-/g, '/'))
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

function clampPercent(value) {
  if (value < 0) return 0
  if (value > 100) return 100
  return Math.round(value)
}

function buildOrderTimeline(order) {
  var nowTs = Date.now()
  const start = parseSafeDate(order.start_date)
  const end = parseSafeDate(order.end_date)

  let timelineProgress = 0
  let daysLeftText = '未设置截止'
  let overdue = false

  if (start && end) {
    const totalMs = end.getTime() - start.getTime()
    const passedMs = nowTs - start.getTime()

    if (totalMs <= 0) {
      timelineProgress = nowTs >= end.getTime() ? 100 : 0
    } else {
      timelineProgress = clampPercent((passedMs / totalMs) * 100)
    }

    const dayMs = 24 * 60 * 60 * 1000
    const diffDays = Math.ceil((end.getTime() - nowTs) / dayMs)
    if (diffDays < 0) {
      overdue = order.status === 'active'
      daysLeftText = `超期 ${Math.abs(diffDays)} 天`
    } else if (diffDays === 0) {
      daysLeftText = '今天截止'
    } else {
      daysLeftText = `剩余 ${diffDays} 天`
    }
  }

  return {
    timeline_progress: timelineProgress,
    days_left_text: daysLeftText,
    overdue
  }
}

function getOrderStatusText(status) {
  return status === 'active' ? '进行中' : (status === 'completed' ? '已完成' : '已取消')
}

function getOrderStatusClass(status) {
  return status === 'active' ? 'tag-success' : (status === 'completed' ? 'tag-info' : 'tag-danger')
}

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

    // 状态选项
    statusOptions: [
      { value: 'active', text: '进行中' },
      { value: 'completed', text: '已完成' },
      { value: 'cancelled', text: '已取消' }
    ],
    editStatusIndex: 0,

    showAddProcess: false,
    newProcess: { process_name: '', current_price: '' },

    // 分配面板（双栏模式）
    showAssign: false,
    activeAssignProcessId: '',
    assignMap: {},           // processId -> userId[]
    originalAssignMap: {},   // 原始快照用于 diff
    showEmpProcesses: false,
    empProcessesName: '',
    empProcessesList: [],

    // 编辑工序
    showEditProcess: false,
    editProcessId: '',
    editProcessName: '',
    editProcessNote: '',
    editProcessPrice: '',

    // 工价变更记录
    showPriceHistory: false,
    priceChangeLogs: [],

    // 编辑订单
    showEditOrder: false,
    editOrderName: '',
    editTotalQuantity: '',
    editStartDate: '',
    editEndDate: '',

    // 复制订单
    showCopyOrder: false,
    copyTotalQuantity: '',

    loading: false
  },

  onLoad(options) {
    if (!options || !options.id) {
      showError('缺少订单ID')
      setTimeout(() => wx.navigateBack(), 1500)
      return
    }
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
        const orderData = res.data.order || {}
        const timeline = buildOrderTimeline(orderData)
        this.setData({
          order: {
            ...orderData,
            status_text: getOrderStatusText(orderData.status),
            status_class: getOrderStatusClass(orderData.status),
            ...timeline
          },
          processes,
          assignedCount,
          unassignedCount: processes.length - assignedCount
        })
        this.applyFilter()
        // 初始化 assignMap（用于分配面板）
        const assignMap = {}
        processes.forEach(p => {
          assignMap[p._id] = [...(p.assigned_user_ids || [])]
        })
        this.setData({ assignMap })
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

  // ===== 双栏分配面板 =====
  showAssignPanel() {
    const { processes } = this.data
    const assignMap = {}
    const processesWithCounts = processes.map(p => {
      const ids = [...(p.assigned_user_ids || [])]
      assignMap[p._id] = ids
      return {
        ...p,
        _assignedCount: ids.length,
        _assignedNames: ids.slice(0, 5).map(id => this.data.employeeMap[id] || '?')
      }
    })
    const originalAssignMap = {}
    processes.forEach(p => {
      originalAssignMap[p._id] = [...(p.assigned_user_ids || [])]
    })
    const activeProcessId = processes.length > 0 ? processes[0]._id : ''
    this.setData({
      showAssign: true,
      assignMap,
      originalAssignMap,
      processes: processesWithCounts,
      activeAssignProcessId: activeProcessId,
      _currentProcessUserIds: assignMap[activeProcessId] || []
    })
  },

  hideAssign() {
    this.setData({ showAssign: false })
  },

  stopBubble() {},

  onSelectAssignProcess(e) {
    const processId = e.currentTarget.dataset.id
    this.setData({
      activeAssignProcessId: processId,
      _currentProcessUserIds: this.data.assignMap[processId] || []
    })
  },

  toggleAssignUser(e) {
    const userId = e.currentTarget.dataset.id
    const processId = this.data.activeAssignProcessId
    if (!processId) return

    const assignMap = { ...this.data.assignMap }
    const ids = [...(assignMap[processId] || [])]
    const idx = ids.indexOf(userId)
    if (idx >= 0) {
      ids.splice(idx, 1)
    } else {
      ids.push(userId)
    }
    assignMap[processId] = ids

    // 更新 processes 中对应工序的计算字段
    const processes = this.data.processes.map(p => {
      if (p._id === processId) {
        return {
          ...p,
          _assignedCount: ids.length,
          _assignedNames: ids.slice(0, 5).map(id => this.data.employeeMap[id] || '?')
        }
      }
      return p
    })

    this.setData({ assignMap, processes, _currentProcessUserIds: ids })
  },

  clearAssignment() {
    const processId = this.data.activeAssignProcessId
    if (!processId) return
    const assignMap = { ...this.data.assignMap }
    assignMap[processId] = []

    const processes = this.data.processes.map(p => {
      if (p._id === processId) {
        return {
          ...p,
          _assignedCount: 0,
          _assignedNames: []
        }
      }
      return p
    })

    this.setData({ assignMap, processes, _currentProcessUserIds: [] })
  },

  _arraysChanged(a, b) {
    if (a.length !== b.length) return true
    const sortedA = [...a].sort()
    const sortedB = [...b].sort()
    return sortedA.some((v, i) => v !== sortedB[i])
  },

  _getAssignChanges() {
    const { assignMap, originalAssignMap, processes, employeeMap } = this.data
    const changes = []
    for (const proc of processes) {
      const orig = originalAssignMap[proc._id] || []
      const curr = assignMap[proc._id] || []
      if (this._arraysChanged(orig, curr)) {
        changes.push({
          process_id: proc._id,
          process_name: proc.process_name,
          user_ids: curr,
          names: curr.slice(0, 3).map(id => employeeMap[id] || '未知'),
          count: curr.length
        })
      }
    }
    return changes
  },

  onLongPressEmployee(e) {
    const empId = e.currentTarget.dataset.id
    const empName = this.data.employeeMap[empId] || '未知'
    const { assignMap, processes } = this.data
    const assigned = processes.filter(p => (assignMap[p._id] || []).includes(empId)).map(p => p.process_name)
    this.setData({
      showEmpProcesses: true,
      empProcessesName: empName,
      empProcessesList: assigned.length > 0 ? assigned : ['暂未分配任何工序']
    })
  },

  closeEmpProcesses() {
    this.setData({ showEmpProcesses: false })
  },

  // 点击保存 → 确认弹窗
  onConfirmAssign() {
    const changes = this._getAssignChanges()
    if (changes.length === 0) {
      showError('未修改分配')
      return
    }
    let content = `共 ${changes.length} 道工序有变更：\n`
    changes.forEach(c => {
      content += `\n${c.process_name}：${c.count}人`
      if (c.names.length > 0) content += `（${c.names.join('、')}${c.count > 3 ? '等' : ''}）`
    })
    wx.showModal({
      title: '确认保存工序分配',
      content,
      confirmText: '确认保存',
      cancelText: '取消',
      success: (res) => {
        if (res.confirm) this.doSaveAssignment()
      }
    })
  },

  async doSaveAssignment() {
    const changes = this._getAssignChanges()
    if (changes.length === 0) return

    showLoading('保存中...')
    try {
      for (const change of changes) {
        await callCloud('order', {
          action: 'assignProcess',
          process_id: change.process_id,
          user_ids: change.user_ids
        })
      }
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
  },

  // ===== 更多操作 =====
  onMoreAction() {
    const order = this.data.order
    if (!order) return
    const items = order.status === 'active'
      ? ['编辑订单', '复制订单', '删除订单']
      : ['复制订单', '删除订单']
    wx.showActionSheet({
      itemList: items,
      success: (res) => {
        const action = items[res.tapIndex]
        if (action === '编辑订单') this.onEditOrder()
        else if (action === '复制订单') this.onCopyOrder()
        else if (action === '删除订单') this.onDeleteOrder()
      }
    })
  },

  async onChangeOrderStatus() {
    const order = this.data.order
    if (!order || !order._id) return

    const itemList = ['进行中', '已完成', '已取消']
    wx.showActionSheet({
      itemList,
      success: async (res) => {
        const idx = res.tapIndex
        const map = ['active', 'completed', 'cancelled']
        const target = map[idx]
        if (!target || target === order.status) return

        const confirmed = await showConfirm(
          '确认修改状态',
          `确定将订单"${order.order_name}"改为“${getOrderStatusText(target)}”吗？`
        )
        if (!confirmed) return

        showLoading('更新中...')
        try {
          await callCloud('order', {
            action: 'updateStatus',
            order_id: order._id,
            status: target
          })
          hideLoading()
          showSuccess('订单状态已更新')
          this.loadOrderDetail()
        } catch (err) {
          hideLoading()
          showError(err.message || '状态更新失败')
        }
      }
    })
  },

  async onTogglePriceHidden(e) {
    const newValue = e.detail.value
    const order = this.data.order
    if (!order || !order._id) return

    showLoading(newValue ? '开启工价隐藏...' : '关闭工价隐藏...')
    try {
      await callCloud('order', {
        action: 'togglePriceHidden',
        order_id: order._id,
        price_hidden: newValue
      })
      hideLoading()
      showSuccess(newValue ? '已开启工价隐藏' : '已关闭工价隐藏')
      this.setData({ 'order.price_hidden': newValue })
    } catch (err) {
      hideLoading()
      showError(err.message || '操作失败')
    }
  },

  // ===== 一键清空工价 =====
  async onDeleteOrder() {
    const order = this.data.order
    if (!order || !order._id) return

    const confirmed = await showConfirm(
      '确认删除订单',
      buildDeleteOrderConfirmContent(order.order_name, {
        processCount: this.data.processes.length
      })
    )
    if (!confirmed) return

    showLoading('删除中...')
    try {
      await callCloud('order', {
        action: 'deleteOrder',
        order_id: order._id
      })
      hideLoading()
      showSuccess('订单已删除')
      wx.navigateBack()
    } catch (err) {
      hideLoading()
      showError(err.message || '删除订单失败')
    }
  },

  async onClearAllPrices() {
    const order = this.data.order
    if (!order || !order._id) return

    const pricesExist = this.data.processes.some(p => p.current_price != null)
    if (!pricesExist) {
      showError('所有工序工价已经是空的')
      return
    }

    const confirmed = await showConfirm(
      '确认清空所有工价',
      '此操作将清空该订单所有工序的当前工价。已有的历史报工记录不受影响（使用快照工价结算）。\n\n清空后，员工将无法对未设价工序进行报工。'
    )
    if (!confirmed) return

    showLoading('清空工价中...')
    try {
      const res = await callCloud('order', {
        action: 'clearOrderPrices',
        order_id: order._id
      })
      hideLoading()
      showSuccess(res.msg || '已清空工价')
      this.loadOrderDetail()
    } catch (err) {
      hideLoading()
      showError(err.message || '清空失败')
    }
  },

  // ===== 工价变更记录 =====
  async onShowPriceHistory() {
    this.setData({ showPriceHistory: true, priceChangeLogs: [] })
    showLoading('加载变更记录...')
    try {
      const res = await callCloud('order', {
        action: 'getPriceChangeLogs',
        order_id: this.data.orderId
      })
      hideLoading()
      const logs = (res.data || []).map(log => {
        let timeStr = ''
        if (log.created_at) {
          const d = new Date(log.created_at)
          if (!isNaN(d.getTime())) {
            timeStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
          }
        }
        return { ...log, created_at_display: timeStr }
      })
      this.setData({ priceChangeLogs: logs })
    } catch (err) {
      hideLoading()
      showError('加载变更记录失败')
    }
  },

  hidePriceHistory() {
    this.setData({ showPriceHistory: false })
  },

  // ===== 编辑订单 =====
  onEditOrder() {
    const order = this.data.order
    const statusIdx = this.data.statusOptions.findIndex(s => s.value === order.status)
    this.setData({
      showEditOrder: true,
      editOrderName: order.order_name,
      editTotalQuantity: String(order.total_quantity),
      editStartDate: order.start_date || '',
      editEndDate: order.end_date || '',
      editStatusIndex: statusIdx >= 0 ? statusIdx : 0
    })
  },

  closeEditOrder() { this.setData({ showEditOrder: false }) },
  onEditOrderNameInput(e) { this.setData({ editOrderName: e.detail.value }) },
  onEditTotalQuantityInput(e) { this.setData({ editTotalQuantity: e.detail.value }) },
  onEditStartDateChange(e) { this.setData({ editStartDate: e.detail.value }) },
  onEditEndDateChange(e) { this.setData({ editEndDate: e.detail.value }) },
  onEditStatusChange(e) { this.setData({ editStatusIndex: Number(e.detail.value) }) },

  async onSaveEditOrder() {
    const { editOrderName, editTotalQuantity, editStartDate, editEndDate, editStatusIndex, statusOptions } = this.data
    if (!editOrderName) { showError('订单名称不能为空'); return }
    const qty = parseInt(editTotalQuantity)
    if (!qty || qty <= 0) { showError('请输入有效的总数量'); return }

    const newStatus = statusOptions[editStatusIndex].value
    const oldStatus = this.data.order.status

    showLoading('保存中...')
    try {
      await callCloud('order', {
        action: 'updateOrder',
        order_id: this.data.orderId,
        order_name: editOrderName,
        total_quantity: qty,
        start_date: editStartDate,
        end_date: editEndDate
      })

      if (newStatus !== oldStatus) {
        await callCloud('order', {
          action: 'updateStatus',
          order_id: this.data.orderId,
          status: newStatus
        })
      }

      hideLoading()
      showSuccess('订单已更新')
      this.setData({ showEditOrder: false })
      this.loadOrderDetail()
    } catch (err) {
      hideLoading()
      showError(err.message || '更新失败')
    }
  },

  // ===== 复制订单 =====
  onCopyOrder() {
    this.setData({
      showCopyOrder: true,
      copyTotalQuantity: String(this.data.order.total_quantity)
    })
  },

  closeCopyOrder() { this.setData({ showCopyOrder: false }) },
  onCopyTotalQuantityInput(e) { this.setData({ copyTotalQuantity: e.detail.value }) },

  async onConfirmCopyOrder() {
    const qty = parseInt(this.data.copyTotalQuantity)
    if (!qty || qty <= 0) { showError('请输入有效的总数量'); return }

    const confirmed = await showConfirm(
      '确认复制订单',
      `将复制订单"${this.data.order.order_name}"及其所有工序和分配，新总数量为${qty}件。`
    )
    if (!confirmed) return

    showLoading('复制中...')
    try {
      const res = await callCloud('order', {
        action: 'copyOrder',
        source_order_id: this.data.orderId,
        new_total_quantity: qty
      })
      hideLoading()
      showSuccess('订单复制成功')
      this.setData({ showCopyOrder: false })
      wx.navigateTo({ url: '/pages/boss/order-detail/order-detail?id=' + res.data.new_order_id })
    } catch (err) {
      hideLoading()
      showError(err.message || '复制失败')
    }
  }
})
