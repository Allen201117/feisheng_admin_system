# CLAUDE.md — 飞盛工厂管理小程序

> 给在本仓库工作的 AI 代理（Claude / Codex 等）。**动手改任何代码前，先读完本文件**，再按需读
> `docs/PROJECT_MEMORY.md`（字段/接口/集合清单）、`docs/ARCHITECTURE.md`（数据流/数据模型）、`docs/VERSION_HISTORY.md`（迭代记录，每次改完先更新它）。
> 本文件只讲两件事：**怎么干活**，和**哪里一改就爆炸**。细节查 docs/。

---

## 0. 一句话

面向服装厂 / 加工厂的内部管理微信小程序「飞盛」。业务闭环：**订单 → 工序分配 → 员工报工 → 质检 → 工资核算 → 统计 → 报表导出**，叠加**考勤打卡**、**多工厂 org_id 租户隔离**、**人工收款订阅**三层。

- 前端：微信小程序原生（WXML/WXSS/JS，无框架，`style:v2`，`lazyCodeLoading:requiredComponents`）。
- 后端：微信云开发 CloudBase 云函数（Node，`wx-server-sdk ~2.6.3`）+ 云数据库。
- AppID `wxdea72acb7b86befa`，云环境 `cloud1-5gr08st9c198f437`。
- 规模：14 个云函数（约 1.2 万行）+ 26 个页面。导出用 `xlsx`，二维码用 `qrcode`。

---

## 1. 铁律（违反 = 生产事故 / 工资算错 / 数据泄漏）

1. **高风险区（见 §2）改动前先出 Plan**：写清改动范围、涉及文件、数据字段、旧数据兼容、测试路径。口径不确定先标「不确定」再确认，**绝不猜**字段/口径/权限。
2. **不复制第 N 套统计**：工资/排行榜/数据中心/导出的聚合口径**已经有 4 套实现**（salary、period-statistics、export、leaderboard 各一份 `quantity*snapshot_price`）。只能复用或抽公共纯函数，**禁止再加一套**。
3. **北京时间口径**：业务日期/跨天/月结/统计周期一律 UTC+8，统一走 `beijing-time.js`（前后端各一份**相同**副本，改一处要同步另一处）。禁止用 `new Date().getFullYear()/getMonth()/getDate()/getHours()` 做业务判断。
4. **业务逻辑进 `.logic.js` 纯函数**：可测的计算抽到同目录 `*.logic.js`（不碰 `wx`/`db`），用 `node:test` 单测。新增业务逻辑沿用此模式，别堆在页面层或带副作用的代码里。
5. **不空 catch 吞错**：尤其工资/权限/考勤/统计/导出/写库/审计相关。
6. **隐私合规**：登录/手机号/协议页禁止「登录即同意/默认同意/自动同意」；勾选框默认未勾选，用户手动确认。当前 consent 版本 `2026-05-01-v2`。
7. **不碰生产、不碰密钥**：禁止 AI 自动执行 小程序 upload/发布、部署/删除云函数、清库、改 appid/线上环境 ID、写真实生产数据。不读 `.env*`/`*.key`/`*.pem`/credentials；不 `curl|sh`。
8. **Git 要确认**：`git add/commit/restore/reset/clean/push` 未经用户明确确认禁止执行。确认后只提交本次相关文件，**禁止 `git add .`**。每次任务收尾自动输出 `git status --short` + `git diff --stat` + 改动总结 + 建议 commit message。
9. **改完同步文档**：先更 `docs/VERSION_HISTORY.md`；涉及架构/字段/权限/工资·发薪·改价·完成/时间/统计/删除规则时，同步更新 `PROJECT_MEMORY.md` 和/或 `ARCHITECTURE.md`，必要时回写本文件 §2。

---

## 2. 高风险区 + 权威业务口径（改前必看，标 ✅ 的已与老板确认）

> 这一节是**业务真相的唯一来源**。代码与本节冲突时，以本节为准，代码该改。标「现状」的是当前实现，标「目标」是应达成的口径，「GAP」是待补的差距。

### 2.1 计件工资口径 ✅
- 工资 = `Σ(WorkLogs.quantity × snapshot_price)`，**按报工数量，不按合格数 `passed_qty`**。`passed_qty` 只用于质量统计（合格率），**永不进工资**。已确认，别再问。
- `snapshot_price` 是报工时冻结的单价，存在每条 WorkLog 上。

### 2.2 改工序单价规则 ✅（最易出错，§2.1 之外的第二红线）
- **已发薪的工序/订单：禁止改价。** 老板点改单价时**直接拦截**，提示「该工序/订单已发薪，单价不可修改」。已发薪报工的 `snapshot_price`/`amount` **永不被改价触碰**。
- **未发薪：允许改价，且全平台同步。** 改价后把该工序**所有未发薪报工**的 `snapshot_price` 与 `amount(=quantity×新价)` 一并重写。
- ✅ **发薪即固化（2026-08-29）**：`salary.markPaid(paid:true)` 打勾前先跑 `freezeSettlementPricesForPayroll`，把本次发薪范围内所有未发薪报工的 `snapshot_price`/`amount`/`process_name` 写死回 `WorkLogs`，再算 `total_amount`。**这是「结算价 ≠ 当前价」双价问题的根治点**——结算价平时是「读时按 `Processes.current_price` 覆盖」，不在发薪那一刻固化，锁定后就会翻回旧 snapshot，既显示双价又与实发总额对不上。固化失败直接中止发薪。
- ✅ **改工序同步名+价（2026-08-29）**：`syncWorklogsForProcess`（原 `syncZeroPriceWorklogsForProcess`）在改价**和改名**时都重写未发薪报工，幂等 + 分块并发（避免逐条 await 超时造成半同步脏数据），失败条数回报老板要求重试，不再静默吞错。
- ✅ **存量对账修复（2026-08-29）**：`salary.repairSettlementPrices`（boss only，默认 `dry_run`）。**§2.2「已发薪报工 snapshot_price 永不被触碰」的唯一例外**：只有当「按发薪当时口径重算的总额 == `SalaryPayments.total_amount`」时才重写，属对账不属改价；对不上账的组一律不动并列入 `manual_review`。入口在老板端设置页「数据体检」。
- ✅ 已实现（2026-06-11）：`order.updateProcessPrice` / `updateProcess` 改价前先 `findProcessPaidWorklogConflicts`（`pay-lock.logic.js`，按月+按订单两种发薪都查），命中任一已发薪报工**整体拒绝**并提示「该工序已发薪，单价不可修改」；未发薪走 `syncZeroPriceWorklogsForProcess` 同步重写（注意：按**未发薪**过滤，不是按零价，函数名有误导），成功文案已改为「未发薪报工已同步为新单价」。

### 2.3 发薪锁定 + 发薪即完成 ✅
- `SalaryPayments.paid=true` 锁定。按月 ID `${org}_${user}_${month}`，按订单 ID `${org}_${user}_order_${orderId}`。`salary_payroll_mode`（`monthly` 缺省 / `order`）决定模式。
- 已发薪月份/订单的奖惩改删走**冲正记录**（`is_reversal`/`is_correction`/`original_id`），不改原记录。
- **发薪 = 订单完成标志**（订单发薪模式）：✅ 已实现（2026-06-11）：`salary.markPaid` 返回 `data.order_fully_paid/order_status`（`isOrderFullyPaid`，payment-record.logic.js），订单全员发薪且未完成时，老板端工资页弹窗提醒一键把订单置为「已完成」。

### 2.4 删除规则 + 已完成订单锁定（可恢复）✅
- **订单状态 `completed`：处于该状态时禁止老板删除/修改该订单的任何相关数据**（订单本身、工序、改价、报工增删改），并把原因返回给老板（「订单已完成，不可修改」）。
- ✅ 已实现（2026-06-11）统一锁：`order` 的 deleteOrder/addProcess/updateProcessPrice/updateProcess/deleteProcess/assignProcess/batchAssignProcesses/togglePriceHidden/clearOrderPrices/clearOrderWorklogs 与 `worklog` 的 updateWorkLog/deleteWorkLog 全部拒绝 completed 订单（`isOrderCompleted`/`ensureOrderNotCompleted`）；`copyOrder` 仍允许（只读源订单）。
- ✅ **`completed` 不再是绝对终态（2026-06-14）：老板可把已完成订单「恢复为进行中」(`updateStatus` completed→active，`canChangeOrderStatus`)。** 恢复=把 status 改回 active，所有按 `status==='completed'` 的写锁随之自动放开。`updateStatus` 仍禁止 completed→cancelled（恢复只针对进行中）。恢复时**自动把本订单「按订单」已发薪记录改为未发薪**（`releaseOrderPaymentLocksOnReactivate`：`SalaryPayments{order_id,paid:true}`→`paid:false` + 审计字段），解锁报工/工价；**「按月」发薪是整月跨订单口径不自动动**，仅 `findMonthLockedConflicts` 统计并返回 `month_locked_count/preview` 提示老板自行到工资页取消该月发放。前端入口：订单列表「恢复」按钮 / 详情「更多」菜单。
- ✅ 发薪锁收口：`deleteOrder` 删除前查「订单级已发薪记录 + 报工按月/按订单已发薪」，命中即拒绝；`deleteWorkLog`/`updateWorkLog` 统一走 `getWorklogPaidRecord`（订单级优先、月级兜底）；`clearOrderWorklogs` 升级为按月+按订单双重检查。员工 `cancelOwnWorkLog` 保留时间序口径（发薪后新增的报工可自删，属有意设计）。

### 2.5 权限
- 所有云函数**写操作**必须校验登录态 + 角色。员工只能访问自己的工资/考勤/报工；QC 只拿质检所需数据，**不默认有 boss 权限**。
- 鉴权链：`callCloud` 注入 `auth_user_id+auth_session_token` → `getCallerUserByEvent` 校验 token + `Users.status=active` + 所属 `Organizations.status=active` → `getOrgId(user)` 取租户。**org_id 从登录用户推导，绝不信前端传值。**
- ✅ 鉴权统一（2026-06-11）：唯一真源 `cloudfunctions/common/auth-guard.js`，10 个云函数各持相同副本（部署约束，同 beijing-time 模式；`tests/auth-guard-copies.test.js` 校验字节一致）。统一口径：**强制 token、无 openid 回退、org 状态 fail-closed**；platform 同口径（并禁止停用 org_platform/org_home）；登录限流改为 `rate_key=(工厂码/姓名/手机号)` 等值计数 + fail-closed。
- 仍待加固：`session_token` 无过期 TTL（泄露在重置前长期有效）；主鉴权不校验 openid（仅 verifyToken 校验）；`callCloud` 对非幂等写操作的网络重试可能造成重复提交。

### 2.6 时间口径
见 §1.3。`date`/`period_key`/`month` 存北京时间业务字符串；`created_at`/`paid_at`/`inspected_at` 用 `db.serverDate()`；`clock_*_time` 现写 `toISOString()`，展示/统计时转北京时间。`db.serverDate()` 与 `toISOString()` 边界仍需持续审计。

### 2.7 统计口径漂移
见 §1.2。改任何工资/合格率口径，4 套实现要同步：`salary/index.js`、`salary/period-statistics.js`、`export/index.js`(+`order-matrix.logic.js`)、`leaderboard/index.js`。

### 2.8 隐私合规
见 §1.6。

### 2.10 考勤 / 请假 / 全勤口径 ✅（2026-08-29 老板确认）
- **全勤 = 当月 active 请假合计 ≤ 2 天**（此前口径是「一天都不能请」，已废弃）。阈值真源 `cloudfunctions/attendance/leave.logic.js` 的 `FULL_ATTENDANCE_MAX_LEAVE_DAYS`；前端 `miniprogram/utils/attendance-calendar.logic.js` 是同口径副本（同 beijing-time 模式），`tests/attendance-calendar.logic.test.js` 校验两边一致，**改一处必须同步另一处**。
- **请假支持半天**：`LeaveRecords.half_days = { 'YYYY-MM-DD': 'am' | 'pm' }`，半天记 **0.5 天**；没有该字段的老记录一律当全天，向后兼容。前端交互是**连点同一天循环**：未选 → 全天 → 上午 → 下午 → 未选。
- **每天的考勤状态四态**（`attendance-summary.logic.js`，优先级从高到低）：`present` 有签到时间（绿）→ `leave` 当天有 active 请假（橙）→ `absent` 已过去且既没打卡也没请假（红）→ `future` 日期还没到（灰，不算缺勤）。**请假单独一色不并进红色**：否则「请假 2 天内还算全勤」在日历上会自相矛盾。
- 请假永不进计件工资（§2.1），只是老板核对工资时的参考标记。

### 2.9 老板视角必显「实时工价」✅
- **所有老板可见的报工/工资「明细」与「统计」里，每条/每工序都要显示对应工序的实时工价 = `Processes.current_price`（当前价，不是冻结的 `snapshot_price`）。**
- 工资金额仍按 `snapshot_price` 结算（§2.1 不变）；实时工价是**额外展示字段**。当 `snapshot_price ≠ current_price`（多为已发薪历史）时，明细要同时标清「结算价(snapshot) / 当前价(current)」，避免老板困惑。
- 适用面：data-center、export 各报表（报工核算表 / 工资核算表）、salary / salary-detail、worklog-manage、order-detail 的报工/工资展示。
- ✅ 已实现（2026-06-11）：`export`（月/年明细表新增「结算单价/当前工价」两列；订单矩阵表工价括号本就是 current_price）、`worklog.getManageLogs` 与 `salary.getUserMonthlySalaryByBoss` 返回 `current_price`+`price_changed`（按 process_id 批量 join，无 N+1），worklog-manage / salary-detail 明细行显示「结算价 ¥x · 当前价 ¥y」（仅价格不一致时显示当前价），data-center 工序进度区显示实时工价。

---

## 3. 业务闭环 & 角色

**闭环**：老板建订单+工序（定工价）→ 分配员工 → 员工报工（冻结 `snapshot_price`）→ QC 填 `passed_qty` 质检 → 工资按 `quantity×snapshot_price` 核算 → 发薪锁定 → 统计/排行/数据中心 → Excel 导出。并行：考勤打卡（GPS 地理围栏 + 二维码）→ 工时；多工厂隔离；订阅到期温和拦截。

**角色**（`role`：boss/qc/employee；平台管理员看 `platform_role==='platform_admin'`，不是 role）：
- `boss` 老板：全权（员工/订单/工序/考勤/工资/设置/二维码/导出/统计），始终看完整排行榜。
- `qc` 质检：看待检/已检报工、填合格数；也作为可计薪人纳入统计。
- `employee` 员工：打卡、报工、改/撤自己的报工、看本人工资与排名。
- `platform_admin` 平台管理员：跨租户建/停工厂、建工厂老板、改密、开通订阅。

---

## 4. 架构 / 目录

**调用链**：页面 → `utils/util.js` `callCloud(name,data)`（注入登录态）→ 云函数（`getCallerUserByEvent` 鉴权 + `getOrgId` 隔离）→ CloudBase。`callCloud` 把 `code===0` 和 `code===-2`（软失败，如 GPS 不稳）都当成功返回，调用方需自查 code；仅网络层失败自动重试 ≤2 次。

```text
miniprogram/
  app.js/app.json/app.wxss        入口、26 页路由、设计 Token（视觉唯一真源，勿绕过）
  pages/{login,employee,qc,boss,platform,privacy-policy,user-agreement}/
  utils/  auth(登录态) util(callCloud) beijing-time location privacy config
cloudfunctions/                   每目录一函数，入口 index.js，业务纯函数在 *.logic.js
  login user attendance order worklog salary leaderboard settings qrcode export billing init  common/(beijing-time)
tests/                            node:test 逻辑单测 + tests/e2e（Jest smoke）
docs/                             权威文档（见 §7）
一期多工厂隔离重构方案_Codex.md      多租户原始方案（涉及隔离/平台/迁移必读；注意方案里字段名 PayrollPayments/factory_admin/submitted_qty 与实际代码 SalaryPayments/boss/quantity 有漂移，以代码为准）
docs/一期订阅收费迭代方案.md        订阅收费专项方案
```

隔离键统一 `org_id`；`factory_settings` 文档 id = `org_id`（旧数据可能仍在 `main`，注意 attendance 有 `main` 回退而 leaderboard/qrcode 没有）。

---

## 5. 工作流 / 命令 / 测试

**节奏**：理解上下文 →（高风险先出 Plan）→ 按现有模式最小化改 → 跑验证 → 改完更文档 → 汇报（改了什么/为什么/怎么测/剩余风险，用大白话）。**只改必要的，不做无关重构/格式化。**

```bash
npm run test:unit     # node:test 逻辑单测（纯函数，无需开发者工具）— 改 .logic.js 必跑
node --test tests/xxx.test.js     # 跑单个
npm run test:e2e      # Jest E2E smoke（仅验证首页可开，需 Mac 开发者工具）
npm run wx:check / wx:open / wx:build-npm / wx:preview
```

开发者工具服务端口 `48909`，自动化端口 `9420`。**禁止 AI 自动 upload/发布/部署/动生产**（见 §1.7）。

---

## 6. 当前进行中 / 待办

迭代记录看 `docs/VERSION_HISTORY.md`；我的跨会话记忆（含老板交接的口径与在做的任务）在 `~/.claude/.../memory/MEMORY.md`。

2026-06-11 五轮救火+需求已全部落地（明细见 `docs/CODE_REVIEW_2026-06-10.md` 状态标记与 VERSION_HISTORY）：①P0+§2.2/2.3/2.4 改价拦截/发薪即完成/完成订单锁/删除发薪锁；②导出重构（报工核算表/工资核算表）+ 数据中心按订单视图修复 + §2.9 实时工价；③鉴权统一 auth-guard；④callCloud 日志脱敏/启动误登出修复/前端北京时间收口；⑤N+1 批量化与若干收尾。
**遗留风险**（按优先级）：session_token 无 TTL；callCloud 非幂等写重试；`report_quantity` 历史兜底口径需确认存量数据后收口；init 迁移脚本仍写死 'main'（一次性运维脚本，多租户下需按 org 遍历重写后再用）；全部改动尚未在微信开发者工具真机验证、云函数未部署。

---

## 7. 文档索引

- `docs/PROJECT_MEMORY.md` — 功能/路由/云函数 API/集合字段/风险清单（查字段查接口先看它）。
- `docs/ARCHITECTURE.md` — 架构/数据流/数据模型/时间口径。
- `docs/VERSION_HISTORY.md` — 迭代记录（**每次改完先更新**）。
- `docs/DEVELOPMENT_RULES.md` — 开发规则全文。
- `docs/DEVTOOLS_AUTOTEST.md` — 开发者工具自动化自测。
- `一期多工厂隔离重构方案_Codex.md` / `docs/一期订阅收费迭代方案.md` — 多租户 / 订阅专项。

**规则优先级**：当前会话明确指令 > 本文件 §2 业务口径 > 项目其他文档 > 全局 CLAUDE.md > 默认行为。
