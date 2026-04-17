# 时间系统 & 定位打卡机制 审计与重构报告

## 一、审计概述

### 1.1 审计范围
- **时间系统**：全项目所有 `new Date()` / `Date.now()` / `getFullYear()` / `getMonth()` 等本地时区依赖代码
- **定位打卡**：`miniprogram/utils/location.js`、`cloudfunctions/attendance/geofence.js`、`cloudfunctions/attendance/index.js`、`miniprogram/pages/employee/home/home.js`

### 1.2 审计结论

| 问题域 | 严重性 | 发现数量 | 状态 |
|--------|--------|----------|------|
| 时区依赖 — 后端云函数 | **高** | 35+ 处 `new Date()` | ✅ 已修复 |
| 时区依赖 — 前端页面 | **中** | 11 处 `new Date()` | ✅ 已修复 |
| 定位打卡误判 | **高** | 二元判定无容错 | ✅ 已重建 |
| 缺少迁移方案 | **中** | 历史数据可能偏移 | ✅ 已提供 |

---

## 二、时间系统审计

### 2.1 根因分析

**核心问题**：全项目使用 `new Date()` 获取"当前日期"并以本地时区方法（`getFullYear()`, `getMonth()`, `getDate()`, `getHours()`）提取年月日。

**危害场景**：
1. 微信云函数运行在腾讯云服务器上，虽然通常是 UTC+8，但不能保证
2. 开发者在非中国时区运行 `node --test` 时，时间相关测试会产生不同结果
3. 如果未来迁移到其他云平台（UTC 时区），所有 `date: YYYY-MM-DD` 字段将偏差一天

**影响范围**：

| 文件 | 问题实例 | 业务影响 |
|------|----------|----------|
| `cloudfunctions/attendance/index.js` | `getDateStr()` 用 `new Date()` 生成 YYYY-MM-DD | 签到日期可能偏移一天 |
| `cloudfunctions/worklog/index.js` | `submitWorkLog` 用 `new Date()` 生成 dateStr | 报工记录日期错误 |
| `cloudfunctions/salary/index.js` | `getDashboard` 用 `new Date()` 算 todayStr/monthStart | 仪表盘数据范围错误 |
| `cloudfunctions/export/index.js` | `formatTs()` 用 `new Date(ts)` 的本地方法 | 导出 Excel 显示时间偏移 |
| `cloudfunctions/salary/period-statistics.js` | `resolvePeriodRange` 默认月份 | 工资统计周期错误 |
| `miniprogram/pages/boss/data-center/` | 数据中心默认月年 | 报表查询范围偏差 |
| `miniprogram/pages/boss/salary/` | 工资列表默认月份 | 查询错误月份 |
| `miniprogram/pages/boss/leaderboard/` | 排行榜默认月年 | 榜单周期偏差 |
| `miniprogram/pages/employee/profile/` | 个人页"当前月"显示 | 月份显示错误 |

### 2.2 修复方案

#### 架构设计
```
┌──────────────────────────────────────────────┐
│           beijing-time.js (统一模块)           │
│  • getNowBeijingDate()  — UTC+8 Date 对象     │
│  • getBeijingToday()    — "YYYY-MM-DD"        │
│  • getBeijingMonth()    — "YYYY-MM"           │
│  • formatBeijingDate/Time/DateTime()          │
│  • getBeijingMonthRange/YearRange/DayRange()  │
│  • isSameBeijingDay()   — 跨天比较             │
│  • getBeijingFields()   — {year,month,day,...} │
└──────────────────────────────────────────────┘
         ↑                         ↑
  miniprogram/utils/    cloudfunctions/common/
  beijing-time.js       beijing-time.js  (同一份代码)
```

**核心原理**：`Date.now() + 8h` 偏移后用 `getUTCXxx()` 方法读取北京时间字段，不依赖任何本地时区设置。

#### 修改清单

**新建文件**：
| 文件 | 说明 |
|------|------|
| `miniprogram/utils/beijing-time.js` | 统一北京时间工具模块（前端） |
| `cloudfunctions/common/beijing-time.js` | 统一北京时间工具模块（后端） |
| `cloudfunctions/init/migrate-timezone.js` | 历史数据时区迁移脚本 |

**修改文件**：
| 文件 | 改动点 |
|------|--------|
| `miniprogram/utils/util.js` | `formatDate/formatTime/formatDateTime/getToday/isSameDay/getMonthStart/getMonthEnd/calcHours` 全部改为调用 bjTime |
| `cloudfunctions/attendance/index.js` | `getDateStr/getPeriodRange/formatTimeStr/clockIn/clockOut/getMonthlyHours/updateMonthlyHours/getUserMonthlyRecords/checkAbnormalAttendances` |
| `cloudfunctions/worklog/index.js` | `formatWorkLogTime/getMonthRange/getYearRange/cancelOwnWorkLog/submitWorkLog/getTodayEarnings/getUserLogs/getMonthLogs/getManageLogs/getPeriodLogs/updateWorkLog` |
| `cloudfunctions/export/index.js` | `getMonthRange/getYearRange/formatTs` |
| `cloudfunctions/salary/index.js` | `getMonthRange/getCurrentMonth/getAllMonthlySalary/addAdjustment/getAdjustments/getDashboard/getAvailableMonths/markPaid/getPaidStatus` |
| `cloudfunctions/salary/period-statistics.js` | `resolvePeriodRange` 默认月份 |
| `miniprogram/pages/boss/data-center/data-center.logic.js` | `getInitialPeriodState` |
| `miniprogram/pages/boss/data-center/data-center.js` | 调用去掉 `new Date()` 参数 |
| `miniprogram/pages/boss/export/export.js` | `onLoad` 默认月年 |
| `miniprogram/pages/boss/salary/salary.js` | `onLoad` 默认月份 |
| `miniprogram/pages/boss/salary-detail/salary-detail.js` | `onLoad` 默认月份 |
| `miniprogram/pages/boss/leaderboard/leaderboard.js` | `onLoad/getYearList` |
| `miniprogram/pages/boss/orders/orders.js` | `enrichOrder` 时间线计算 |
| `miniprogram/pages/boss/order-detail/order-detail.js` | `buildOrderTimeline` |
| `miniprogram/pages/employee/profile/profile.js` | `onLoad` 当前月显示 |
| `miniprogram/pages/employee/home/home.js` | Wi-Fi BSSID 采集、新返回码处理 |

---

## 三、定位打卡系统审计

### 3.1 原系统分析

**现有机制**：
- 坐标系：GCJ-02 ✅（正确）
- 距离算法：Haversine ✅（正确）
- 多次采样：`sampleLocationAndPickBest` 取最优精度 ✅（良好）
- 实时定位更新：`startLocationUpdate` 热启动 GPS ✅（良好）

**核心缺陷**：

| 缺陷 | 影响 |
|------|------|
| **单点判定**：仅支持一个工厂坐标 | 大厂区不同入口/车间距离差异大 |
| **二元结果**：只有「通过/拒绝」| GPS 漂移时员工无法打卡，无回旋余地 |
| **不评估质量**：不对采样质量打分 | 精度 500m 和 10m 同等对待 |
| **无 Wi-Fi 辅助**：不使用 BSSID | 室内 GPS 漂移无备用信号 |
| **无诊断日志**：仅记录 distance | 出问题后无法排查 |

### 3.2 重建方案

#### 新架构：`geofence-enhanced.js`

```
                   ┌─────────────────────┐
                   │  comprehensiveCheckIn │  (入口)
                   └────────┬────────────┘
                            │
              ┌─────────────┼─────────────┐
              ▼             ▼             ▼
     evaluateLocation  evaluateGeofence  Wi-Fi BSSID
     Quality(samples)  MultiPoint(opts)  匹配检查
              │             │             │
              ▼             ▼             ▼
         ┌──────────── 分层判定 ────────────┐
         │                                 │
         │  1. WiFi+围栏 → approved (95%)  │
         │  2. WiFi信任  → approved (85%)  │
         │  3. 围栏内    → approved (80%)  │
         │  4. 质量差+近  → retry   (30%)  │
         │  5. 精度极差   → review  (10%)  │
         │  6. 确实超出   → rejected(80%) │
         └─────────────────────────────────┘
```

#### 关键改进

| 特性 | 旧方案 | 新方案 |
|------|--------|--------|
| 打卡点 | 单点 | 多点（支持大门/车间/仓库等） |
| 判定结果 | pass/fail | approved/rejected/retry/review |
| 定位质量 | 不评估 | 0-100 分（精度+一致性+有效率+采样数） |
| Wi-Fi 辅助 | 无 | 支持 BSSID 白名单匹配 |
| 容错 | 无 | 重试建议 + 人工复核 |
| 诊断日志 | distance 字段 | 40+ 字段完整日志 |
| 判定置信度 | 无 | 0-100% 置信度 |

#### 定位质量评分算法

| 维度 | 权重 | 优秀标准 |
|------|------|----------|
| GPS 精度 | 40分 | bestAccuracy ≤ 30m |
| 采样一致性 | 30分 | maxSpread ≤ 30m |
| 有效采样率 | 15分 | 100% |
| 采样数量 | 15分 | ≥ 5次 |

评级：≥80 excellent / ≥60 good / ≥40 fair / ≥20 poor / <20 unusable

#### 前端适配

`employee/home/home.js` 新增：
- Wi-Fi BSSID 采集：`wx.getConnectedWifi()` 获取并传给后端
- code=-2 (retry) 处理：弹窗引导重试
- code=-3 (review) 处理：告知等待管理员审核

#### factory_settings 扩展字段

新系统向后兼容，同时支持新配置：
```json
{
  "factory_latitude": 38.2688,        // 旧版兼容
  "factory_longitude": 114.1889,
  "geofence_radius": 200,
  "checkpoints": [                    // 新：多打卡点
    { "name": "大门", "latitude": 38.2688, "longitude": 114.1889, "radius": 200 },
    { "name": "车间B", "latitude": 38.2695, "longitude": 114.1900, "radius": 150 }
  ],
  "trusted_wifi_bssids": [            // 新：可信Wi-Fi
    "aa:bb:cc:dd:ee:ff"
  ]
}
```

---

## 四、数据迁移

### 4.1 迁移脚本

`cloudfunctions/init/migrate-timezone.js` 提供：
- **dry_run 模式**（默认）：只统计偏差记录，不修改
- **实际执行模式**：自动修正 `date` 字段，保留原值到 `_migrated_from_date`

**执行方法**：
```javascript
// 先 dry run 检查
wx.cloud.callFunction({ name: 'init', data: { action: 'migrate_timezone', dry_run: true } })

// 确认后执行
wx.cloud.callFunction({ name: 'init', data: { action: 'migrate_timezone', dry_run: false } })
```

### 4.2 影响评估

- **WorkLogs.date**：根据 `created_at` 时间戳用 UTC+8 重算
- **Attendances.date**：根据 `clock_in_time` 时间戳用 UTC+8 重算
- 原始日期保存到 `_migrated_from_date`，可回滚

---

## 五、测试结果

### 5.1 新增测试

| 测试文件 | 测试数 | 结果 |
|----------|--------|------|
| `tests/beijing-time.test.js` | 16 | ✅ 全部通过 |
| `tests/geofence-enhanced.test.js` | 15 | ✅ 全部通过 |

### 5.2 既有测试回归

| 测试文件 | 测试数 | 结果 |
|----------|--------|------|
| `tests/data-center.logic.test.js` | 6 | ✅ 全部通过（已适配） |
| 其余 11 个测试文件 | 57 | ✅ 全部通过 |
| **总计** | **78** | **✅ 全部通过** |

### 5.3 关键测试场景

- UTC 17:00 → 北京时间次日 01:00 跨天测试 ✅
- 12月 → 次年1月跨年范围 ✅
- 同一 UTC 日不同北京日的 `isSameBeijingDay` 判断 ✅
- 多打卡点最近匹配 ✅
- Wi-Fi BSSID 大小写不敏感匹配 ✅
- 低质量采样触发 retry ✅
- 远距离确定拒绝 ✅

---

## 六、部署注意事项

1. **部署顺序**：先部署 `cloudfunctions/common/beijing-time.js`（被多个云函数依赖），再部署各云函数
2. **factory_settings 配置**：如需多打卡点或 Wi-Fi BSSID 白名单，需在云数据库 `factory_settings` 的 `main` 文档中添加 `checkpoints` 和 `trusted_wifi_bssids` 字段
3. **迁移执行**：部署完成后建议先执行 `dry_run` 检查历史数据偏差量，确认无误后执行实际迁移
4. **旧文件保留**：`cloudfunctions/attendance/geofence.js` 保留未删除，作为参考和回退备份

---

## 七、变更文件清单

### 新建 (4个)
- `miniprogram/utils/beijing-time.js`
- `cloudfunctions/common/beijing-time.js`
- `cloudfunctions/attendance/geofence-enhanced.js`
- `cloudfunctions/init/migrate-timezone.js`
- `tests/beijing-time.test.js`
- `tests/geofence-enhanced.test.js`

### 修改 (17个)
- `miniprogram/utils/util.js`
- `cloudfunctions/attendance/index.js`
- `cloudfunctions/worklog/index.js`
- `cloudfunctions/export/index.js`
- `cloudfunctions/salary/index.js`
- `cloudfunctions/salary/period-statistics.js`
- `cloudfunctions/init/index.js`
- `miniprogram/pages/boss/data-center/data-center.logic.js`
- `miniprogram/pages/boss/data-center/data-center.js`
- `miniprogram/pages/boss/export/export.js`
- `miniprogram/pages/boss/salary/salary.js`
- `miniprogram/pages/boss/salary-detail/salary-detail.js`
- `miniprogram/pages/boss/leaderboard/leaderboard.js`
- `miniprogram/pages/boss/orders/orders.js`
- `miniprogram/pages/boss/order-detail/order-detail.js`
- `miniprogram/pages/employee/profile/profile.js`
- `miniprogram/pages/employee/home/home.js`
- `tests/data-center.logic.test.js`
