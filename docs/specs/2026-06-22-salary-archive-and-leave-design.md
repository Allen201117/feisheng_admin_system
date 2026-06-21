# 方案设计：员工工资档案 + 请假/全勤标识（2026-06-22）

> 状态：**待老板确认 → 待写实施计划**。本文是「干什么、长什么样、改哪些文件、守哪些红线」的唯一来源，开工前以本文为准。
> 关联规则：CLAUDE.md §2.1 计件口径 / §2.3 发薪锁 / §2.5 权限 / §2.9 实时工价 / §1.3 北京时间 / §1.4 .logic.js。

---

## 1. 背景与目标

老板有两个诉求：

1. **员工工资档案**：现在「员工列表」只能看到有哪些人。希望点进每个员工，看到他**过去全部工资记录**，每一期能下钻到对应的**订单 / 工序 / 报工 / 工价**明细。
2. **请假 + 全勤标识**：员工端能自助请假（选月份 + 选哪几天）；老板在「薪资管理」里，每个员工卡片直接看到**本月全勤（绿）/ 请假 N 天（红）**，方便核对工资时一眼定位谁满勤谁缺勤；有人请假时老板端收到提醒。

**真实目标**：让老板在「核工资」这个高频动作里，信息一把抓——既能纵向看一个人的历年工资明细，又能横向一眼扫出本月出勤异常的人。

---

## 2. 已确认决策（老板拍板）

| 决策点 | 选择 | 理由 |
| --- | --- | --- |
| 请假是否要老板审批 | **不审批，员工自助，直接记录** | 计件工资，请假不直接扣钱，只是核对参考；省老板操作 |
| 老板如何收到请假提醒 | **App 内红点 + 请假列表**（不做微信推送） | 可靠、零额外配置；老板本就要打开小程序算工资 |
| 「全勤」如何判定 | **本月没有请假记录 = 全勤** | 系统无固定「应出勤日历」，打卡有 GPS 偶发失败，用「主动请假」最干净、不误伤 |
| 请假是否自动扣工资 | **绝不自动扣**（§2.1 考勤永不进计件工资） | 要不要扣全勤奖，老板用现有「奖惩」功能手动加，主动权在老板 |

---

## 3. 功能1：员工工资档案

### 3.1 关键事实：明细页已存在，只缺入口
`pages/boss/salary-detail` **已经实现**「某员工 × 某期」的完整明细：报工列表（订单名 `order_name`、工序名 `process_name`、数量 `quantity`、结算价 `snapshot_price`、当前工价 `current_price`/§2.9、金额、合格率）+ 奖惩明细 + 工时/产量统计。它现在只能从「按月发工资」流程进，员工列表点不进去。

**所以功能1 = 加一个「按员工看全部期次」的列表页 + 把员工列表变成可点击，下钻复用现成明细页。** 不新做明细 UI。

### 3.2 交互
1. `pages/boss/employees` 每个员工卡片可点击 → 跳到新页「员工工资档案」`pages/boss/employee-salary`（带 `id` / `name` / `role`）。原有的「编辑 / 停用 / 重置密码」按钮保留（卡片主体区点击进档案，按钮区各自响应）。
2. 档案页：顶部员工头卡（姓名、工种、**累计总工资**）+ 下方工资期列表：
   - **按月模式**：每行 = 月份 + 该月总工资 + 已发/未发。
   - **按订单模式**（`salary_payroll_mode==='order'`）：每行 = 订单名 + 该订单总工资 + 已发/未发。
3. 点任意一期 → 跳 `pages/boss/salary-detail`（按月传 `id&name&month`，按订单传 `id&name&order_id&order_name`，与现有 `salary.js` 的 `goDetail` 完全一致）。

### 3.3 后端
`cloudfunctions/salary/index.js` 新增 action **`getUserSalaryHistory`**：
- 入参：`user_id`（boss 角色校验 + org 隔离；沿用现有 `getCallerUserByEvent` / `getOrgId`）。
- 出参：`{ payroll_mode, total_all, periods: [{ key, label, total, paid }] }`，`periods` 含该员工有报工的**所有**月份/订单（不止已发的），按时间倒序。
- **复用现有聚合口径**：周期总额走现成的 `quantity × snapshot_price` 计算（与 `getAllMonthlySalary`/`getUserMonthlySalary` 同一份逻辑），**禁止新增第 5 套统计**（§1.2 / §2.7）。已发状态从 `SalaryPayments` 读（ID 格式：按月 `${org}_${user}_${month}`、按订单 `${org}_${user}_order_${orderId}`）。
- 注：现有 `getUserPaymentRecords` 只返回「已发」凭据，不满足「全部期次」，故新增本方法。

---

## 4. 功能2：请假 + 全勤标识

### 4.1 数据模型：新增集合 `LeaveRecords`
| 字段 | 类型 | 说明 |
| --- | --- | --- |
| `_id` | string | |
| `org_id` | string | 租户隔离，从登录用户推导（§2.5，绝不信前端） |
| `user_id` / `user_name` | string | 请假人；`user_id` 从鉴权取，不信前端 |
| `month` | string | `YYYY-MM`（北京时间）；一次提交限定在单月内（日历按月选） |
| `dates` | string[] | `['YYYY-MM-DD', ...]` 北京时间业务日期 |
| `day_count` | number | = `dates.length`，便于「请假 N 天」汇总 |
| `reason` | string | 选填 |
| `status` | string | `active` / `cancelled` |
| `boss_read` | boolean | 老板是否已读（红点用）；新建为 `false` |
| `created_at` | serverDate | `db.serverDate()`（§2.6） |
| `cancelled_at` | serverDate? | 撤销时间 |

时间口径：`month`/`dates` 存北京时间字符串（走 `beijing-time.js`），`created_at`/`cancelled_at` 用 `db.serverDate()`。

### 4.2 后端：扩展 `attendance` 云函数（不新建云函数）
**决策**：请假属「考勤域」，把 leave 的 action 放进 `cloudfunctions/attendance/index.js`，纯逻辑放 `cloudfunctions/attendance/leave.logic.js`（`node:test` 单测）。
**理由**：避免新增第 15 个云函数带来的部署 / auth-guard 副本 / beijing-time 副本 / 副本一致性测试的额外开销；语义上 请假就是考勤的一部分。`LeaveRecords` 集合仍独立，不污染 `Attendances`。

新增 action（均做登录态 + 角色 + org 校验，§2.5）：
| action | 角色 | 作用 |
| --- | --- | --- |
| `requestLeave` | employee（给自己） | 入参 `month` + `dates[]` + `reason`；写一条 `LeaveRecords`（`boss_read=false`）。`user_id` 取鉴权值 |
| `cancelLeave` | employee（自己的记录） | 仅允许撤销「所选日期都还没过」的记录 → `status='cancelled'` |
| `getMyLeaves` | employee | 本人请假列表（含状态） |
| `getMonthLeaveSummary` | boss | 入参 `month` → 返回 `{ [user_id]: day_count }`（status=active 求和），给薪资卡片打标 |
| `getLeaveRequestsForBoss` | boss | 老板请假列表（谁/哪几天/原因/时间，按 `created_at` 倒序） |
| `getUnreadLeaveCount` | boss | 未读条数（`boss_read=false && status=active`），首页/薪资页红点用 |
| `markLeavesRead` | boss | 打开请假列表时把未读批量置 `boss_read=true` |

纯函数（`leave.logic.js`，不碰 `wx`/`db`）：
- `summarizeMonthLeave(records)` → `{ [user_id]: day_count }`（过滤 `status==='active'`）。
- `buildAttendanceBadge(dayCount)` → `{ type:'full'|'leave', text:'全勤'|'请假N天' }`。
- `canCancelLeave(record, todayBeijing)` → bool（全部日期 ≥ 今天才可撤）。

### 4.3 前端：员工端
- `pages/employee/home`「快捷操作」网格加一个「请假」入口 → 跳 `pages/employee/leave`。
- 新页 `pages/employee/leave`：
  - 月份切换（默认本月，北京时间）。
  - 月历网格，点亮要请假的日期（多选；已过的日期置灰不可选）。
  - 选填原因。
  - 「提交请假」→ `callCloud('attendance', { action:'requestLeave', month, dates, reason })`。
  - 下方「我的请假」列表：显示已请记录 + 对未过期的可「撤销」。

### 4.4 前端：老板端
- **薪资卡片打标**：`pages/boss/salary` 在加载薪资列表时并行 `getMonthLeaveSummary(选中月)`，给每个员工卡片渲染 **全勤（绿）/ 请假 N 天（红）** 小标（放姓名右侧，与现有「已发/未发」标并列）。
  - 「本月」口径：**按月模式** = 当前选中的月份；**按订单模式** = 当前自然月（订单跨月无单一月份，作粗略提示）。
- **请假提醒**：薪资页标题右侧「请假提醒」按钮 + 未读红点（`getUnreadLeaveCount`）；点开 → 新页 `pages/boss/leave-records`（老板请假列表），进入即 `markLeavesRead` 清红点。
- **首页红点**：`pages/boss/home`「薪资管理」入口角标显示未读请假数（`onShow` 时取 `getUnreadLeaveCount`），老板不漏。

---

## 5. 视觉规范（醒目版）

复用 `miniprogram/app.wxss` 既有设计 Token，**不硬编码颜色**（§4 设计 Token 是视觉唯一真源）：

| 元素 | 规格 |
| --- | --- |
| 全勤标 | 实心绿：底 `--color-success`（`--green-600`）+ 白字 + `ti`/对勾图标；字号 26rpx/500；圆角 `--radius-md` |
| 请假标 | 实心红：底 `--color-danger`（`--red-600`）+ 白字 + 日历图标；文案「请假N天」；同上字号 |
| 卡片状态色条 | 卡片左侧 5rpx 竖条：全勤=`--color-success`，请假=`--color-danger`，便于纵向扫读 |
| 累计总工资 / 期金额 | 数字放大加粗：累计总工资 ≈ 48rpx/500 且用 `--color-primary`；每期金额 ≈ 36rpx/500 |
| 已发 / 未发标 | 已发=实心 `--color-success`+白字；未发=沿用现有 `badge-slate` 弱灰底（不新造） |
| 请假提醒红点 | 实心 `--color-danger` 圆，白字数字，置于按钮右上角 |
| 提交请假按钮 | 大按钮：实心 `--color-primary` + 白字，≈ 32rpx/500 |
| 请假日历选中日 | 选中日实心 `--color-primary` + 白字；已过日期置灰禁用 |

> 新增 `.badge-attend-full` / `.badge-leave` 等类沿用现有 badge 写法，落在对应页面 wxss；通用的放 app.wxss。字号用 rpx，与项目其余页面一致。

---

## 6. 不做（YAGNI，留待以后）
微信订阅消息推送、请假审批流、半天/小时假、自动扣全勤奖、把全勤标也铺到员工列表页。

---

## 7. 守住的项目红线
- §2.1 / §2.7：工资仍 `quantity × snapshot_price`，请假**不进工资**；工资聚合**复用**现有口径，不加第 5 套。
- §2.9：明细页继续显示结算价 + 当前工价（复用现成 `salary-detail`，无需改动）。
- §1.3 / §2.6：所有日期/月份/跨天判断走 `beijing-time.js`，禁用 `new Date().getMonth()` 等做业务判断。
- §2.5：写操作校验登录态 + 角色；员工只能操作自己的请假；`org_id` 从登录用户推导。
- §1.5：请假/工资/权限相关不空 catch 吞错。
- §1.7：AI 不部署云函数、不动生产；新云函数 action 与新集合由老板侧部署后生效。
- §1.8：Git 操作经确认后只提交本次相关文件。

---

## 8. 涉及文件清单
**后端**
- `cloudfunctions/salary/index.js` — 加 `getUserSalaryHistory`
- `cloudfunctions/attendance/index.js` — 加 7 个 leave action
- `cloudfunctions/attendance/leave.logic.js` —（新）纯函数
- `tests/leave.logic.test.js` —（新）单测

**前端**
- `miniprogram/app.json` — 注册新页：`pages/boss/employee-salary/employee-salary`、`pages/boss/leave-records/leave-records`、`pages/employee/leave/leave`
- `miniprogram/pages/boss/employees/*` — 员工卡片可点击进档案
- `miniprogram/pages/boss/employee-salary/*` —（新）工资档案页
- `miniprogram/pages/boss/salary/*` — 卡片加全勤/请假标 + 请假提醒红点入口
- `miniprogram/pages/boss/leave-records/*` —（新）老板请假列表
- `miniprogram/pages/boss/home/*` — 薪资入口未读红点
- `miniprogram/pages/employee/leave/*` —（新）员工请假页
- `miniprogram/pages/employee/home/*` — 加「请假」快捷入口
- `miniprogram/app.wxss` — 仅在缺标签样式时补 `.badge-attend-full`/`.badge-leave`

**文档**（改完更新）：`docs/VERSION_HISTORY.md`（必更）、`docs/PROJECT_MEMORY.md`（新增集合 `LeaveRecords` + 新 action + 新页）、必要时回写 CLAUDE.md §6。

---

## 9. 测试要点
- `leave.logic`：0 请假→全勤；多次提交累加；`cancelled` 不计；`canCancelLeave` 边界（含/不含今天）。
- `getUserSalaryHistory` 周期合计与现有按月/按订单口径一致（同输入同结果）。
- 权限：员工不能给他人请假 / 不能读老板汇总接口；boss 接口拒绝 employee。
- 北京时间跨月边界（月末 23:00 UTC 仍算次日北京）。

---

## 10. 待确认 / 风险
- **按订单模式下的「本月全勤」语义**：默认取当前自然月（订单跨月）。若老板更想要「该订单参与期间是否有请假」，需另算，本期先不做。
- 新增云函数 action 与 `LeaveRecords` 集合需老板侧部署后才生效（AI 不碰生产）。
- 全勤基于「主动请假」自报，依赖员工如实声明；打卡记录仍是兜底真相，老板可另查。
- 全部改动尚未在微信开发者工具真机验证。
