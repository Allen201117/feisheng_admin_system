# 验收报告 - 第二批功能迭代

## 变更概览

| 编号 | 变更 | 状态 |
|------|------|------|
| 1 | 报工记录与薪资调整可编辑 | ✅ 已完成 |
| 2 | 工序分配弹窗点击修复 | ✅ 已完成 |
| 3 | 员工入厂时间字段 | ✅ 已完成 |
| 4 | 工序信息可编辑（名称/备注/单价）| ✅ 已完成 |

---

## 变更 1：报工记录与薪资调整可编辑

### 修改文件
- `cloudfunctions/worklog/index.js` — 新增 `updateWorkLog` action、`isPeriodLocked` 辅助函数
- `cloudfunctions/salary/index.js` — 新增 `updateAdjustment`、`deleteAdjustment` action
- `miniprogram/pages/employee/worklog/worklog.js` — 编辑弹窗状态与处理
- `miniprogram/pages/employee/worklog/worklog.wxml` — 编辑按钮、锁定图标、编辑弹窗 UI
- `miniprogram/pages/employee/worklog/worklog.wxss` — 编辑相关样式
- `miniprogram/pages/boss/salary-detail/salary-detail.js` — 报工编辑 + 调整编辑/删除
- `miniprogram/pages/boss/salary-detail/salary-detail.wxml` — 双弹窗 UI
- `miniprogram/pages/boss/salary-detail/salary-detail.wxss` — 弹窗 + 按钮样式

### 验收测试

#### 1.1 员工编辑当天报工
- [ ] 员工报工页面，当天记录显示「编辑」按钮
- [ ] 非当天记录不显示编辑按钮
- [ ] 点击编辑弹出弹窗，预填当前数量和备注
- [ ] 修改数量后需选择修改原因
- [ ] 选择「其他」原因可自由输入
- [ ] 保存后列表刷新，显示更新后的值
- [ ] audit_logs 中生成 `worklog_update` 记录

#### 1.2 已发薪月份报工锁定
- [ ] 已发薪月份的报工记录显示🔒图标和锁定原因
- [ ] 已发薪记录不显示编辑按钮
- [ ] 后端拒绝已发薪月份的编辑请求（返回锁定提示）

#### 1.3 Boss 编辑报工
- [ ] 薪资详情页每条报工显示「编辑」按钮（已发薪除外）
- [ ] Boss 可编辑任意未锁定月份的报工
- [ ] audit_logs 正确记录操作人

#### 1.4 Boss 编辑薪资调整
- [ ] 薪资详情页每条调整显示「编辑」「删除」按钮
- [ ] 编辑弹窗预填当前金额和原因
- [ ] **未发薪月份**：直接修改记录
- [ ] **已发薪月份**：显示冲正提示，保存后生成冲正记录 + 新修正记录
- [ ] 冲正记录标记 `is_reversal: true`

#### 1.5 Boss 删除薪资调整
- [ ] 确认弹窗显示删除确认
- [ ] **未发薪月份**：直接删除记录
- [ ] **已发薪月份**：生成冲正记录（反向金额），不删除原记录
- [ ] audit_logs 中生成 `adjustment_delete` 或 `adjustment_reversal` 记录

---

## 变更 2：工序分配弹窗点击修复

### 修改文件
- `miniprogram/pages/boss/order-detail/order-detail.wxml` — `catchtap="stopBubble"` + scroll-view
- `miniprogram/pages/boss/order-detail/order-detail.js` — 添加 `stopBubble()` 方法
- `miniprogram/pages/boss/order-detail/order-detail.wxss` — assign-item 样式优化

### 验收测试

- [ ] 点击「分配员工」弹出弹窗
- [ ] 弹窗内员工列表可正常点击选中/取消
- [ ] 员工项点击有 `:active` 反馈（灰色高亮）
- [ ] 员工列表超出时可滚动
- [ ] 点击弹窗外部（遮罩层）关闭弹窗
- [ ] 点击弹窗内部不会意外关闭
- [ ] 保存分配后审计日志记录 `process_assign`

---

## 变更 3：员工入厂时间

### 修改文件
- `cloudfunctions/user/index.js` — `updateJoinDate` action + getUser/listEmployees 返回 join_date
- `cloudfunctions/export/index.js` — 薪资导出增加「入厂时间」列
- `miniprogram/pages/boss/employee-edit/employee-edit.js` — 日期选择器处理
- `miniprogram/pages/boss/employee-edit/employee-edit.wxml` — 入厂时间日期选择 UI
- `miniprogram/pages/employee/home/home.js` — 加载并格式化入厂时间
- `miniprogram/pages/employee/home/home.wxml` — 显示入厂时间
- `miniprogram/pages/employee/home/home.wxss` — 入厂时间样式
- `miniprogram/pages/boss/employees/employees.js` — 列表项加入 join_date
- `miniprogram/pages/boss/employees/employees.wxml` — 显示入厂时间
- `miniprogram/pages/boss/data-center/data-center.js` — 薪资 tab 关联入厂时间
- `miniprogram/pages/boss/data-center/data-center.wxml` — 薪资卡片显示入厂时间

### 验收测试

#### 3.1 Boss 设置入厂时间
- [ ] 编辑员工页面显示「入厂时间」日期选择器
- [ ] 选择日期后保存，audit_logs 生成 `update_join_date` 记录
- [ ] 重新打开编辑页面能正确回显已设置的日期

#### 3.2 各页面显示
- [ ] 员工主页显示入厂时间（格式：YYYY年MM月DD日）
- [ ] 未设置时不显示入厂时间行
- [ ] Boss 员工列表每项显示入厂时间（未设置显示「未设置」）
- [ ] 数据中心薪资 tab 卡片显示入厂时间（有值时）

#### 3.3 导出
- [ ] 薪资导出 Excel 包含「入厂时间」列
- [ ] 未设置的显示「未设置」

---

## 变更 4：工序信息可编辑

### 修改文件
- `cloudfunctions/order/index.js` — 新增 `updateProcess` action、`addProcess` 支持 note 字段
- `miniprogram/pages/boss/order-detail/order-detail.wxml` — 编辑按钮 + 编辑弹窗 + 备注显示
- `miniprogram/pages/boss/order-detail/order-detail.js` — 编辑状态与处理方法
- `miniprogram/pages/boss/order-detail/order-detail.wxss` — 编辑弹窗 + 备注样式

### 验收测试

#### 4.1 编辑工序
- [ ] 每个工序卡片的「改价」按钮替换为「编辑」按钮
- [ ] 点击编辑弹出弹窗，预填当前名称、备注、单价
- [ ] 可修改名称、备注、单价的任意组合
- [ ] 保存后列表刷新，显示更新后的值
- [ ] 提示「修改单价不影响历史报工记录」
- [ ] audit_logs 生成 `process_update` 记录，含 old_values/new_values
- [ ] 无变更时提示「没有变更」

#### 4.2 备注字段
- [ ] 新添加工序时 note 字段存储为空字符串
- [ ] 工序卡片在有备注时显示备注行
- [ ] 无备注时不显示备注行

#### 4.3 snapshot_price 不受影响
- [ ] 修改工序单价后，历史报工记录的 snapshot_price 不变
- [ ] 新提交的报工使用修改后的 current_price 作为 snapshot_price

---

## 工程规范检查

- [ ] 所有写操作均有 boss 权限校验
- [ ] 员工编辑限制为仅编辑自己当天的报工
- [ ] 所有变更写入 audit_logs 审计日志
- [ ] 已发薪月份采用冲正机制，不修改原始记录
- [ ] 新增字段均有默认值兜底，向后兼容
- [ ] 前端 UI 与现有风格一致（大字号适老化）
- [ ] 无 XSS / 注入风险（仅通过云函数交互）

---

## 相关文档

- [db_changes.md](db_changes.md) — 数据库字段变更详细说明
