# 架构说明

## 整体架构

```text
微信小程序前端
  -> utils/callCloud 注入 auth_user_id / auth_session_token
  -> 微信云函数
  -> CloudBase 云数据库集合
  -> 统计聚合 / Excel 导出 / 临时文件 URL
  -> 订阅状态 / 人工开通 / 到期写操作限制
```

- 前端页面负责交互、展示、表单校验和调用云函数。
- `miniprogram/utils/util.js` 的 `callCloud` 会读取本地登录态，并向云函数 payload 注入 `auth_user_id` 与 `auth_session_token`。
- 登录页会本地记住上次工厂码、姓名、手机号和会话 token，不保存密码；隐私协议版本变化时保留 token，但要求用户重新手动确认协议后再恢复登录态。
- 云函数负责核心业务校验、权限检查、数据读写、审计日志、统计聚合和导出。
- 云数据库保存业务主数据、流水数据、配置、日志和导出历史。
- `export` 云函数使用 `xlsx` 生成 Excel，上传到云存储后返回临时下载链接。

## 前端、业务逻辑、数据访问关系

- 页面层：`miniprogram/pages/**`，负责 UI 状态、用户操作、导航与调用云函数。
- 工具层：`miniprogram/utils/**`，负责登录态、隐私授权、位置采集、北京时间格式化、云函数调用封装。
- 云函数层：`cloudfunctions/**/index.js`，负责业务操作入口和数据库访问。
- 业务辅助模块：如 `worklog/beijing-time.js`、`salary/period-statistics.js`、`order/reprice-worklogs.js`、`attendance/geofence-enhanced.js`。
- 数据层：CloudBase 集合，主要通过云函数访问。

## 核心数据流

### 考勤 -> 工资

1. 员工在 `pages/employee/home/home` 发起签到/签退。
2. 前端采集定位、精度、二维码来源等信息，调用 `attendance.clockIn` 或 `attendance.clockOut`。
3. `attendance` 云函数读取 `factory_settings`，执行地理围栏/多点位/二维码校验。
4. 成功签到/签退写入或更新 `Attendances`。
5. 签退时计算 `hours`，并更新 `Users.monthly_hours`。
6. `salary` 云函数按日期范围读取 `Attendances`，统计出勤天数和总工时。

### 报工 -> 质检 -> 工资

1. 老板在订单详情中创建工序并分配员工，写入 `Processes.assigned_user_ids`。
2. 订单详情页对工序列表和分配面板做分批渲染；批量分配通过 `order.batchAssignProcesses` 一次提交，降低 150-200 道工序订单的页面节点压力和云函数调用次数。
3. 员工在 `pages/employee/worklog/worklog` 获取已分配工序，选择订单/工序并提交数量。
4. `worklog.submit` 校验登录态、本人或老板代报、工序归属、订单状态、工价、订单总量额度。
5. 报工写入 `WorkLogs`，保存 `quantity`、`snapshot_price`、`amount`、`date`、`status=pending`、`passed_qty=0`。
6. 老板可在 `pages/boss/worklog-manage/worklog-manage` 从订单工序进度进入单道工序明细，调用 `worklog.submit` 代员工新增报工，或调用 `worklog.updateWorkLog` 修改数量/备注帮助员工修正；新增和修改都写回同一套 `WorkLogs` 数据源，修改会写审计。
7. QC 在 `pages/qc/home/home` 与 `pages/qc/inspect/inspect` 获取待检记录并提交 `passed_qty`。
8. `worklog.inspect` 更新 `WorkLogs.passed_qty`、`status=inspected`、`qc_status=inspected`、质检人和质检时间。
9. 当前工资计算主要使用 `quantity * snapshot_price`，`passed_qty` 暂未直接影响工资金额。该口径是高风险业务点，改动前必须确认。

### 订单 -> 工序 -> 报工 -> 统计

1. `order.create` 创建 `Orders`，包含订单名、起止日期、总量、状态。
2. `order.addProcess` 创建 `Processes`，包含工序名、当前单价、备注、分配员工。
3. `order.getAssignedProcesses` 给员工端返回可报工工序，并根据订单状态和工价隐藏策略处理展示。
4. `worklog.submit` 写入 `WorkLogs`，并按订单总量做防超校验。
5. `worklog.getOrderProgress`、`salary.getDashboard`、`export.getTableDataV2` 等按订单、工序、日期聚合统计。

### 工资 -> 发薪锁定

1. 老板在 `pages/boss/salary/salary` 查看工资汇总。
2. `salary.markPaid` 写入或更新 `SalaryPayments`，用确定性 ID `${user_id}_${month}` 降低重复创建风险。
3. `WorkLogs` 修改/撤销会检查对应月份是否已发薪。
4. 已发薪月份的奖惩修改/删除不直接改原记录，而是写入冲正记录。
5. 员工端查看已发薪月份工资时，后端会脱敏明细、工件数和工价等字段。

### 统计 -> 导出

1. 老板在 `pages/boss/export/export` 或相关页面选择月份、年份、订单和报表类型。
2. 前端调用 `export.getTableDataV2` 预览数据，或调用 `export.exportToFileV2` 导出。
3. `export` 云函数读取 `Users`、`WorkLogs`、`Attendances`、`SalaryAdjustments`、`Orders` 等集合。
4. 云函数生成汇总/明细数据，使用 `xlsx` 构建 Excel。
5. 文件上传到云存储，导出记录写入 `export_history`。

### 订阅 -> 人工开通 -> 到期限制

1. 平台管理员在 `pages/platform/home/home` 选择工厂。
2. 前端调用 `billing.listPlans` 获取套餐，调用 `billing.openSubscription` 手动开通或延期。
3. `billing` 云函数写入 `Subscriptions` 和 `BillingOrders`，同时更新 `Organizations` 上的订阅快照字段。
4. 老板在 `pages/boss/subscription/subscription` 调用 `billing.getMySubscription` 查看服务状态，并复制开通信息发给平台管理员。
5. 到期且超过宽限期后，`order/user/worklog/qrcode` 中的新增类写操作会读取 `Organizations` 订阅快照并拦截；历史查看和导出暂不拦。

## 数据模型说明

### Organizations

工厂/租户主数据，也是订阅快照承载处。

- 核心字段：`org_name`、`factory_code`、`contact_name`、`contact_phone`、`status`、`billing_status`、`plan_id`、`subscription_id`、`trial_end`、`current_period_start`、`current_period_end`、`grace_until`、`billing_owner_user_id`、`billing_updated_at`。
- 主要写入：`init`、`platform`、`billing`。
- 主要读取：`login`、核心业务云函数、`platform`、`billing`。
- 兼容规则：`billing_status` 缺失或为 `not_enabled` 时不拦截写操作，避免未执行订阅迁移前误停工厂；`permanent` 表示永久免费，当前用于飞盛 `A001/org_home`。

### Plans

套餐配置表，由平台统一维护。

- 核心字段：`plan_id`、`plan_name`、`status`、`price_cents`、`billing_period`、`period_months`、`trial_days`、`employee_limit`、`order_limit_per_month`、`features`、`created_at`、`updated_at`。
- 主要写入：`init.migrate_billing_v1`、`billing.listPlans` 的默认套餐种子逻辑。
- 主要读取：`billing`、平台管理页。
- 当前试行套餐：`trial` 为 7 天试用、最多 10 名员工；`standard_year` 为标准版年付，开放全部功能；基础版/专业版种子会被置为 `disabled`。

### Subscriptions

工厂订阅周期记录。

- 核心字段：`org_id`、`plan_id`、`plan_name`、`status`、`start_at`、`end_at`、`grace_until`、`source`、`opened_by`、`opened_by_name`、`remark`、`created_at`、`updated_at`。
- 主要写入：`init.migrate_billing_v1`、`billing.openSubscription`。
- 主要读取：后续订阅审计和开通历史；当前运行态主要读 `Organizations` 快照。

### BillingOrders

人工收款和未来线上支付订单记录。

- 核心字段：`org_id`、`subscription_id`、`plan_id`、`plan_name`、`amount_cents`、`payment_channel`、`payment_status`、`paid_at`、`verified_by`、`verified_by_name`、`external_trade_no`、`remark`、`created_at`、`updated_at`。
- 主要写入：`billing.openSubscription`、`billing.markManualPaymentPaid`。
- 主要读取：平台管理页展示最近开通记录。

### UsageMonthly

月度用量统计预留集合。

- 核心字段：`org_id`、`month`、`active_users`、`orders_created`、`worklogs_count`、`attendances_count`、`export_count`、`updated_at`。
- 当前状态：集合由迁移创建，统计回填留到后续阶段。

### Users

用户与员工主数据。

- 核心字段：`name`、`phone`、`role`、`status`、`openid`、`session_token`、`password_hash`、`salt`、`monthly_hours`、`join_date`、`created_at`、`updated_at`。
- 主要写入：`login`、`user`、`attendance`、`init`。
- 主要读取：几乎所有业务云函数。

### Orders

订单主数据。

- 核心字段：`order_name`、`start_date`、`end_date`、`total_quantity`、`status`、`price_hidden`、`created_at`、`updated_at`。
- 主要写入：`order`。
- 主要读取：`order`、`worklog`、`salary`、`leaderboard`、`export`。

### Processes

订单下的工序与工价、分配关系。

- 核心字段：`order_id`、`process_name`、`current_price`、`note`、`assigned_user_ids`、`status`、`created_at`、`updated_at`。
- 主要写入：`order`。
- 主要读取：`order`、`worklog`。
- 性能规则：订单详情页和分配面板不得一次性渲染全部大工序卡片；单订单 150-200 道工序场景应使用分批显示和批量保存。

### WorkLogs

员工报工流水，也是计件工资和质检的关键数据。

- 核心字段：`user_id`、`user_name`、`order_id`、`order_name`、`process_id`、`process_name`、`quantity`、`snapshot_price`、`amount`、`date`、`status`、`qc_status`、`passed_qty`、`inspected_by`、`inspected_by_name`、`inspected_at`、`note`、`created_at`、`updated_at`。
- 主要写入：`worklog`；部分工价同步由 `order` 更新历史零价报工。
- 主要读取：`worklog`、`salary`、`leaderboard`、`export`、`order`。
- 高风险口径：工资目前按 `quantity * snapshot_price` 计算，而不是按 `passed_qty`。

### Attendances

考勤流水。

- 核心字段：`user_id`、`user_name`、`date`、`clock_in_time`、`clock_out_time`、`clock_in_location`、`clock_out_location`、`status`、`source`、`qr_id`、`distance_meters`、`hours`、`quality_score`、`quality_level`、`created_at`。
- 主要写入：`attendance`。
- 主要读取：`attendance`、`salary`、`leaderboard`、`export`。

### SalaryAdjustments

工资奖惩与冲正记录。

- 核心字段：`user_id`、`user_name`、`type`、`amount`、`reason`、`month`、`order_id`、`operator_id`、`operator_name`、`is_reversal`、`is_correction`、`original_id`、`created_at`、`updated_at`。
- 主要写入：`salary`；删除订单时 `order.deleteOrder` 可能删除关联奖惩。
- 主要读取：`salary`、`export`。

### SalaryPayments

发薪标记与锁定依据。

- 核心字段：`user_id`、`user_name`、`month`、`paid`、`paid_at`、`operator_id`、`operator_name`、`created_at`。
- 主要写入：`salary.markPaid`。
- 主要读取：`salary`、`worklog`、`order`。

### factory_settings

工厂级配置，固定文档通常为 `main`。

- 核心字段：`factory_latitude`、`factory_longitude`、`geofence_radius`、`checkpoints`、`coordinate_system`、`location_source`、`location_confirmed`、`quality_threshold`、`qrcode_expire_days`、`leaderboard_visible`、`face_recognition_enabled`、`allow_home_checkin`、`smtp_host`、`smtp_port`、`smtp_user`、`smtp_pass`、`updated_at`。
- 主要写入：`settings`、`init`、迁移脚本。
- 主要读取：`attendance`、`settings`、`leaderboard`、`qrcode`。

### audit_logs

审计日志。

- 核心字段：`action`、`operator_id`、`operator_name`、`target_id`、`target_user_id`、`details`、`old_values`、`new_values`、`changes`、`reason`、`created_at`。
- 主要写入：`login`、`user`、`attendance`、`order`、`worklog`、`salary`、`settings`、`init`、`qrcode`。
- 用途：权限、工资、工价、报工、设置等关键操作留痕。

### qr_codes

打卡二维码。

- 核心字段：`token`、`status`、`expire_at`、`created_at`、`revoked_at`、`operator_id`、`operator_name`。
- 主要写入：`qrcode`。
- 主要读取：`qrcode`、`attendance`。

### export_history

导出历史。

- 核心字段：`export_type`、`dimension`、`report_type`、`month`、`year`、`order_id`、`filename`、`file_id`、`status`、`operator_id`、`operator_name`、`created_at`。
- 主要写入：`export`。
- 主要读取：`export.getHistory`。

### privacy_consents

隐私授权记录。

- 核心字段：`openid`、`version`、`agreed`、`created_at`。
- 主要写入：`login.recordConsent`。
- 主要读取：`login.getConsentStatus`。

### sign_location_logs

定位诊断日志。

- 核心字段：`user_id`、`action`、`latitude_gcj02`、`longitude_gcj02`、`accuracy`、`factory_latitude_gcj02`、`factory_longitude_gcj02`、`distance_meters`、`sign_radius_meters`、`location_status`、`fail_reason`、`check_status`、`check_reason`、`quality_score`、`quality_level`、`device_info`、`raw_payload`、`created_at`。
- 主要写入：`attendance`。
- 用途：排查打卡定位失败、精度差、围栏外、二维码打卡等问题。

## 时间口径

项目目标口径：业务日期、跨天、月结、统计周期均以北京时间 UTC+8 为准。

- `date` 字段：通常存业务日期字符串 `YYYY-MM-DD`，应由北京时间工具生成。
- `month` 字段：通常存业务月份字符串 `YYYY-MM`，应由北京时间工具生成。
- `created_at`、`updated_at`、`paid_at`、`inspected_at`：通常使用 `db.serverDate()`，表示服务端时间戳。
- `clock_in_time`、`clock_out_time`：当前部分逻辑写 `new Date().toISOString()`，展示和统计时需用北京时间工具转换。
- 展示格式：应使用 `beijing-time.js` 的格式化函数，避免直接使用本地时区方法。
- 开发边界：业务判断不要直接依赖 `new Date().getFullYear()`、`getMonth()`、`getDate()`、`getHours()` 等本地时区方法；必须先转换到北京时间字段。

## 架构风险

- 权限风险：部分读接口仍需确认是否必须要求登录态或老板权限，尤其是订单、工序、工价、员工分配信息。
- 工资口径风险：当前计件工资主要按报工数量 `quantity` 计算，质检合格数 `passed_qty` 不直接影响工资。若业务要求按合格数计薪，需要一次性梳理所有工资、统计、导出口径。
- 删除规则风险：订单删除会影响关联工序、报工、奖惩；若已发薪或已导出，应考虑禁止删除或改为软删除。
- 统计口径漂移：工资、排行榜、数据中心、导出存在多套聚合逻辑，需要避免继续复制。
- 时间口径风险：虽然已有北京时间工具，但 `db.serverDate()` 与 `toISOString()` 的边界必须持续审计。
- 吞错风险：空 `catch` 会掩盖权限、网络、数据库和审计写入问题。
- 订阅风险：到期拦截必须保持温和，新增类写操作可拦截，但历史查看、导出和数据交接不应突然被阻断。
- 隐私审核风险：登录、手机号采集和协议确认页面不得出现默认同意、自动同意或“登录即同意”文案；确认框必须由用户手动勾选。
