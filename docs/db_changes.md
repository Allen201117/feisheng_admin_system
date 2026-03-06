# 数据库变更说明

本次迭代涉及的数据库集合(collection)字段变更如下。所有变更均为**增量新增字段**，不修改、不删除现有字段，完全向后兼容。

---

## 一、Users 集合

| 字段 | 类型 | 说明 |
|------|------|------|
| `join_date` | String (YYYY-MM-DD) | 员工入厂时间，boss 设置 |
| `join_date_set_by` | String | 设置人 user_id |
| `join_date_set_at` | ServerDate | 设置时间 |

---

## 二、Processes 集合

| 字段 | 类型 | 说明 |
|------|------|------|
| `note` | String | 工序备注（如工艺说明），默认空字符串 |

> 已有字段 `process_name`、`current_price` 现支持在线编辑。

---

## 三、WorkLogs 集合

以下字段在**编辑报工**时写入，历史记录无此字段不受影响：

| 字段 | 类型 | 说明 |
|------|------|------|
| `updated_at` | ServerDate | 最近修改时间 |

> 已有字段 `quantity`、`note`、`process_id`、`order_id` 支持编辑，`snapshot_price` 不可修改。

---

## 四、SalaryAdjustments 集合

以下字段在**已发薪月份进行调整修改/删除时**自动生成的冲正记录中写入：

| 字段 | 类型 | 说明 |
|------|------|------|
| `is_reversal` | Boolean | 标记为冲正记录 |
| `original_id` | String | 原始被冲正的调整记录 _id |
| `is_correction` | Boolean | 标记为冲正后的新修正记录 |

---

## 五、audit_logs 集合

新增以下 `action` 类型：

| action 值 | 触发场景 | details 内容 |
|-----------|---------|-------------|
| `worklog_update` | 编辑报工记录 | 字段级变更详情 (quantity/note/process_id/order_id) |
| `adjustment_update` | 编辑薪资调整 | 金额/原因变更 |
| `adjustment_delete` | 删除薪资调整 | 原始金额、原因 |
| `adjustment_reversal` | 已发薪月份调整冲正 | 冲正金额详情 |
| `process_update` | 编辑工序（名称/备注/单价）| 字段级变更详情 |
| `process_assign` | 工序分配员工变更 | 旧→新员工 ID 列表 |
| `update_join_date` | 设置员工入厂时间 | 旧→新日期 |

audit_logs 记录结构新增可选字段：

| 字段 | 类型 | 说明 |
|------|------|------|
| `old_values` | Object | 变更前的字段值（process_update 使用） |
| `new_values` | Object | 变更后的字段值（process_update 使用） |
| `changes` | Array | 字段级变更记录（worklog_update 使用） |

---

## 注意事项

1. **无需迁移**：所有变更均为新增字段，代码中已处理字段不存在的默认值（如 `note || ''`、`join_date || '未设置'`）
2. **snapshot_price 不受影响**：WorkLogs 中的 `snapshot_price` 是报工时的冻结单价，修改 Processes 的 `current_price` 不影响历史计薪
3. **冲正机制**：已发薪月份的调整修改/删除采用冲正方式（添加反向记录），不修改或删除原始记录
