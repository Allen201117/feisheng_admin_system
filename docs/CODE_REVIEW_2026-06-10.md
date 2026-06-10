# 全量 Code Review 救火清单（2026-06-10）

> 多 agent 分维度扫描 + 对抗式复核（剔除 9 条误报）后确认的 **43 条真实缺陷**。
> **前端视觉风格不在审查范围。** 按根因聚类，救火应打根因、不逐条打补丁。
> 状态标记：⬜ 待修 / 🔧 进行中 / ✅ 已修。

## 🟢 2026-06-11 救火执行结果（五轮全部完成，明细见 VERSION_HISTORY 当日条目）

- ✅ **P0-1 / P0-2 已修**；根因 B（删除/改价/发薪锁）全部收口（含 §2.2/2.3/2.4 三条业务口径落地）。
- ✅ 根因 A 鉴权统一：`common/auth-guard.js` 唯一真源 + 10 份一致副本 + 副本一致性测试；openid 回退全部移除；org 校验 fail-closed；platform 同口径并保护 org_platform/org_home；登录限流 rate_key 等值 + fail-closed。
- ✅ 根因 C+F：export 重构（工资核算表/报工核算表/合计行/实时工价列/删 legacy）、数据中心按订单视图重写（真实进度+两表预览，复用 getTableDataV2 不加第 5 套口径）、订单卡片假金额移除。
- ✅ 根因 D+E：callCloud 日志脱敏、resumeSession 网络错误不再误登出、order-detail/orders/leaderboard 时间口径走 beijing-time、billing permanent 状态不一致风险阻断、关键空 catch 补日志。
- ✅ 根因 G：listOrders/getAssignedProcesses/leaderboard N+1 批量化、checkAbnormal 分批并发、qrcode fallback 补 org_id、main 回退补齐、死代码清理（visiblePieceRate/isPeriodLocked/legacy export）、report_lock_version 与双份套餐种子加防误删/防漂移注释。
- ⬜ **仍开放**（低优先级/需业务确认）：session_token 无 TTL；callCloud 非幂等写网络重试可能重复提交；`report_quantity` 历史兜底（需确认存量数据后迁移或删除）；init 迁移脚本写死 'main'（一次性运维脚本，再次使用前需按 org 遍历重写）；markPaid `total_amount` 为发放时快照（语义已可接受，UI 标注可后补）；员工端工资总额含隐藏订单金额（有意口径，已在代码注释说明）。

## 0. 一句话结论

代码能跑，但有 **2 个 P0（会静默改/删工资数据）** 必须先堵；其余 41 条九成可归到 **7 个根因**，其中根因 B/C/F 正好和老板已提的「改价拦截 / 发薪即完成 / 导出重构 / 实时工价」需求重叠——**救火和做需求是同一批活**。

---

## 1. P0（最高优先，数据会被静默破坏）

| # | 标题 | 位置 | 后果 | 修法 | 状态 |
|---|---|---|---|---|---|
| P0-1 | `deleteOrder` 无发薪/完成保护，连带物理删已发薪报工+奖惩冲正凭证 | `cloudfunctions/order/index.js:499-553` | 老板删历史订单=静默销毁已发薪月份计件凭证，工资对不上账、不可逆（只剩一条审计文本） | 删前复用 `buildPaidMonthSet`+`findPaidWorklogConflicts`，命中已发薪/`completed` 直接拒绝；或改软删 `status=archived` 保留 WorkLogs/Adjustments。**= 老板需求 §2.4** | ✅ |
| P0-2 | `syncZeroPriceWorklogsForProcess` 名不副实：改工序价会重写**该工序所有未发薪历史报工**的 snapshot_price/amount，界面却显示「不影响历史报工」 | `cloudfunctions/order/index.js:452-497` + `reprice-worklogs.js:15-23` | 工资被静默改写且与提示/验收文档矛盾，最高风险工资口径 | 按老板口径 §2.2：命中**已发薪**整体拒绝+提示；未发薪允许并同步重写（去掉误导文案）。**= 老板需求 §2.2** | ✅ |

---

## 2. 根因聚类 + 救火路线

### 根因 A — 鉴权碎片化（9 份 `getCallerUserByEvent` 副本，强度三档不一）
最大结构病根，衍生下列：

| 严重度 | 标题 | 位置 |
|---|---|---|
| P1 | 缺 auth 凭证时回退「仅 openid」认证，绕过 session_token（踢下线被架空） | order/worklog/salary/qrcode/export |
| P1 | `getCallerUserByEvent` 内 Organizations 状态校验失败被空 catch 吞掉→回退 openid（fail-open 降级，停用工厂可在异常窗口通过） | order/export/qrcode/salary :53/:38/:36/:56 |
| P2 | session_token 永不过期，无 TTL | login + 各 getCaller |
| P2 | platform `getCaller` 不校验调用者自身 org status（停用 org_platform 仍可全平台操作） | platform/index.js:25-48 |
| P2 | `settings.getPublic` 无效调用者时回退读硬编码 `main` 工厂设置 | settings/index.js:69-86 |
| P2 | qrcode `getLatest/revoke` token 失效时静默回退 openid | qrcode/index.js:18-39 |
| P2 | 登录限流 fail-open + 跨工厂正则 + 只按 name（可绕过 / 可 DoS 锁同名账号） | login/index.js（**注：限流本身建议提到 P1**） |

> **救火动作**：`cloudfunctions/common/` 落**唯一** auth 模块（强制 token、校验 org active、统一 fail-closed、可选 TTL），各云函数 require 同一份，删 8-9 份副本 + 2 份 `auth.logic.js`。一次重构消灭 6+ 条。

### 根因 B — 删除/改价/发薪锁口径不统一（高风险工资区，含 2 个 P0）
| 严重度 | 标题 | 位置 |
|---|---|---|
| P0 | deleteOrder 无保护（见 P0-1） | order/index.js |
| P0 | 改价重写未发薪历史（见 P0-2） | order/index.js |
| P1 | `deleteWorkLog`（老板删报工）完全无发薪锁 | worklog/index.js:1041-1080 |
| P1 | 三条改删报工路径锁口径不一（按月 / 按 paid_at 时间序 / 无锁） | worklog/index.js:472,1058,1166 |
| P2 | `completed` 订单写禁止未统一（boss 侧改价/删/分配可穿透） | order/index.js |
| P2 | `ensureWritableEntitlement` 只挡 create/copy/addProcess，改价/删/改报工绕过订阅墙 | order/worklog |

> **救火动作**：抽 `isWorklogPayLocked(log,orgId)`（覆盖月+订单+时间序）和 `ensureOrderWritable(order)`（completed/已发薪即拒），所有删/改/价/分配入口统一调用。**这块就是老板需求 §2.2/2.3/2.4 的落地。**

### 根因 C — 统计聚合多套副本（口径已第 4 套）
| 严重度 | 标题 | 位置 |
|---|---|---|
| P1 | leaderboard salary 维度内联第 4 套 `quantity*snapshot_price` + N+1 查库 | leaderboard/index.js |
| P2 | export 汇总每员工 2 次查库（第二套实现，N+1） | export/index.js:126-159 |
| P2 | export 逐条 round2 vs order-matrix 先累加后 round2（对账差分位） | export/index.js:131 / order-matrix.logic.js |

> **救火动作**：抽统一计件聚合纯函数，leaderboard/export 复用 `salary/period-statistics.js`。**和导出重构一起做。**

### 根因 D — 前端绕过北京时间口径（用设备本地 Date）
| 严重度 | 标题 | 位置 |
|---|---|---|
| P2 | 工价变更记录时间用 `new Date().getXxx`，且 serverDate `{$date}` 被解析成 Invalid Date→空白 | order-detail.js:736-745 |
| P2 | 订单时间线/超期天数依赖设备本地时区 | order-detail.js / orders.js |
| P2 | leaderboard order 维度 `toDateStr` 本地时区，跨天订单边界错位一天；`completed_at` 从不写入→上界恒 2099 | leaderboard/index.js:12-15,116 |
| P2 | beijing-time 整体锚点是设备时钟，无服务器校准 | utils/beijing-time.js:18-49 |

> **救火动作**：前端业务时间统一走 `beijing-time.js`（`formatBeijingDateTime` 已能吃 `{$date}`）；关键业务月份/今日取值考虑服务端权威时间或启动拉一次 server time 做 offset。

### 根因 E — 静默失败 / 吞错（含 1 条安全红线）
| 严重度 | 标题 | 位置 |
|---|---|---|
| P1 | `callCloud` 默认把整段云返回 JSON 打到 console，**泄漏 session_token/openid/phone** | utils/util.js:174 |
| P1 | app.js 启动恢复登录态时网络错误被空 catch 吞掉→强制登出（弱网冷启动被踢） | app.js:74-84 |
| P2 | init/billing 多处空 catch，订阅 permanent 标记与 Subscriptions 可能不一致 | billing/index.js, init/index.js |

> **救火动作**：删/脱敏 callCloud 日志（仅 debug 模式）；app.js 区分 transport 错误不清登录态；空 catch 至少 `console.error` 带上下文。

### 根因 F — 数据中心 / 导出具体 bug（老板点名「数据中心打不开」）
| 严重度 | 标题 | 位置 |
|---|---|---|
| P1 | 数据中心「按订单」永远空：`order.getDetail` 不返回 `worklogs`，页面却读 `detail.worklogs` | data-center.js:208-216 |
| P2 | Orders 无 `total_amount` 字段，数据中心订单卡片金额恒 ¥0.00 | order/index.js + data-center.js:177 |
| P2 | export 两套实现并存，legacy `getTableData/exportToFile` 已无前端调用（死代码） | export/index.js |

> **救火动作**：随导出/数据中心重构一并修；按订单详情改调 `worklog.getManageLogs(order_id)` 取真实报工。

### 根因 G — 性能 / 重复定义（规模放大后才痛）
| 严重度 | 标题 | 位置 |
|---|---|---|
| P2 | `listOrders`/`getAssignedProcesses` N+1 逐订单查库 | order/index.js |
| P2 | leaderboard 按「员工数×分页」嵌套查库 N+1 | leaderboard/index.js |
| P2 | `checkAbnormal` 定时任务全表扫描+逐条 update，无分批/续跑 | attendance/index.js:882-914 |
| P2 | qrcode fallback 路径漏写 org_id（降级二维码扫码签到必被拒） | qrcode/index.js:237-252 |
| P2 | qrcode `verify` 跨租户（低危信息泄漏，打卡侧已拦） | qrcode/index.js:432-470 |
| P2 | leaderboard/qrcode 缺 `factory_settings` 的 `main` 回退 | leaderboard/qrcode |
| P2 | billing 与 init 两份 `DEFAULT_PLANS`/seed 逻辑易脱节 | billing/init |
| P2 | init migrate_v2/location/timezone 写死 `main`+全表扫描，多租户下无效/超时 | init/* |
| P2 | `report_lock_version` 只写不读（并发防护靠写冲突碰巧生效，误导后人） | worklog/index.js:356,1281 |
| P2 | `report_quantity` 兜底仅配额校验生效，工资/导出不兜底（潜在历史脏数据隐患） | worklog/index.js:229 |
| P2 | `getUserMonthlySalary` 脱敏不一致 + `visiblePieceRate` 死代码 | salary/index.js:548-568 |
| P2 | `markPaid` 的 `total_amount` 是发薪快照，冲正后不刷新（语义需标注） | salary/index.js |
| P2 | `callCloud` 对非幂等写操作也网络重试，存在重复提交风险（recordConsent/addProcess） | utils/util.js |

---

## 3. 建议执行顺序（救火与需求合并）

1. **第 1 轮 — P0 + 老板 §2 需求**（根因 B）：改价拦截已发薪、deleteOrder 保护、completed 锁定、发薪即完成提醒、deleteWorkLog/三路径锁统一 → 抽 `isWorklogPayLocked` + `ensureOrderWritable`。TDD 走 `.logic.js`。
2. **第 2 轮 — 导出/数据中心重构**（根因 C+F）：修数据中心按订单空、订单金额、报工核算表/工资核算表、清死代码、统一聚合，并接入**实时工价**显示（§2.9）。
3. **第 3 轮 — 鉴权统一**（根因 A）：common/ 单一 auth，删副本，堵 openid 回退 + fail-closed + 限流加固。
4. **第 4 轮 — 静默失败 + 时间口径**（根因 D+E）：callCloud 日志脱敏、app.js 不误登出、前端时间走 beijing-time。
5. **第 5 轮 — 性能/收尾**（根因 G）：N+1、定时任务分批、重复定义收敛、qrcode fallback org_id 等。

每轮小步提交、跑 `npm run test:unit`、改完更 `VERSION_HISTORY.md`。
