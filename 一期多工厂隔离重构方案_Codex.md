# 一期多工厂隔离重构方案｜Codex 工程任务说明

## 0. 背景

当前项目是一个服装加工厂生产管理及薪酬结算微信小程序，原本只服务单个工厂。

现阶段目标不是马上做收费订阅 SaaS，而是先完成一期基础重构：

> 在保持原有小程序前端风格、交互习惯、页面结构和业务功能基本不变的前提下，增加“多个工厂独立并行使用”的能力，并确保不同工厂之间的数据完全隔离。

一期只做：

- 多工厂 / 多租户基础架构
- 工厂级数据围墙
- 平台管理员创建和管理工厂
- 历史数据迁移到默认工厂
- 为未来数据库迁移预留代码结构

一期不做：

- 付费订阅
- 套餐 Plans
- 微信支付
- 自动续费
- 发票
- 客户自助注册
- 复杂销售后台

---

## 1. 一期目标

### 1.1 产品目标

把当前单厂系统改造成：

```text
一个微信小程序
多个工厂独立使用
每个工厂有自己的员工、订单、工序、报工、考勤、工资、导出数据
不同工厂之间数据互相不可见
```

### 1.2 工程目标

1. 新增工厂 / 租户模型 `Organizations`。
2. 所有核心业务集合增加 `org_id`。
3. 登录方式改为：`工厂码 + 用户名 + 手机号 + 密码`。
4. 后端云函数必须从登录态解析 `currentUser.org_id`。
5. 所有查询、写入、更新、导出必须强制限定在当前用户所属 `org_id` 内。
6. 严禁依赖前端传入的 `org_id` 判断数据归属。
7. 平台管理员可以创建工厂、停用工厂、创建工厂管理员。
8. 工厂管理员只能管理本厂数据。
9. 员工和 QC 只能访问本厂授权范围内的数据。
10. 保持原有前端视觉风格和操作体验，仅在必要位置加入“工厂”概念。
11. 为未来从微信云数据库迁移到 PostgreSQL / MySQL / 独立后端预留结构。

---

## 2. 前端风格要求

这是本次重构的强约束。

### 2.1 保持原有小程序风格

本次一期重构不是重新设计 UI，不要重做视觉体系。

必须保持：

- 原有页面布局风格
- 原有按钮样式
- 原有卡片风格
- 原有颜色体系
- 原有字体大小和间距习惯
- 原有中文文案风格
- 原有员工端大字号、低学习成本、移动端优先的交互原则

### 2.2 只在必要位置增加“工厂”概念

需要新增或调整的前端位置主要包括：

1. 登录页增加 `工厂码` 输入框。
2. 首页展示当前工厂名称。
3. 平台管理员新增工厂管理入口。
4. 平台管理员页面新增工厂列表、创建工厂、停用工厂、创建工厂管理员。
5. 工厂管理员、QC、员工端的原有业务页面尽量不改变，只自动展示和操作本厂数据。

### 2.3 不允许过度改版

不要因为多工厂重构而重做以下页面风格：

- 员工首页
- 打卡页
- 报工页
- 订单页
- 工序分配页
- 数据中心
- 工资页
- 排行榜
- 导出页

这些页面只需要接入 `org_id` 隔离后的数据，不需要进行大幅 UI 改版。

---

## 3. 新增核心概念：Organization / Factory

### 3.1 新增集合：Organizations

新增集合 `Organizations`，表示一个工厂 / 租户。

推荐字段：

```js
Organizations {
  _id,
  org_name,             // 工厂名称
  factory_code,         // 工厂码，全平台唯一，例如 HOME001、A001
  contact_name,         // 联系人
  contact_phone,        // 联系电话
  status,               // active / disabled
  created_by,           // 创建者，通常是 platform_admin 的 user_id
  created_at,
  updated_at,

  // 一期暂不启用订阅，仅预留
  billing_status        // not_enabled
}
```

### 3.2 factory_code 规则

`factory_code` 是用户登录时输入的工厂码。

规则：

```text
factory_code 全平台唯一。
factory_code 用于定位 org_id。
factory_code 不应包含敏感信息。
factory_code 可以由平台管理员手动设置。
```

示例：

```text
HOME001：自家工厂
A001：测试一厂
B001：测试二厂
```

---

## 4. Users 集合改造

### 4.1 改造目标

原来的用户只属于单厂。现在每个用户必须归属于某个工厂。

### 4.2 推荐字段

```js
Users {
  _id,
  org_id,               // 所属工厂。平台管理员可为空或使用特殊 org_id
  username,
  name,
  phone,
  role,                 // factory_admin / qc / employee
  platform_role,        // platform_admin / null
  is_active,
  join_date,
  password_hash,
  password_updated_at,
  consent_version,
  consent_time,
  created_at,
  updated_at
}
```

### 4.3 角色定义

平台层角色：

```text
platform_admin
```

平台管理员可以：

- 创建工厂
- 停用工厂
- 查看工厂列表
- 创建工厂管理员
- 重置工厂管理员密码

工厂内角色：

```text
factory_admin
qc
employee
```

工厂管理员可以：

- 管理本厂员工
- 创建本厂订单
- 创建本厂工序
- 分配本厂员工
- 查看本厂数据中心
- 导出本厂数据
- 发薪确认

QC 可以：

- 查看本厂授权范围内的报工
- 录入 / 修改本厂质检数据

员工可以：

- 打卡
- 报工
- 查看本人本厂工资和排行相关信息

### 4.4 手机号唯一性

不要设置 `phone` 全平台唯一。

一期采用：

```text
factory_code + username + phone + password 登录
```

因此同一个手机号可以在多个工厂分别存在。

推荐唯一性规则：

```text
factory_code 全平台唯一
org_id + username + phone 唯一
phone 不做全平台唯一
```

这样可以支持：

```text
同一个人在 A 工厂有账号
同一个人在 B 工厂也有账号
两个账号数据互相隔离
```

---

## 5. 所有核心业务集合增加 org_id

以下集合必须增加 `org_id`：

```text
Users
Orders
Processes
ProcessAssignments
WorkLogs
WorkLogAudit
WorkLogEditAudit
AttendanceSessions
PayrollPayments
SalaryAdjustments
QrCodeRecords
AdminOperationLogs
```

### 5.1 Orders

```js
Orders {
  _id,
  org_id,
  order_name,
  start_date,
  end_date,
  total_quantity,
  status,
  created_at,
  updated_at
}
```

### 5.2 Processes

```js
Processes {
  _id,
  org_id,
  order_id,
  process_name,
  remark,
  current_price,
  is_active,
  created_at,
  updated_at
}
```

### 5.3 ProcessAssignments

```js
ProcessAssignments {
  _id,
  org_id,
  order_id,
  process_id,
  assigned_user_ids,
  updated_by,
  updated_at,
  created_at
}
```

### 5.4 WorkLogs

```js
WorkLogs {
  _id,
  org_id,
  user_id,
  process_id,
  order_id,
  submitted_qty,
  passed_qty,
  snapshot_price,
  period_key,           // YYYY-MM
  note,
  qc_status,
  qc_updated_at,
  created_at,
  updated_at
}
```

### 5.5 AttendanceSessions

```js
AttendanceSessions {
  _id,
  org_id,
  user_id,
  date_key,             // YYYY-MM-DD
  period_key,           // YYYY-MM
  clock_in_time,
  clock_out_time,
  duration_minutes,
  status,
  location,
  source,               // normal / qr
  qr_id,
  created_at,
  updated_at
}
```

### 5.6 PayrollPayments

```js
PayrollPayments {
  _id,
  org_id,
  user_id,
  period_key,
  order_id,
  gross_pay,
  adjustments_total,
  net_pay,
  paid,
  paid_time,
  paid_by,
  note,
  created_at,
  updated_at
}
```

### 5.7 SalaryAdjustments

```js
SalaryAdjustments {
  _id,
  org_id,
  user_id,
  period_key,
  order_id,
  amount,
  reason,
  date,
  created_at,
  updated_at
}
```

### 5.8 QrCodeRecords

```js
QrCodeRecords {
  _id,
  org_id,
  qr_id,
  status,
  page,
  scene,
  file_id,
  file_url,
  expire_at,
  created_by,
  created_at,
  revoked_by,
  revoked_at
}
```

### 5.9 AdminOperationLogs

```js
AdminOperationLogs {
  _id,
  org_id,
  operator_id,
  action_type,
  target_type,
  target_id,
  payload_summary,
  timestamp,
  ip,
  device
}
```

---

## 6. 登录改造

### 6.1 新登录方式

原登录方式：

```text
用户名 + 手机号 + 密码
```

一期改为：

```text
工厂码 + 用户名 + 手机号 + 密码
```

### 6.2 登录流程

后端流程：

```text
1. 根据 factory_code 查询 Organizations。
2. 如果工厂不存在，拒绝登录。
3. 如果工厂 status = disabled，拒绝登录。
4. 获取 org_id。
5. 在 Users 中按 org_id + username + phone 查询用户。
6. 校验 is_active。
7. 校验 password_hash。
8. 登录成功后返回 currentUser。
```

### 6.3 currentUser 必须包含

```js
currentUser = {
  user_id,
  org_id,
  org_name,
  factory_code,
  role,
  platform_role
}
```

### 6.4 安全要求

错误提示统一：

```text
账号或密码错误
```

不要提示具体是工厂码、用户名、手机号还是密码错误。

---

## 7. 数据围墙规则

这是一期最重要的后端规则。

### 7.1 不信任前端 org_id

禁止写法：

```js
const orgId = event.org_id
```

推荐写法：

```js
const currentUser = await getCurrentUser(context)
const orgId = currentUser.org_id
```

所有业务查询必须使用 `currentUser.org_id`。

### 7.2 查询列表时必须带 org_id

```js
await db.collection('Orders').where({
  org_id: currentUser.org_id
}).get()
```

### 7.3 查询详情时必须校验归属

```js
const order = await db.collection('Orders').doc(orderId).get()

if (order.org_id !== currentUser.org_id) {
  throw new Error('无权限访问该数据')
}
```

### 7.4 写入数据时必须由后端注入 org_id

禁止前端传入并决定 `org_id`。

```js
await db.collection('WorkLogs').add({
  data: {
    org_id: currentUser.org_id,
    user_id: currentUser.user_id,
    order_id,
    process_id,
    submitted_qty,
    period_key,
    created_at: new Date()
  }
})
```

---

## 8. 平台管理员能力

### 8.1 新增平台管理入口

平台管理员登录后进入平台管理视图。

保持原有前端风格，不需要做复杂后台系统。

一期最小功能：

```text
工厂列表
创建工厂
停用工厂
创建工厂管理员
重置工厂管理员密码
```

### 8.2 新增云函数

```text
platformCreateOrganization
platformListOrganizations
platformDisableOrganization
platformCreateFactoryAdmin
platformResetFactoryAdminPassword
```

### 8.3 平台操作日志

新增集合：

```js
PlatformOperationLogs {
  _id,
  platform_operator_id,
  action_type,
  target_org_id,
  payload_summary,
  timestamp
}
```

必须记录：

```text
创建工厂
停用工厂
创建工厂管理员
重置工厂管理员密码
```

---

## 9. 为未来数据库迁移做准备

一期仍然使用微信云开发数据库，但代码结构要避免和微信云数据库深度绑定。

### 9.1 前端不要直接写核心业务集合

以下集合不应由前端页面 JS 直接写入：

```text
Users
Orders
Processes
ProcessAssignments
WorkLogs
AttendanceSessions
PayrollPayments
SalaryAdjustments
AdminOperationLogs
QrCodeRecords
```

核心写操作必须通过云函数。

### 9.2 核心业务建议云函数化

建议整理以下云函数：

登录与账号：

```text
login
getCurrentUser
createFactoryUser
resetFactoryUserPassword
updatePassword
disableFactoryUser
```

平台管理：

```text
platformCreateOrganization
platformListOrganizations
platformDisableOrganization
platformCreateFactoryAdmin
```

订单与工序：

```text
createOrder
listOrders
getOrderDetail
updateOrder
createProcess
updateProcess
assignProcessUsers
```

报工与质检：

```text
submitWorkLog
listMyWorkLogs
listWorkLogsForAdmin
updateWorkLog
updateQcResult
```

考勤：

```text
clockIn
clockOut
listMyAttendance
listAttendanceForAdmin
```

工资与数据中心：

```text
getPayrollSummary
getPayrollDetail
markPayrollPaid
listDataCenter
exportPayroll
```

审计日志：

```text
writeAdminOperationLog
listAdminOperationLogs
```

### 9.3 建议建立 repository / service 层

推荐目录结构：

```text
cloudfunctions/common/auth/authService.js
cloudfunctions/common/auth/tenantGuard.js
cloudfunctions/common/auth/roleGuard.js

cloudfunctions/common/repositories/userRepo.js
cloudfunctions/common/repositories/orgRepo.js
cloudfunctions/common/repositories/orderRepo.js
cloudfunctions/common/repositories/processRepo.js
cloudfunctions/common/repositories/worklogRepo.js
cloudfunctions/common/repositories/attendanceRepo.js
cloudfunctions/common/repositories/payrollRepo.js
cloudfunctions/common/repositories/auditRepo.js

cloudfunctions/common/services/payrollService.js
cloudfunctions/common/services/worklogService.js
cloudfunctions/common/services/attendanceService.js
cloudfunctions/common/services/exportService.js
```

目的：

```text
前端只调用云函数。
云函数调用 service。
service 调用 repository。
repository 负责具体数据库读写。
```

未来如果从微信云数据库迁移到 PostgreSQL / MySQL，优先替换 repository 层。

---

## 10. 微信云开发环境承载策略

### 10.1 一期试行可以继续使用当前微信云环境

一期只是小规模试行多工厂隔离，可以继续把多个工厂的数据放在当前订阅的微信云开发环境里。

建议一期控制规模：

```text
最多 3-5 家试点工厂
每家最多 30-50 个员工
由平台管理员手动创建工厂
不开放客户自助注册
不承诺无限历史数据保存
```

### 10.2 但不能把当前云环境当成长期无限扩展底座

微信云开发存在容量、调用次数、云函数资源、流量等限制。

一期可以试行，二期或三期需要根据真实用量决定是否：

```text
升级微信云开发套餐
开启按量计费
迁移高频流水数据到外部数据库
最终迁移到独立后端 + PostgreSQL / MySQL
```

### 10.3 一期必须加用量统计

新增集合：

```js
UsageDaily {
  _id,
  org_id,
  date_key,
  user_count,
  worklog_count,
  attendance_count,
  export_count,
  created_at,
  updated_at
}
```

每天统计每个工厂的数据增长，用于后续判断成本和定价。

---

## 11. 历史数据迁移方案

当前已存储的数据属于自家工厂，不需要推倒重做，但必须迁移到默认工厂下。

### 11.1 创建默认工厂

```js
Organizations {
  _id: "org_home_xxx",
  org_name: "自家工厂",
  factory_code: "HOME001",
  status: "active",
  billing_status: "not_enabled",
  created_at: new Date(),
  updated_at: new Date()
}
```

### 11.2 给现有数据补 org_id

以下集合全部补：

```text
Users
Orders
Processes
ProcessAssignments
WorkLogs
WorkLogAudit
WorkLogEditAudit
AttendanceSessions
PayrollPayments
SalaryAdjustments
QrCodeRecords
AdminOperationLogs
```

补充规则：

```text
org_id = org_home_xxx
```

### 11.3 给历史流水补 period_key

WorkLogs：

```text
period_key = created_at 对应的 YYYY-MM
```

AttendanceSessions：

```text
period_key = clock_in_time 对应的 YYYY-MM
date_key = clock_in_time 对应的 YYYY-MM-DD
```

SalaryAdjustments：

```text
period_key = date 对应的 YYYY-MM；如果已有 period_key，则保留原值
```

PayrollPayments：

```text
如果已有 period_key，则保留；如果没有，则根据发薪归属月份补齐
```

### 11.4 迁移校验脚本

迁移后必须检查：

```text
是否存在 org_id 为空的 Users？
是否存在 org_id 为空的 Orders？
是否存在 org_id 为空的 WorkLogs？
是否存在 period_key 为空的 WorkLogs？
是否存在 period_key 为空的 AttendanceSessions？
是否存在 WorkLogs.order_id 指向不同 org_id 的 Orders？
是否存在 WorkLogs.user_id 指向不同 org_id 的 Users？
是否存在 PayrollPayments.user_id 指向不同 org_id 的 Users？
```

---

## 12. 索引建议

所有 SaaS 查询基本都是先按工厂过滤，因此复合索引里 `org_id` 应放在最前面。

建议索引：

```text
Users:
org_id + phone
org_id + username
org_id + role
org_id + is_active

Organizations:
factory_code
status

Orders:
org_id + status
org_id + created_at

Processes:
org_id + order_id

ProcessAssignments:
org_id + order_id
org_id + process_id

WorkLogs:
org_id + user_id + period_key
org_id + order_id + period_key
org_id + process_id + period_key
org_id + created_at

AttendanceSessions:
org_id + user_id + date_key
org_id + period_key

PayrollPayments:
org_id + user_id + period_key
org_id + period_key
org_id + paid

SalaryAdjustments:
org_id + user_id + period_key

AdminOperationLogs:
org_id + timestamp
org_id + action_type + timestamp
```

---

## 13. 串库测试要求

一期完成后必须做专门的隔离测试。

### 13.1 创建两个测试工厂

```text
A001：测试一厂
B001：测试二厂
```

分别创建：

```text
A 厂管理员
A 厂员工
A 厂订单
A 厂工序
A 厂报工

B 厂管理员
B 厂员工
B 厂订单
B 厂工序
B 厂报工
```

### 13.2 必须通过的测试

```text
A 厂管理员看不到 B 厂员工。
A 厂管理员看不到 B 厂订单。
A 厂管理员看不到 B 厂报工。
A 厂管理员导出的 Excel 不包含 B 厂数据。
A 厂员工看不到 B 厂工序。
A 厂员工不能提交 B 厂工序报工。
A 厂员工不能查看 B 厂工资。
B 厂员工不能访问 A 厂订单。
前端篡改 org_id 无效。
前端篡改 order_id，如果该 order_id 属于其他 org_id，后端必须拒绝。
停用工厂后，该工厂用户不能继续登录。
平台管理员可以创建和停用工厂。
```

---

## 14. 一期验收标准

一期完成的判断标准：

```text
1. 当前自家工厂历史数据已迁移到 HOME001。
2. 登录页支持工厂码 + 用户名 + 手机号 + 密码。
3. 平台管理员可以创建 A001、B001 等测试工厂。
4. 每个工厂可以创建自己的管理员、员工、订单、工序。
5. 工厂管理员只能看到和操作本厂数据。
6. 员工只能看到和操作本人、本厂数据。
7. 所有核心业务集合都有 org_id。
8. 所有核心云函数都从 currentUser 获取 org_id。
9. 前端不再直接写核心业务集合。
10. 串库测试全部通过。
11. 原有前端风格、核心页面布局和操作习惯保持一致。
12. UsageDaily 可以记录每个工厂的基础用量。
```

---

## 15. 开发顺序建议

### Step 1：代码审查

先找出：

```text
所有前端直接 db.collection 写核心集合的地方
所有云函数里未校验 role 的地方
所有查询未带 org_id 的地方
所有导出逻辑
所有工资计算逻辑
```

### Step 2：新增 Organizations 和默认工厂

创建 `Organizations` 集合，建立 `HOME001`。

### Step 3：历史数据迁移

给现有数据补 `org_id` 和必要的 `period_key`。

### Step 4：登录改造

改为：

```text
factory_code + username + phone + password
```

### Step 5：云函数增加 org_id 隔离

先改最核心链路：

```text
员工管理
订单管理
工序管理
报工
考勤
工资
导出
```

### Step 6：平台管理页面

新增平台管理员视图：

```text
工厂列表
创建工厂
停用工厂
创建工厂管理员
```

### Step 7：串库测试

创建 A001、B001，做隔离验证。

### Step 8：用量统计

增加 `UsageDaily`。

---

## 16. Git 工作要求

每次完成代码任务后，执行：

```bash
git status --short
git diff --stat
```

然后输出：

```text
1. 本次改动总结
2. 影响文件
3. 是否涉及数据库迁移
4. 是否涉及前端样式变化
5. 建议 commit message
```

不要自动执行：

```bash
git add
git commit
git restore
git reset
git clean
git push
```

只有在用户明确说“确认提交”后，才提交本次相关文件。

---

## 17. 重要约束总结

本次一期重构必须遵守：

```text
只做多工厂隔离，不做付费订阅。
保持原有前端风格，不重做 UI。
所有业务数据必须带 org_id。
后端必须从登录态读取 org_id。
不能相信前端传入 org_id。
同一个手机号可以存在于多个工厂。
前端不直接写核心业务集合。
历史数据迁移到 HOME001。
为未来数据库迁移预留 repository / service 层。
必须完成 A001 / B001 串库测试。
```
