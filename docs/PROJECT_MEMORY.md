# 项目记忆

## 项目一句话定位

这是一个面向服装厂/加工厂的内部管理微信小程序，围绕员工、考勤、订单、工序报工、质检、工资核算、数据统计与报表导出，长期目标是形成“订单 -> 报工 -> 质检 -> 工资 -> 统计 -> 导出”的业务闭环。

## 技术栈

- 前端：微信小程序原生开发，WXML / WXSS / JavaScript。
- 后端：微信云开发 CloudBase 云函数，Node.js，`wx-server-sdk ~2.6.3`。
- 数据库：CloudBase 云数据库集合。
- 导出：`xlsx ^0.18.5`，用于生成 Excel 报表。
- 二维码：`qrcode ^1.5.3`，用于生成打卡二维码。
- 时间工具：前端与部分云函数均有 `beijing-time.js`，目标口径为北京时间 UTC+8。
- 测试：`tests/` 下已有定位、北京时间、登录、设置、订单、报工价格、工资周期等逻辑测试。

## 目录结构

```text
miniprogram/
  app.js / app.json / app.wxss      小程序入口、页面路由、全局样式
  pages/
    login/                          登录
    employee/                       员工端
    qc/                             质检端
    boss/                           老板/管理员端
    privacy-policy/                 隐私政策
    user-agreement/                 用户协议
  utils/                            登录态、云函数封装、北京时间、定位、隐私等工具

cloudfunctions/
  login/                            登录、会话、改密、隐私授权
  user/                             员工/用户管理
  attendance/                       考勤、定位、补卡、异常记录
  order/                            订单与工序管理
  worklog/                          报工与质检
  salary/                           工资、奖惩、发薪
  leaderboard/                      排行榜
  settings/                         工厂设置
  qrcode/                           打卡二维码
  export/                           报表预览与 Excel 导出
  init/                             数据库初始化与迁移
  common/                           通用工具

tests/                              业务逻辑测试
docs/                               项目文档、验收报告、审计报告
```

## 用户角色与权限

- `boss`：管理员/老板。可管理员工、订单、工序、考勤、报工、工资、设置、二维码、导出、统计与排行榜。
- `qc`：质检员。可进入质检端查看待检/已检报工并提交合格数量；也会被工资模块作为可计薪人员纳入统计。
- `employee`：普通员工。可考勤打卡、查看个人首页、提交/查看/当日撤销或修改自己的报工、查看个人工资与排行榜。

注意：部分云函数读接口仍需继续核查权限边界，尤其是订单、工序、工价相关读接口。

## 已实现功能模块

- 登录与会话：手机号/密码登录、token 校验、强制改密、隐私授权记录。
- 员工管理：员工创建、编辑、启停、重置密码、入厂日期维护。
- 考勤：定位签到/签退、二维码打卡、地理围栏、多点位兼容、异常记录、补卡、月工时。
- 订单与工序：订单创建/编辑/状态变更/复制/删除，工序添加/编辑/改价/分配员工，订单工价隐藏，价格变更审计。
- 报工：员工按分配工序报工，快照单价，订单总量防超，员工当日撤销/修改，老板报工管理。
- 质检：待检/已检列表，记录合格数量、质检人、质检时间。
- 工资：计件工资、奖惩、员工端脱敏、老板端工资明细、发薪标记、已发薪奖惩冲正。
- 数据中心：老板端 KPI 与订单/统计视图。
- 排行榜：按月、按年、按订单等维度统计排行，受公开设置控制。
- 导出：按月/按年/按订单，汇总/明细报表预览与 Excel 文件导出。
- 设置：工厂坐标、围栏半径、质检阈值、二维码有效期、排行榜可见、SMTP、审核模式等。

## 页面/路由清单

- `pages/login/login`：登录页。
- `pages/privacy-policy/privacy-policy`：隐私政策。
- `pages/user-agreement/user-agreement`：用户协议。
- `pages/employee/home/home`：员工首页，考勤入口、报工入口、工资/排行榜入口。
- `pages/employee/worklog/worklog`：员工报工。
- `pages/employee/profile/profile`：员工个人资料、工资与记录、改密。
- `pages/employee/leaderboard/leaderboard`：员工排行榜。
- `pages/qc/home/home`：质检首页，待检/已检列表。
- `pages/qc/inspect/inspect`：质检详情与提交。
- `pages/boss/home/home`：老板工作台。
- `pages/boss/employees/employees`：员工列表。
- `pages/boss/employee-edit/employee-edit`：员工新增/编辑。
- `pages/boss/orders/orders`：订单列表。
- `pages/boss/order-detail/order-detail`：订单详情、工序、分配、价格、导出。
- `pages/boss/attendance/attendance`：考勤管理。
- `pages/boss/salary/salary`：工资汇总。
- `pages/boss/salary-detail/salary-detail`：员工工资详情、奖惩、报工修改。
- `pages/boss/leaderboard/leaderboard`：老板端排行榜。
- `pages/boss/settings/settings`：系统/工厂设置。
- `pages/boss/qrcode/qrcode`：打卡二维码管理。
- `pages/boss/export/export`：报表导出。
- `pages/boss/data-center/data-center`：数据中心。
- `pages/boss/worklog-manage/worklog-manage`：报工管理。

## 云函数/API 清单

- `login`：`login`、`changePassword`、`verifyToken`、`getConsentStatus`、`recordConsent`。
- `user`：`list`、`listEmployees`、`get`、`create`、`update`、`updateStatus`、`resetPassword`、`updateJoinDate`。
- `attendance`：`clockIn`、`clockOut`、`getTodayRecord`、`getMonthlyHours`、`getDailyRecords`、`getPeriodRecords`、`getAbnormalRecords`、`supplement`、`getUserMonthlyRecords`、`checkAbnormal`。
- `order`：`list`、`getDetail`、`create`、`updateOrder`、`copyOrder`、`updateStatus`、`deleteOrder`、`addProcess`、`updateProcessPrice`、`updateProcess`、`deleteProcess`、`assignProcess`、`getAssignedProcesses`、`togglePriceHidden`、`clearOrderPrices`、`getPriceChangeLogs`。
- `worklog`：`submit`、`getProcessQuota`、`getTodayEarnings`、`getUserLogs`、`getMonthLogs`、`getPeriodLogs`、`getManageLogs`、`getOrderProgress`、`getPendingLogs`、`getInspectedLogs`、`getLogDetail`、`inspect`、`updateWorkLog`、`deleteWorkLog`、`cancelOwnWorkLog`。
- `salary`：`getUserMonthlySalary`、`getUserMonthlySalaryByBoss`、`getAllMonthlySalary`、`getAllPeriodSalary`、`addAdjustment`、`updateAdjustment`、`deleteAdjustment`、`getAdjustments`、`getDashboard`、`markPaid`、`getPaidStatus`、`getAvailableMonths`。
- `leaderboard`：`getMonthlyRank`、`getOrderRank`、`getYearlyRank`。
- `settings`：`getAll`、`getPublic`、`save`。
- `qrcode`：`generate`、`getLatest`、`verify`、`revoke`。
- `export`：`salary`、`worklog`、`getTableData`、`getTableDataV2`、`exportToFile`、`exportToFileV2`、`getHistory`、`getOrderList`、`exportProcessSummary`。
- `init`：默认初始化、`migrate_v2`、`migrate_location`、`migrate_timezone`。

## 数据库集合与核心字段

- `Users`：`name`、`phone`、`role`、`password_hash`、`salt`、`status`、`openid`、`session_token`、`monthly_hours`、`join_date`、`created_at`、`updated_at`。
- `Orders`：`order_name`、`start_date`、`end_date`、`total_quantity`、`status`、`price_hidden`、`created_at`、`updated_at`。
- `Processes`：`order_id`、`process_name`、`current_price`、`note`、`assigned_user_ids`、`status`、`created_at`、`updated_at`。
- `WorkLogs`：`user_id`、`user_name`、`order_id`、`order_name`、`process_id`、`process_name`、`quantity`、`snapshot_price`、`amount`、`date`、`status`、`qc_status`、`passed_qty`、`inspected_by`、`inspected_by_name`、`inspected_at`、`note`、`created_at`、`updated_at`。
- `Attendances`：`user_id`、`user_name`、`date`、`clock_in_time`、`clock_out_time`、`clock_in_location`、`clock_out_location`、`status`、`source`、`qr_id`、`distance_meters`、`hours`、`quality_score`、`quality_level`、`created_at`。
- `SalaryAdjustments`：`user_id`、`user_name`、`type`、`amount`、`reason`、`month`、`order_id`、`operator_id`、`operator_name`、`is_reversal`、`is_correction`、`original_id`、`created_at`、`updated_at`。
- `SalaryPayments`：`user_id`、`user_name`、`month`、`paid`、`paid_at`、`operator_id`、`operator_name`、`created_at`。
- `factory_settings`：`factory_latitude`、`factory_longitude`、`geofence_radius`、`checkpoints`、`quality_threshold`、`qrcode_expire_days`、`leaderboard_visible`、`face_recognition_enabled`、`allow_home_checkin`、`smtp_*`、`updated_at`。
- `audit_logs`：`action`、`operator_id`、`operator_name`、`target_id`、`details`、`old_values`、`new_values`、`changes`、`created_at`。
- `qr_codes`：打卡二维码 token、状态、有效期、创建时间等。
- `export_history`：导出类型、月份/维度、文件 ID、文件名、操作者、状态、创建时间。
- `privacy_consents`：用户隐私授权记录。
- `sign_location_logs`：签到/签退定位诊断、坐标、精度、距离、判定状态、失败原因、设备信息。

## 核心业务链路

- 考勤 -> 工资：员工签到/签退写入 `Attendances`，签退后计算 `hours`，工资汇总读取出勤天数和总工时。
- 订单 -> 工序 -> 报工：老板创建订单和工序，分配员工，员工只能对可用工序报工；报工写入 `WorkLogs`，包含 `snapshot_price`。
- 报工 -> 质检 -> 工资：报工初始为待检，QC 写入 `passed_qty` 和质检状态。当前工资计算主要按 `quantity * snapshot_price`，`passed_qty` 目前用于质量统计，不直接影响工资。
- 工资 -> 发薪锁定：`SalaryPayments.paid = true` 后，部分报工修改被锁定；奖惩修改/删除对已发薪月份走冲正记录。
- 统计 -> 导出：`salary`、`worklog`、`export` 等云函数按日期、月份、年份、订单维度聚合数据，并生成 Excel 报表。

## 当前 P0/P1/P2 风险清单

### P0

- 部分订单/工序读接口权限边界可能不足，存在订单、工价、分配信息泄漏风险。
- `deleteOrder` 会删除订单关联的工序、报工、奖惩，需要确认已发薪或已统计数据是否允许删除。
- 业务目标包含“报工 -> 质检 -> 工资”，但当前工资计算主要按报工数量 `quantity`，不是合格数量 `passed_qty`，工资口径必须由业务确认。

### P1

- 工资/统计/导出口径存在多处实现：`salary/index.js`、`salary/period-statistics.js`、`export/index.js` 等，长期有统计口径漂移风险。
- 多处 `catch` 为空或吞错，可能影响排障、审计和数据一致性。
- 部分列表/详情接口存在循环查询，数据量上来后可能有性能问题。
- 时间工具已建立，但仍需持续审计 `db.serverDate()`、`toISOString()`、业务日期字符串之间的边界。
- 员工端价格隐藏、已发薪脱敏、导出数据之间需要持续校验一致性。

### P2

- README 中文部分疑似编码异常。
- `docs` 历史验收文档较多，但此前缺少统一项目记忆与架构入口。
- 字段命名存在兼容痕迹，如 `status/qc_status`、`total_quantity/order_total_quantity`。
- 部分模块代码较长，后续维护需要避免继续在页面层堆复杂业务计算。

## 后续开发注意事项

- 每次开发前先读本文件和 `docs/ARCHITECTURE.md`。
- 工资、权限、时间、统计、导出、数据库字段属于高风险区，修改前必须先输出 Plan 并确认口径。
- 不确定字段或业务规则时，不要猜；先标注“不确定”并向业务确认。
- 不复制第二套工资、考勤、统计逻辑。
- 不在页面层堆复杂业务计算；优先复用云函数或已有业务逻辑模块。
- 新增字段必须说明用途、来源、兼容旧数据方式，并同步更新文档。
- 每个小功能建议单独 Git 小步提交。
