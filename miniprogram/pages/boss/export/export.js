// pages/boss/export/export.js
const { callCloud, showError, showSuccess, showLoading, hideLoading, showConfirm } = require('../../../utils/util')

Page({
  data: {
    exportType: 'salary',
    exportTypes: [
      { value: 'salary', label: '薪酬报表' },
      { value: 'attendance', label: '考勤报表' },
      { value: 'worklog', label: '报工记录' },
      { value: 'order_cost', label: '订单成本' }
    ],
    selectedTypeLabel: '薪酬报表',
    month: '',
    loading: false,
    exporting: false,
    // 表格数据
    tableTitle: '',
    tableHeaders: [],
    tableRows: [],
    tableLoaded: false,
    // 编辑状态
    editingRow: -1,
    editingCol: -1
  },

  onLoad() {
    const now = new Date()
    this.setData({
      month: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`
    })
  },

  onTypeChange(e) {
    const idx = e.detail.value
    this.setData({
      exportType: this.data.exportTypes[idx].value,
      selectedTypeLabel: this.data.exportTypes[idx].label
    })
  },

  onMonthChange(e) {
    this.setData({ month: e.detail.value })
  },

  // 加载报表数据（在线预览）
  async onLoadTable() {
    this.setData({ loading: true, tableLoaded: false })
    showLoading('加载报表数据...')

    try {
      const res = await callCloud('export', {
        action: 'getTableData',
        export_type: this.data.exportType,
        month: this.data.month
      })

      hideLoading()
      const data = res.data || {}
      this.setData({
        tableTitle: data.title || '',
        tableHeaders: data.headers || [],
        tableRows: data.rows || [],
        tableLoaded: true
      })

      if ((data.rows || []).length === 0) {
        showError('该月份无数据')
      }
    } catch (err) {
      hideLoading()
      showError(err.message || '加载失败')
    } finally {
      this.setData({ loading: false })
    }
  },

  // 点击单元格进入编辑模式
  onCellTap(e) {
    const { row, col } = e.currentTarget.dataset
    this.setData({ editingRow: row, editingCol: col })
  },

  // 单元格编辑完成
  onCellInput(e) {
    const { row, col } = e.currentTarget.dataset
    const value = e.detail.value
    const key = `tableRows[${row}][${col}]`
    this.setData({ [key]: value })
  },

  onCellBlur() {
    this.setData({ editingRow: -1, editingCol: -1 })
  },

  // 导出Excel并下载
  async onExport() {
    const typeLabel = this.data.exportTypes.find(t => t.value === this.data.exportType).label
    const confirmed = await showConfirm(
      '确认导出',
      `将导出 ${this.data.month} 的${typeLabel}为Excel文件，确定吗？`
    )
    if (!confirmed) return

    this.setData({ exporting: true })
    showLoading('正在生成Excel...')

    try {
      const res = await callCloud('export', {
        action: 'exportToFile',
        export_type: this.data.exportType,
        month: this.data.month
      })

      hideLoading()

      if (res.data && res.data.file_id) {
        showLoading('正在下载...')

        // 从云存储下载
        const downloadRes = await wx.cloud.downloadFile({
          fileID: res.data.file_id
        })

        hideLoading()

        if (downloadRes.tempFilePath) {
          // 用系统打开Excel文件（showMenu允许用户转发/保存到手机）
          wx.openDocument({
            filePath: downloadRes.tempFilePath,
            fileType: 'xlsx',
            showMenu: true,
            success: () => {
              showSuccess('导出成功')
            },
            fail: (err) => {
              console.error('打开文件失败', err)
              showSuccess('文件已下载')
            }
          })
        }
      }
    } catch (err) {
      hideLoading()
      showError(err.message || '导出失败')
    } finally {
      this.setData({ exporting: false })
    }
  }
})