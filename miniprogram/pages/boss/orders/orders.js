// pages/boss/orders/orders.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, showConfirm } = require('../../../utils/util')
const { buildDeleteOrderConfirmContent } = require('./orders.logic')
const { filterListByKeyword } = require('../../../utils/list-search')

const bjTime = require('../../../utils/beijing-time')

const ORDER_SEARCH_FIELDS = [
  'order_name',
  'status_text',
  'start_date',
  'end_date',
  'days_left_text',
  'total_quantity',
  'process_count'
]

function clampPercent(value) {
  if (value < 0) return 0
  if (value > 100) return 100
  return Math.round(value)
}

// 与 order-detail 同口径：业务日期按北京时间整天差，不依赖设备时区
function dateStrToDayNumber(dateStr) {
  if (!dateStr || typeof dateStr !== 'string') return null
  const parts = dateStr.split('-')
  if (parts.length !== 3) return null
  const ts = Date.UTC(parseInt(parts[0], 10), parseInt(parts[1], 10) - 1, parseInt(parts[2], 10))
  return Number.isNaN(ts) ? null : Math.floor(ts / 86400000)
}

function enrichOrder(order) {
  const todayDay = dateStrToDayNumber(bjTime.getBeijingToday())
  const startDay = dateStrToDayNumber(order.start_date)
  const endDay = dateStrToDayNumber(order.end_date)

  let timelineProgress = 0
  let daysLeftText = '未设置截止'
  let overdue = false

  if (startDay != null && endDay != null && todayDay != null) {
    const totalDays = endDay - startDay
    const passedDays = todayDay - startDay

    if (totalDays <= 0) {
      timelineProgress = todayDay >= endDay ? 100 : 0
    } else {
      timelineProgress = clampPercent((passedDays / totalDays) * 100)
    }

    const diffDays = endDay - todayDay
    if (diffDays < 0) {
      overdue = order.status === 'active'
      daysLeftText = `超期 ${Math.abs(diffDays)} 天`
    } else if (diffDays === 0) {
      daysLeftText = '今天截止'
    } else {
      daysLeftText = `剩余 ${diffDays} 天`
    }
  }

  const statusText = order.status === 'active' ? '进行中' : (order.status === 'completed' ? '已完成' : '已取消')
  const statusClass = order.status === 'active' ? 'tag-success' : (order.status === 'completed' ? 'tag-info' : 'tag-danger')

  return {
    ...order,
    status_text: statusText,
    status_class: statusClass,
    timeline_progress: timelineProgress,
    days_left_text: daysLeftText,
    overdue,
    total_quantity: parseInt(order.total_quantity || 0, 10) || 0,
    process_count: parseInt(order.process_count || 0, 10) || 0
  }
}

Page({
  data: {
    orders: [],
    filteredOrders: [],
    loading: false,
    activeFilter: 'all',
    orderSearchKeyword: '',
    statCards: [
      { key: 'total', label: '全部订单', value: 0, className: 'stat-neutral' },
      { key: 'active', label: '进行中', value: 0, className: 'stat-active' },
      { key: 'completed', label: '已完成', value: 0, className: 'stat-completed' },
      { key: 'overdue', label: '超期', value: 0, className: 'stat-overdue' }
    ],
    filterTabs: [
      { key: 'all', label: '全部' },
      { key: 'active', label: '进行中' },
      { key: 'completed', label: '已完成' },
      { key: 'cancelled', label: '已取消' }
    ],
    showAddForm: false,
    newOrder: {
      order_name: '',
      start_date: '',
      end_date: '',
      total_quantity: ''
    }
  },

  onShow() {
    this.loadOrders()
  },

  onPullDownRefresh() {
    this.loadOrders().finally(() => wx.stopPullDownRefresh())
  },

  async loadOrders() {
    this.setData({ loading: true })
    try {
      const res = await callCloud('order', {
        action: 'list'
      })
      const orders = (res.data || []).map(enrichOrder)
      this.setData({ orders }, () => this.refreshDerivedData())
    } catch (e) {
      showError('加载订单失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  toggleAddForm() {
    this.setData({ showAddForm: !this.data.showAddForm })
  },

  onFilterChange(e) {
    const key = e.currentTarget.dataset.key
    if (!key || key === this.data.activeFilter) return
    this.setData({ activeFilter: key }, () => this.refreshDerivedData())
  },

  refreshDerivedData() {
    const { orders, activeFilter, statCards, orderSearchKeyword } = this.data
    const statusFilteredOrders = activeFilter === 'all'
      ? orders
      : orders.filter(item => item.status === activeFilter)
    const filteredOrders = filterListByKeyword(statusFilteredOrders, orderSearchKeyword, ORDER_SEARCH_FIELDS)

    const total = orders.length
    const active = orders.filter(item => item.status === 'active').length
    const completed = orders.filter(item => item.status === 'completed').length
    const overdue = orders.filter(item => item.overdue).length

    const nextCards = statCards.map((card) => {
      if (card.key === 'total') return { ...card, value: total }
      if (card.key === 'active') return { ...card, value: active }
      if (card.key === 'completed') return { ...card, value: completed }
      if (card.key === 'overdue') return { ...card, value: overdue }
      return card
    })

    this.setData({
      filteredOrders,
      statCards: nextCards
    })
  },

  onOrderSearchInput(e) {
    this.setData({ orderSearchKeyword: e.detail.value }, () => this.refreshDerivedData())
  },

  clearOrderSearch() {
    if (!this.data.orderSearchKeyword) return
    this.setData({ orderSearchKeyword: '' }, () => this.refreshDerivedData())
  },

  onInputOrderName(e) {
    this.setData({ 'newOrder.order_name': e.detail.value })
  },

  onStartDateChange(e) {
    this.setData({ 'newOrder.start_date': e.detail.value })
  },

  onEndDateChange(e) {
    this.setData({ 'newOrder.end_date': e.detail.value })
  },

  onInputQuantity(e) {
    this.setData({ 'newOrder.total_quantity': e.detail.value })
  },

  async onAddOrder() {
    const { order_name, start_date, end_date, total_quantity } = this.data.newOrder
    if (!order_name) { showError('请输入订单名称'); return }
    if (!start_date) { showError('请选择开始日期'); return }
    if (!total_quantity || parseInt(total_quantity) <= 0) { showError('请输入有效的总数量'); return }

    showLoading('创建中...')
    try {
      await callCloud('order', {
        action: 'create',
        order_name,
        start_date,
        end_date: end_date || '',
        total_quantity: parseInt(total_quantity)
      })
      hideLoading()
      showSuccess('订单创建成功')
      this.setData({
        showAddForm: false,
        newOrder: { order_name: '', start_date: '', end_date: '', total_quantity: '' }
      })
      await this.loadOrders()
    } catch (err) {
      hideLoading()
      showError(err.message || '创建失败')
    }
  },

  goOrderDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/boss/order-detail/order-detail?id=${id}` })
  },

  stopPropagation() {},

  async onCompleteOrder(e) {
    const order = e.currentTarget.dataset.order
    const confirmed = await showConfirm('确认完成', `确定将订单"${order.order_name}"标记为已完成吗？`)
    if (!confirmed) return

    showLoading('操作中...')
    try {
      await callCloud('order', {
        action: 'updateStatus',
        order_id: order._id,
        status: 'completed'
      })
      hideLoading()
      showSuccess('订单已完成')
      await this.loadOrders()
    } catch (err) {
      hideLoading()
      showError(err.message || '操作失败')
    }
  },

  onReactivateOrder(e) {
    const order = e.currentTarget.dataset.order
    this.reactivateOrder(order)
  },

  // 恢复「已完成 → 进行中」(CLAUDE.md §2.4)：强提示后调用 updateStatus，
  // 并把后端返回的「按月发薪仍锁定」提醒透传给老板。
  async reactivateOrder(order) {
    if (!order || !order._id) return

    const confirmed = await new Promise((resolve) => {
      wx.showModal({
        title: '恢复为进行中',
        content: `确定把订单"${order.order_name}"恢复为进行中吗？\n恢复后订单重新可编辑；本订单「按订单」已发薪的标记会被撤销、报工与工价解锁，需重新核对发放。`,
        confirmText: '恢复',
        cancelText: '取消',
        success: (r) => resolve(!!r.confirm),
        fail: (err) => { console.error('恢复确认弹窗失败', err); resolve(false) }
      })
    })
    if (!confirmed) return

    showLoading('恢复中...')
    try {
      const res = await callCloud('order', {
        action: 'updateStatus',
        order_id: order._id,
        status: 'active'
      })
      hideLoading()
      const data = (res && res.data) || {}
      if (data.month_locked_count > 0) {
        wx.showModal({
          title: '部分报工仍锁定',
          content: `订单已恢复为进行中。但有 ${data.month_locked_count} 笔报工因「按月发薪」整月口径仍被锁定（${data.month_locked_preview || ''}），如需修改请到工资页取消对应月份的发放。`,
          showCancel: false,
          confirmText: '知道了'
        })
      } else {
        showSuccess('已恢复为进行中')
      }
      await this.loadOrders()
    } catch (err) {
      hideLoading()
      showError(err.message || '恢复失败')
    }
  },

  async onChangeStatus(e) {
    const order = e.currentTarget.dataset.order
    if (!order || !order._id) return

    const itemList = ['进行中', '已完成', '已取消']
    wx.showActionSheet({
      itemList,
      success: async (res) => {
        const idx = res.tapIndex
        const map = ['active', 'completed', 'cancelled']
        const target = map[idx]
        if (!target || target === order.status) return

        // 已完成 → 进行中：走带强提示 + 发薪解锁的恢复流程
        if (order.status === 'completed' && target === 'active') {
          this.reactivateOrder(order)
          return
        }

        const statusTextMap = {
          active: '进行中',
          completed: '已完成',
          cancelled: '已取消'
        }
        const confirmed = await showConfirm(
          '确认修改状态',
          `确定将订单"${order.order_name}"改为“${statusTextMap[target]}”吗？`
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
          await this.loadOrders()
        } catch (err) {
          hideLoading()
          showError(err.message || '状态更新失败')
        }
      }
    })
  },

  async onDeleteOrder(e) {
    const order = e.currentTarget.dataset.order
    if (!order || !order._id) return

    const confirmed = await showConfirm(
      '确认删除订单',
      buildDeleteOrderConfirmContent(order.order_name, {
        processCount: order.process_count || 0
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
      await this.loadOrders()
    } catch (err) {
      hideLoading()
      showError(err.message || '删除订单失败')
    }
  }
})
