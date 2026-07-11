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
  billing/                          订阅状态、人工收款开通、套餐管理
  init/                             数据库初始化与迁移
  common/                           通用工具

tests/                              业务逻辑测试
docs/                               项目文档、验收报告、审计报告
审核/                               小程序审核用截图与视频素材
一期多工厂隔离重构方案_Codex.md       一期多工厂隔离原始工程任务说明
```

## 长期上下文资料

- `一期多工厂隔离重构方案_Codex.md`：一期多工厂/多租户隔离的原始工程任务说明，包含产品目标、工程目标、`Organizations`、`org_id` 数据围墙、平台管理员、登录改造和迁移要求。后续涉及多工厂、租户隔离、平台管理、历史数据迁移时必须参考。
- `审核/`：小程序审核相关素材目录，当前包含 1 个 MP4 视频和 4 张 1179x2556 JPG 截图，用于提交审核、复盘审核材料或后续补充审核说明。

## 用户角色与权限

- `boss`：管理员/老板。可管理员工、订单、工序、考勤、报工、工资、设置、二维码、导出、统计与排行榜。
- `qc`：质检员。可进入质检端查看待检/已检报工并提交合格数量；也会被工资模块作为可计薪人员纳入统计。
- `employee`：普通员工。可考勤打卡、查看个人首页、提交/查看/当日撤销或修改自己的报工、查看个人工资与排行榜。

注意：部分云函数读接口仍需继续核查权限边界，尤其是订单、工序、工价相关读接口。

## 已实现功能模块

- 登录与会话：手机号/密码登录、token 校验、强制改密、登录页行内隐私勾选与授权记录。
- 登录体验：首次登录需输入工厂码、姓名、手机号和密码；隐私协议默认不勾选，用户手动勾选后会记住同意状态；登录成功后本地仅记住工厂码、姓名、手机号与会话 token，不保存密码，后续 token 有效时自动进入。
- 员工管理：员工创建、编辑、启停、重置密码、入厂日期维护。
- 考勤：定位签到/签退、二维码打卡、地理围栏、多点位兼容、异常记录、补卡、月工时。
- 订单与工序：订单创建/编辑/状态变更/复制/删除，工序添加/编辑/改价/分配员工，订单工价隐藏，价格变更审计，订单级报工清空。
- 大工序订单承载：老板端订单详情首屏分批渲染工序，分配面板分批显示工序，分配保存使用 `order.batchAssignProcesses` 批量提交，目标支持单订单 150-200 道工序时页面不明显卡顿。
- 报工：员工按分配工序报工，快照单价，订单总量防超，员工当日撤销/修改，老板报工管理；老板可从进度总览进入单道工序报工明细，代员工新增报工，或修改已有报工数量/备注帮助员工修正，所有变化写回同一条 `WorkLogs` 数据源。
- 质检：待检/已检列表，记录合格数量、质检人、质检时间。
- 工资：计件工资、奖惩、员工端脱敏、老板端工资明细、发薪标记、已发薪奖惩冲正；发薪机制可在系统设置中选择按月或按订单，旧工厂默认按月。
- 数据中心：老板端 KPI 与订单/统计视图。
- 排行榜：按月、按年、按订单等维度统计排行；老板始终可看完整榜单，员工/QC 始终可看本人排名，`leaderboard_visible` 仅控制是否向员工公开完整榜单。
- 导出：按月/按年/按订单，汇总/明细报表预览与 Excel 文件导出。其中「按订单 · 明细」自 2026-05-31 起改为「计件核算矩阵表」——工序为行（工序名带工价括号）、每个员工一列、单元格仅报工数量、表头只写员工姓名，含最右合计列与最底合计行（接口仍为 `report_type=detail`，逻辑见 `cloudfunctions/export/order-matrix.logic.js`，纯函数保留 `includeAmount` 选项可拆数量/金额两列，当前未启用）。
- 设置：工厂坐标、围栏半径、质检阈值、二维码有效期、排行榜公开、发薪机制、SMTP、审核模式等。
- 订阅一期：先试行试用版和标准版；试用版 7 天、最多 10 名员工，标准版开放全部功能；平台后台手动开通/延期，老板端查看服务状态与复制开通信息；到期后温和限制新增订单、工序、员工、报工和考勤码生成；飞盛 `A001/org_home` 默认为永久免费。

## 页面/路由清单

- `pages/login/login`：登录页。
- `pages/privacy-policy/privacy-policy`：隐私政策。
- `pages/user-agreement/user-agreement`：用户协议。
- `pages/employee/home/home`：员工首页，考勤入口、报工入口、工资/排行榜入口。
- `pages/employee/worklog/worklog`：员工报工。
- `pages/employee/profile/profile`：员工个人资料、工资与记录、改密。
- `pages/employee/leaderboard/leaderboard`：员工排行榜。
- `pages/employee/leave/leave`：员工请假（日历多选日期+原因，自助提交、可撤销未到的请假）。
- `pages/qc/home/home`：质检首页，待检/已检列表。
- `pages/qc/inspect/inspect`：质检详情与提交。
- `pages/platform/home/home`：平台管理，工厂列表、工厂资料、工厂管理员、订阅开通。
- `pages/boss/home/home`：老板工作台。
- `pages/boss/subscription/subscription`：老板端服务状态与续费说明。
- `pages/boss/employees/employees`：员工列表。
- `pages/boss/employee-edit/employee-edit`：员工新增/编辑。
- `pages/boss/orders/orders`：订单列表。
- `pages/boss/order-detail/order-detail`：订单详情、工序、分配、价格、导出。
- `pages/boss/attendance/attendance`：考勤管理。
- `pages/boss/salary/salary`：工资汇总。
- `pages/boss/salary-detail/salary-detail`：员工工资详情、奖惩、报工修改。
- `pages/boss/employee-salary/employee-salary`：员工工资档案（某员工全部工资期次+累计总额，点某期下钻 salary-detail）。从员工列表卡片进入。
- `pages/boss/leave-records/leave-records`：请假提醒列表（谁/哪几天/原因），打开即清未读红点；页头「代员工请假」可代不会自助操作的员工补录请假（选员工+月份+日历多选，允许选已过去日期），代录记录标「老板代录」；每条请假可删除（员工提报的+代录的都可删，软删，删后不再计入全勤）。
- `pages/boss/leaderboard/leaderboard`：老板端排行榜。
- `pages/boss/settings/settings`：系统/工厂设置。
- `pages/boss/qrcode/qrcode`：打卡二维码管理。
- `pages/boss/export/export`：报表导出。
- `pages/boss/data-center/data-center`：数据中心。
- `pages/boss/worklog-manage/worklog-manage`：报工管理。

## 云函数/API 清单

- `login`：`login`、`changePassword`、`verifyToken`、`getConsentStatus`、`recordConsent`。
- `user`：`list`、`listEmployees`、`get`、`create`、`update`、`updateStatus`、`resetPassword`、`updateJoinDate`。
- `attendance`：`clockIn`、`clockOut`、`getTodayRecord`、`getMonthlyHours`、`getDailyRecords`、`getPeriodRecords`、`getAbnormalRecords`、`supplement`、`getUserMonthlyRecords`、`checkAbnormal`；**请假（LeaveRecords）**：`requestLeave`、`cancelLeave`、`getMyLeaves`（员工）、`getMonthLeaveSummary`、`getLeaveRequestsForBoss`、`getUnreadLeaveCount`、`markLeavesRead`、`bossAddLeave`（老板代员工补录，校验目标员工同 org、允许过去日期、标记 `created_by_boss`+操作人、自动已读）、`bossDeleteLeave`（老板删任意本厂请假=员工提报+代录，软删 status→cancelled，不限本人/日期）。纯逻辑见 `attendance/leave.logic.js`（日期口径）与前端 `utils/leave-calendar.logic.js`（日历渲染，`allowPast` 控制能否选过去日期）。**全勤口径不分来源**：`summarizeMonthLeave` 只按 `status==='active'` 统计，老板代录与员工提报同等计入「非全勤」，删除(cancelled)不计入。
- `order`：`list`、`getDetail`、`create`、`updateOrder`、`copyOrder`、`updateStatus`、`deleteOrder`、`addProcess`、`updateProcessPrice`、`updateProcess`、`deleteProcess`、`assignProcess`、`batchAssignProcesses`、`getAssignedProcesses`、`togglePriceHidden`、`clearOrderPrices`、`clearOrderWorklogs`、`getPriceChangeLogs`。
- `worklog`：`submit`、`getProcessQuota`、`getTodayEarnings`、`getUserLogs`、`getMonthLogs`、`getPeriodLogs`、`getManageLogs`、`getOrderProgress`、`getPendingLogs`、`getInspectedLogs`、`getLogDetail`、`inspect`、`updateWorkLog`、`deleteWorkLog`、`cancelOwnWorkLog`。
- `salary`：`getUserMonthlySalary`、`getUserMonthlySalaryByBoss`、`getUserSalaryHistory`（员工工资档案：全部期次+累计总额，复用 calcUserSalary/calcUserOrderSalary 不新增口径）、`getAllMonthlySalary`、`getAllOrderSalary`、`getAllPeriodSalary`、`addAdjustment`、`updateAdjustment`、`deleteAdjustment`、`getAdjustments`、`getDashboard`、`markPaid`、`getPaidStatus`、`getUserPaymentRecords`、`getAvailableMonths`。
- `leaderboard`：`getMonthlyRank`、`getOrderRank`、`getYearlyRank`。
- `settings`：`getAll`、`getPublic`、`save`、`updateLeaderboardVisibility`。
- `qrcode`：`generate`、`getLatest`、`verify`、`revoke`。
- `export`：`getTableDataV2`、`exportToFileV2`、`getHistory`、`getOrderList`、`exportProcessSummary`（2026-06-11 删除无调用的 legacy `getTableData`/`exportToFile`；月/年汇总=工资核算表含合计行，月/年明细含「结算单价/当前工价」两列，订单汇总=工资核算表（数量/计件/奖惩/应发），订单明细=报工核算表矩阵）。
- `billing`：`getMySubscription`、`getOpenRequestInfo`、`listPlans`、`openSubscription`、`extendSubscription`、`changePlan`、`listBillingOrders`、`markManualPaymentPaid`。
- `init`：默认初始化、`migrate_v2`、`migrate_multi_tenant`、`migrate_missing_org_batch`、`migrate_billing_v1`、`migrate_location`、`migrate_timezone`。

## 数据库集合与核心字段

- `Organizations`：`org_name`、`factory_code`、`contact_name`、`contact_phone`、`status`、`billing_status`、`plan_id`、`subscription_id`、`trial_end`、`current_period_start`、`current_period_end`、`grace_until`、`billing_owner_user_id`、`billing_updated_at`。`billing_status=permanent` 表示永久免费。
- `Plans`：`plan_id`、`plan_name`、`status`、`price_cents`、`billing_period`、`period_months`、`trial_days`、`employee_limit`、`order_limit_per_month`、`features`、`created_at`、`updated_at`。
- `Subscriptions`：`org_id`、`plan_id`、`plan_name`、`status`、`start_at`、`end_at`、`grace_until`、`source`、`opened_by`、`opened_by_name`、`remark`、`created_at`、`updated_at`。
- `BillingOrders`：`org_id`、`subscription_id`、`plan_id`、`plan_name`、`amount_cents`、`payment_channel`、`payment_status`、`paid_at`、`verified_by`、`verified_by_name`、`external_trade_no`、`remark`、`created_at`、`updated_at`。
- `UsageMonthly`：`org_id`、`month`、`active_users`、`orders_created`、`worklogs_count`、`attendances_count`、`export_count`、`updated_at`。
- `Users`：`name`、`phone`、`role`、`password_hash`、`salt`、`status`、`openid`、`session_token`、`monthly_hours`、`join_date`、`created_at`、`updated_at`。
- `Orders`：`order_name`、`start_date`、`end_date`、`total_quantity`、`status`、`price_hidden`、`created_at`、`updated_at`。
- `Processes`：`order_id`、`process_name`、`current_price`、`note`、`assigned_user_ids`、`process_sort_index`、`status`、`created_at`、`updated_at`。
- `WorkLogs`：`user_id`、`user_name`、`order_id`、`order_name`、`process_id`、`process_name`、`quantity`、`snapshot_price`、`amount`、`date`、`status`、`qc_status`、`passed_qty`、`inspected_by`、`inspected_by_name`、`inspected_at`、`note`、`created_at`、`updated_at`。
- `Attendances`：`user_id`、`user_name`、`date`、`clock_in_time`、`clock_out_time`、`clock_in_location`、`clock_out_location`、`status`、`source`、`qr_id`、`distance_meters`、`hours`、`quality_score`、`quality_level`、`created_at`。
- `SalaryAdjustments`：`user_id`、`user_name`、`type`、`amount`、`reason`、`month`、`order_id`、`operator_id`、`operator_name`、`is_reversal`、`is_correction`、`original_id`、`created_at`、`updated_at`。
- `SalaryPayments`：`user_id`、`user_name`、`month`、`paid`、`paid_at`、`operator_id`、`operator_name`、`created_at`；订单发薪记录可选 `order_id`、`order_name`、`payroll_type=order`、`total_amount`。
- `LeaveRecords`：`org_id`、`user_id`、`user_name`、`month`(YYYY-MM 北京)、`dates`(['YYYY-MM-DD'] 北京)、`day_count`、`reason`、`status`(`active`/`cancelled`)、`boss_read`、`created_at`、`cancelled_at?`；**老板代录追加** `created_by_boss:true`、`operator_id`、`operator_name`；**老板删除追加** `cancelled_by_boss:true`、`cancelled_operator_id`、`cancelled_operator_name`、`cancelled_at`。「全勤」=某员工本月无 active 记录；请假不进工资（§2.1），仅作老板核对参考。员工自助提交、立即生效（无需审批），撤销仅本人且全部日期严格晚于今天；老板 `bossAddLeave` 代录允许选已过去日期（补登已发生请假），`boss_read=true`（不给自己冒红点）。集合首次 `requestLeave`/`bossAddLeave` 时由 `safeCreateCollection` 幂等创建（沿用 init/billing 模式），无需手动建集合。
- `factory_settings`：`factory_latitude`、`factory_longitude`、`geofence_radius`、`checkpoints`、`quality_threshold`、`qrcode_expire_days`、`leaderboard_visible`、`salary_payroll_mode`、`face_recognition_enabled`、`allow_home_checkin`、`smtp_*`、`updated_at`。
- `audit_logs`：`action`、`operator_id`、`operator_name`、`target_id`、`details`、`old_values`、`new_values`、`changes`、`created_at`。
- `qr_codes`：打卡二维码 token、状态、有效期、创建时间等。
- `export_history`：导出类型、月份/维度、文件 ID、文件名、操作者、状态、创建时间。
- `privacy_consents`：用户隐私授权记录。
- `sign_location_logs`：签到/签退定位诊断、坐标、精度、距离、判定状态、失败原因、设备信息。

## 核心业务链路

- 考勤 -> 工资：员工签到/签退写入 `Attendances`，签退后计算 `hours`，工资汇总读取出勤天数和总工时。
- 订单 -> 工序 -> 报工：老板创建订单和工序，分配员工，员工只能对可用工序报工；报工写入 `WorkLogs`，包含 `snapshot_price`；订单详情可清空该订单未发薪月份的全部报工。
- 报工 -> 质检 -> 工资：报工初始为待检，QC 写入 `passed_qty` 和质检状态。工资按报工数量计，`passed_qty` 只用于质量统计；未发薪报工读取/算薪时按 `Processes.current_price` 同步为有效 `snapshot_price/amount`，已发薪报工保留历史快照价。
- 工资 -> 发薪锁定：按月模式下 `SalaryPayments.month + paid=true` 锁定月份；按订单模式下 `SalaryPayments.order_id + paid=true` 标记订单发薪。奖惩修改/删除对已发薪月份仍走冲正记录。
- 统计 -> 导出：`salary`、`worklog`、`export` 等云函数按日期、月份、年份、订单维度聚合数据，并生成 Excel 报表。
- 订阅 -> 写操作限制：`billing` 维护 `Organizations` 上的订阅快照；到期且超过宽限期后，新增订单、复制订单、新增工序、创建员工、提交报工、生成考勤码会被拦截；历史查看和导出暂不拦。

## 2026-06-11 高风险区规则现状（已落地）

- **改价拦截**：工序存在已发薪报工（按月或按订单）时 `updateProcessPrice`/`updateProcess` 整体拒绝改价；未发薪改价会同步重写该工序全部未发薪报工的 `snapshot_price/amount`。为兼容历史漏同步数据，`worklog`/`salary`/`export`/`leaderboard` 读取和聚合时也会把未发薪报工的有效结算价同步为 `Processes.current_price`。
- **完成订单锁（可恢复）**：处于 `completed` 时 order/worklog 全部写操作（删订单/工序增删改/分配/改价/隐藏工价/清空/报工增删改）拒绝并返回原因。**但 `completed` 非绝对终态：`updateStatus` 支持 completed→active「恢复为进行中」（`canChangeOrderStatus`），恢复后写锁随 status 自动放开；仍禁止 completed→cancelled。** 恢复时 `releaseOrderPaymentLocksOnReactivate` 把本订单 `SalaryPayments{order_id,paid:true}`→`paid:false`（+`released_by_reactivation/released_at/operator_*` 审计字段）解锁报工/工价；「按月」发薪锁不自动动，返回 `data.month_locked_count/month_locked_preview` 提示。前端：订单列表「恢复」按钮 / 详情「更多」菜单。
- **删除发薪锁**：`deleteOrder`、`deleteWorkLog`、`clearOrderWorklogs` 命中已发薪（按月或按订单）一律拒绝；员工 `cancelOwnWorkLog` 保留时间序口径。
- **发薪即完成**：`salary.markPaid` 返回 `data.order_fully_paid/order_status`，订单全员发薪后老板端弹窗一键置为已完成。
- **实时工价 / 有效结算价**：`worklog.getManageLogs`、员工历史报工、`salary` 明细/列表/档案、`export`、`leaderboard` 均通过 `settlement-price.logic.js` 处理：未发薪显示和计算当前工价，已发薪保留结算价并返回 `current_price/price_changed`（响应字段，非库字段）；export 明细带「当前工价」列。
- **统一鉴权**：`auth-guard.js`（common 为真源，10 份相同副本，测试守护）强制 token + org active fail-closed，无 openid 回退；登录限流按 `rate_key=(工厂码/姓名/手机号)` 等值计数、fail-closed（audit_logs 新增 `rate_key` 字段）。

## 当前 P0/P1/P2 风险清单

### P0

- ~~部分订单/工序读接口权限边界可能不足~~（2026-06-11 鉴权统一后全部接口强制登录态；`getAssignedProcesses` 仍限本人或 boss）。
- ~~`deleteOrder` 无发薪保护~~（2026-06-11 已加完成锁+发薪锁，见上）。
- 工资口径已由老板确认：按报工数量 `quantity`，不按 `passed_qty`（CLAUDE.md §2.1，勿再质疑）。

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

- 每次开发前先读本文件、`docs/ARCHITECTURE.md` 和 `docs/VERSION_HISTORY.md`。
- 每次代码、云函数、数据库迁移或页面改动后，必须同步更新 `docs/VERSION_HISTORY.md`；涉及架构、字段、权限、业务口径时同步更新本文件和 `docs/ARCHITECTURE.md`。
- 多工厂、租户隔离、平台管理、历史数据迁移相关开发，必须同时参考 `一期多工厂隔离重构方案_Codex.md`。
- 订阅收费、到期限制、人工开通相关开发，必须同时参考 `docs/一期订阅收费迭代方案.md`。
- 登录、隐私协议、手机号采集相关开发，不得使用“登录即同意”等默认同意文案；必须由用户自主阅读并手动勾选确认，且默认未勾选，不再使用隐私强制同意弹窗。
- 大数据量页面优先做分批加载、分页渲染和批量云函数提交；避免一次性渲染 100+ 大卡片或在前端循环发起大量云函数调用。
- 工资、权限、时间、统计、导出、数据库字段属于高风险区，修改前必须先输出 Plan 并确认口径。
- 不确定字段或业务规则时，不要猜；先标注“不确定”并向业务确认。
- 不复制第二套工资、考勤、统计逻辑。
- 不在页面层堆复杂业务计算；优先复用云函数或已有业务逻辑模块。
- 新增字段必须说明用途、来源、兼容旧数据方式，并同步更新文档。
- 每个小功能建议单独 Git 小步提交。

## 近期迭代摘要

- 2026-06-09：排行榜隐私语义调整为员工默认只看本人排名，老板可在老板端排行榜页开启完整榜单公开；员工首页新增“我的排名”醒目卡片。
- 2026-06-09：复制订单时为副本工序写入可选 `Processes.process_sort_index`，订单详情优先按该索引排序，避免并发复制导致副本工序顺序与源订单不一致；旧订单缺省继续按时间排序。
- 2026-05-31：按订单导出明细改为计件核算矩阵表（工序为行、每个员工一列仅数量、表头只写姓名、含行列合计、工价显示在工序括号内）；修复预览表格列宽错位；新增 `export/order-matrix.logic.js` 纯函数（保留 `includeAmount` 可选金额列）与单测，新增 `npm run test:unit`。
- 2026-05-02：登录页隐私确认改为默认未勾选的行内勾选框，替换订阅联系管理员微信二维码。
- 2026-05-01：巩固单订单 150-200 道工序承载，订单详情与分配面板改为分批渲染，分配保存改为批量云函数提交。
- 2026-05-01：报工管理进度总览支持点击工序进入该工序报工明细，老板可直接新增或编辑报工记录帮助员工修正。
- 2026-05-01：订阅套餐收敛为试用版/标准版；试用版 7 天 10 人上限，标准版全功能，飞盛 `A001` 默认永久免费。
- 2026-05-01：修复小程序审核指出的隐私默认同意问题，登录页改为自主阅读后手动勾选，并新增上次账号信息记忆。
- 2026-04-30：订阅收费一期开始落地，新增 `billing` 云函数、`migrate_billing_v1`、老板端服务状态页、平台端订阅开通模块，并接入温和到期拦截。
- 2026-04-30：纳入一期多工厂隔离原始方案与小程序审核素材目录，并在项目记忆中登记为长期上下文资料。
- 2026-04-30：形成一期订阅收费方案，方向为人工收款或一次性微信支付 + 平台后台手动开通；计划新增老板端服务状态页、平台端订阅管理、订阅字段和分批迁移。
- 2026-04-29：一期多工厂隔离基础完成，新增 `Organizations`、平台管理员、工厂码登录、核心集合 `org_id` 隔离。
- 2026-04-29：平台管理页支持编辑工厂名/工厂码/联系人，新增选中态，并按中老年用户重构为单列大按钮布局。
- 2026-04-29：修复历史单厂数据迁移后前端不可见问题，补充分批 `org_id` 回填动作并兼容缺排序字段的老记录。

详见 `docs/VERSION_HISTORY.md`。
