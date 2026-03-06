// pages/boss/employee-edit/employee-edit.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, isValidPhone, trim } = require('../../../utils/util')

Page({
  data: {
    isEdit: false,
    userId: '',
    name: '',
    phone: '',
    password: '',
    role: 'employee',
    roleIndex: 2,
    roles: ['boss', 'qc', 'employee'],
    roleNames: ['老板(管理员)', '质检员', '员工'],
    joinDate: '',
    loading: false
  },

  onLoad(options) {
    if (options.id) {
      this.setData({ isEdit: true, userId: options.id })
      wx.setNavigationBarTitle({ title: '编辑员工' })
      this.loadUser(options.id)
    } else {
      wx.setNavigationBarTitle({ title: '添加员工' })
    }
  },

  async loadUser(id) {
    showLoading('加载中...')
    try {
      const res = await callCloud('user', {
        action: 'get',
        user_id: id
      })
      hideLoading()
      if (res.data) {
        const roleIdx = this.data.roles.indexOf(res.data.role)
        this.setData({
          name: res.data.name,
          phone: res.data.phone,
          role: res.data.role,
          roleIndex: roleIdx >= 0 ? roleIdx : 2,
          joinDate: res.data.join_date || ''
        })
      }
    } catch (e) {
      hideLoading()
      showError('加载失败')
    }
  },

  onInputName(e) { this.setData({ name: e.detail.value }) },
  onInputPhone(e) { this.setData({ phone: e.detail.value }) },
  onInputPassword(e) { this.setData({ password: e.detail.value }) },
  onJoinDateChange(e) { this.setData({ joinDate: e.detail.value }) },
  onRoleChange(e) {
    const idx = Number(e.detail.value)
    this.setData({ roleIndex: idx, role: this.data.roles[idx] })
  },

  async onSave() {
    const name = trim(this.data.name)
    const phone = trim(this.data.phone)
    
    if (!name) { showError('请输入姓名'); return }
    if (!phone) { showError('请输入手机号'); return }
    if (!isValidPhone(phone)) { showError('手机号格式不正确'); return }

    this.setData({ loading: true })
    showLoading('保存中...')

    try {
      if (this.data.isEdit) {
        await callCloud('user', {
          action: 'update',
          user_id: this.data.userId,
          name, phone,
          role: this.data.role,
          password: this.data.password || undefined
        })
        // 单独更新入厂时间（走审计）
        if (this.data.joinDate) {
          await callCloud('user', {
            action: 'updateJoinDate',
            user_id: this.data.userId,
            join_date: this.data.joinDate
          })
        }
      } else {
        await callCloud('user', {
          action: 'create',
          name, phone,
          role: this.data.role,
          password: this.data.password || phone
        })
      }
      hideLoading()
      showSuccess(this.data.isEdit ? '修改成功' : '添加成功')
      setTimeout(() => wx.navigateBack(), 1500)
    } catch (err) {
      hideLoading()
      showError(err.message || '保存失败')
    } finally {
      this.setData({ loading: false })
    }
  }
})
