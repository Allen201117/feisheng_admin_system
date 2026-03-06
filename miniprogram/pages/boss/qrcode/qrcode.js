// pages/boss/qrcode/qrcode.js
const { callCloud, showError, showSuccess, showLoading, hideLoading } = require('../../../utils/util')

Page({
  data: {
    qrcodeUrl: '',
    fileId: '',
    qrType: 'image',
    qrId: '',
    scene: '',
    debugPath: '',
    generating: false,
    expireTime: '',
    lastGenerated: ''
  },

  onShow() {
    // 尝试加载已有的二维码
    this.loadExistingQrcode()
  },

  async loadExistingQrcode() {
    try {
      const res = await callCloud('qrcode', {
        action: 'getLatest'
      })
      if (res.data && !res.data.is_expired) {
        this.setData({
          qrcodeUrl: res.data.temp_url || res.data.file_id || '',
          fileId: res.data.file_id || '',
          qrType: res.data.qr_type || 'image',
          qrId: res.data.qr_id || res.data.token || '',
          scene: res.data.scene || '',
          debugPath: res.data.debug_path || '',
          expireTime: res.data.expire_at || '',
          lastGenerated: ''
        })
      }
    } catch (e) {
      console.error('加载二维码失败', e)
    }
  },

  async onGenerate() {
    this.setData({ generating: true })
    showLoading('正在生成考勤二维码...')

    try {
      const res = await callCloud('qrcode', {
        action: 'generate'
      })
      hideLoading()
      
      if (res.data) {
        this.setData({
          qrcodeUrl: res.data.temp_url || '',
          fileId: res.data.file_id || '',
          qrType: res.data.qr_type || 'image',
          qrId: res.data.qr_id || res.data.token || '',
          scene: res.data.scene || '',
          debugPath: res.data.debug_path || '',
          expireTime: res.data.expire_at || '',
          lastGenerated: ''
        })
        if (res.data.qr_type === 'text') {
          wx.showModal({
            title: '已生成扫码标记',
            content: '当前环境无小程序码权限。已生成可校验的打卡标记，请复制场景码或联调路径继续测试。体验版/正式版可直接生成图片码。',
            showCancel: false
          })
        } else if (res.data.qr_type === 'scheme') {
          wx.showModal({
            title: '二维码已生成',
            content: '当前为 URL Scheme 模式，员工可直接使用微信扫一扫跳转小程序并自动触发扫码打卡。',
            showCancel: false
          })
        } else if (res.data.qr_type === 'fallback') {
          wx.showModal({
            title: '体验版二维码已生成',
            content: '小程序尚未发布正式版，员工需在小程序内点“扫码打卡”按钮扫此码。正式版发布后，微信扫一扫即可直接进入小程序打卡。',
            showCancel: false
          })
        } else {
          showSuccess('二维码已生成')
        }
      }
    } catch (err) {
      hideLoading()
      showError(err.message || '生成失败')
    } finally {
      this.setData({ generating: false })
    }
  },

  async onSaveImage() {
    if (this.data.qrType === 'text') {
      showError('当前是文本标记模式，暂无图片可保存')
      return
    }

    if (!this.data.fileId && !this.data.qrcodeUrl) {
      showError('请先生成二维码')
      return
    }

    try {
      let tempFilePath
      if (this.data.fileId) {
        const downloadRes = await new Promise((resolve, reject) => {
          wx.cloud.downloadFile({
            fileID: this.data.fileId,
            success: resolve,
            fail: reject
          })
        })
        tempFilePath = downloadRes.tempFilePath
      } else {
        const downloadRes = await new Promise((resolve, reject) => {
          wx.downloadFile({
            url: this.data.qrcodeUrl,
            success: resolve,
            fail: reject
          })
        })
        tempFilePath = downloadRes.tempFilePath
      }

      // 保存到相册
      await new Promise((resolve, reject) => {
        wx.saveImageToPhotosAlbum({
          filePath: tempFilePath,
          success: resolve,
          fail: reject
        })
      })

      showSuccess('已保存到相册')
    } catch (e) {
      if (e.errMsg && e.errMsg.includes('auth deny')) {
        showError('请授权保存图片到相册')
      } else {
        showError('保存失败')
      }
    }
  },

  onPreview() {
    if (!this.data.qrcodeUrl) return
    wx.previewImage({
      urls: [this.data.qrcodeUrl],
      current: this.data.qrcodeUrl
    })
  },

  onCopyScene() {
    if (!this.data.scene) {
      showError('暂无可复制的场景码')
      return
    }
    wx.setClipboardData({
      data: this.data.scene,
      success: () => showSuccess('场景码已复制')
    })
  },

  onCopyDebugPath() {
    if (!this.data.debugPath) {
      showError('暂无联调路径')
      return
    }
    wx.setClipboardData({
      data: this.data.debugPath,
      success: () => showSuccess('联调路径已复制')
    })
  },

  async onRevoke() {
    if (!this.data.qrId) {
      showError('暂无可作废二维码')
      return
    }

    try {
      const confirm = await new Promise((resolve) => {
        wx.showModal({
          title: '作废二维码',
          content: '作废后员工扫码将无法打卡，是否继续？',
          success: (res) => resolve(!!res.confirm)
        })
      })
      if (!confirm) return

      showLoading('正在作废...')
      await callCloud('qrcode', {
        action: 'revoke',
        qr_id: this.data.qrId
      })
      hideLoading()
      this.setData({
        qrcodeUrl: '',
        fileId: '',
        qrType: 'text',
        expireTime: '',
        qrId: this.data.qrId
      })
      showSuccess('二维码已作废')
    } catch (e) {
      hideLoading()
      showError(e.message || '作废失败')
    }
  }
})