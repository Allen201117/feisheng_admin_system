// pages/boss/orders/orders.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, showConfirm, formatDate } = require('../../../utils/util')

Page({
  data: {
    orders: [],
    loading: false,
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
      const orders = (res.data || []).map(o => ({
        ...o,
        status_text: o.status === 'active' ? '进行中' : (o.status === 'completed' ? '已完成' : '已取消'),
        status_class: o.status === 'active' ? 'tag-success' : (o.status === 'completed' ? 'tag-info' : 'tag-danger')
      }))
      this.setData({ orders })
    } catch (e) {
      showError('加载订单失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  toggleAddForm() {
    this.setData({ showAddForm: !this.data.showAddForm })
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
      this.loadOrders()
    } catch (err) {
      hideLoading()
      showError(err.message || '创建失败')
    }
  },

  goOrderDetail(e) {
    const id = e.currentTarget.dataset.id
    wx.navigateTo({ url: `/pages/boss/order-detail/order-detail?id=${id}` })
  },

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
      this.loadOrders()
    } catch (err) {
      hideLoading()
      showError(err.message || '操作失败')
    }
  }
})
