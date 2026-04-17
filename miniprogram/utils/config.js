// config.js - 全局配置
module.exports = {
  // 云环境ID（部署时替换）
  CLOUD_ENV: 'cloud1-5gr08st9c198f437',

  // 角色常量
  ROLES: {
    BOSS: 'boss',
    QC: 'qc',
    EMPLOYEE: 'employee'
  },

  // 角色中文名
  ROLE_NAMES: {
    boss: '老板(管理员)',
    qc: '质检员',
    employee: '员工'
  },

  // WorkLog 状态
  WORKLOG_STATUS: {
    PENDING_QC: 'pending_qc',
    INSPECTED: 'inspected'
  },

  // 考勤状态
  ATTENDANCE_STATUS: {
    NORMAL: 'normal',
    ABNORMAL: 'abnormal',
    SUPPLEMENTED: 'supplemented'
  },

  // 用户状态
  USER_STATUS: {
    ACTIVE: 'active',
    DISABLED: 'disabled'
  },

  // 订单状态
  ORDER_STATUS: {
    ACTIVE: 'active',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled'
  },

  // 默认工厂设置
  DEFAULT_SETTINGS: {
    factory_latitude: 39.9042,     // 默认纬度（北京）
    factory_longitude: 116.4074,   // 默认经度
    geofence_radius: 100,          // 地理围栏半径（米）
    quality_threshold: 95,         // 合格率阈值（%）
    export_email: '',
    qrcode_expire_days: 1            // 二维码有效期（天）
  },

  // 打卡来源
  CLOCK_SOURCE: {
    NORMAL: 'normal',
    SCAN: 'scan'
  }
}
