# 版本迭代记录

> 精炼记录每次有效改动，便于后续接手。详细技术方案、验收报告仍放在对应专题文档中。

## 维护规则

- 每次代码或数据库迁移改动完成后，必须追加一条记录。
- 记录保持简短：背景、改动、数据/部署影响、验证方式。
- 提交前确认本文件、`docs/PROJECT_MEMORY.md`、必要时 `docs/ARCHITECTURE.md` 已同步。

## 2026-06-14

### 已完成订单支持「恢复为进行中」+ 对应解开发薪锁

- 背景：订单误标/需补做时，`completed` 此前是绝对终态（§2.4），无法回到进行中。老板要求支持恢复，并把相关报工/工价锁对应打开。
- 口径确认（与老板）：恢复时，本订单**「按订单」已发薪记录一并改为未发薪**（解锁报工/工价改动）；**「按月」发薪是整月跨订单口径，不自动动**，仅统计并提示老板自行到工资页取消该月发放。
- 改动：
  - 纯函数（`order/pay-lock.logic.js`）：新增 `canChangeOrderStatus`（completed→active 合法且标记 reactivation；completed→cancelled 仍禁止；其余订单流转自由度不变）、`selectOrderScopedPaidPayments`、`findMonthLockedConflicts`，均带 `node:test`。
  - 后端（`order/index.js` `updateOrderStatus`）：用 `canChangeOrderStatus` 取代原「completed 即拒绝」硬拦；恢复分支 `releaseOrderPaymentLocksOnReactivate` 把本订单 `SalaryPayments{order_id,paid:true}` 批量改 `paid:false`（加 `released_by_reactivation/released_at/operator_*` 审计字段，与 `markPaid(paid:false)` 同口径），并返回 `month_locked_count/preview` 提示按月发薪仍锁定的报工。
  - 前端：订单列表新增「恢复」按钮（completed 显示）+ `onChangeStatus` 选「进行中」均走 `reactivateOrder` 强提示流程；订单详情「更多」菜单 completed 增「恢复为进行中」。两处都把后端按月锁定提示弹窗透传。
- 数据影响：恢复会把本订单按订单发薪记录置为未发薪（老板已知会，需重新核对发放）；新增 SalaryPayments 审计字段。完成锁、按月发薪锁口径其余不变。
- 部署影响：需重新部署 `order` 云函数 + 前端包。**尚未真机验证/部署。**
- 工程：`order/index.js`、`orders.js`、`order-detail.js` 编辑时由 CRLF 转 LF（符合 `.gitattributes eol=lf`）；逻辑改动看 `git diff --ignore-cr-at-eol`。
- 调试修复：初版「恢复」按钮点了没反应——根因是 `wx.showModal` 的 `confirmText` 最多 4 字，写成 `'恢复进行中'`(5字) 触发 fail 回调、弹窗根本不显示。改为 `'恢复'` 并新增静态守护测试 `tests/showmodal-button-text.test.js`（全局扫描 confirmText/cancelText ≤4 字）。
- 验证：`npm run test:unit` 全绿（225，新增 11）。**仍需在微信开发者工具重新编译，并部署 `order` 云函数后整链路才生效。**

### 登录页：按姓名自动回填登录信息 + 设备绑定密码

- 背景：每次手动输工厂码/姓名/手机号/密码太麻烦，希望输姓名后自动回填。
- 改动（`pages/login/login.js`）：
  - 新增本机 storage `factory_saved_login_map`（键=姓名小写）：每次**成功登录**与**强制改密成功**后保存该姓名的工厂码/手机号/密码 + 设备指纹。
  - 姓名输入 `onInputName` → `autofillByName`：命中则回填工厂码/手机号；**密码仅当前设备指纹吻合才回填**（`getDeviceFingerprint` = 品牌\|型号\|系统\|平台），异机只填前两项、密码手输。
  - 未用 IP 绑定：IP 随网络变不稳定、微信拿不到稳定真 IP；设备指纹才是「同一台手机」稳信号。
- 安全：密码明文存本机 storage（微信小程序沙箱隔离、仅本机）+ 设备指纹双重约束。换机/备份恢复到新机时指纹不符，不回填密码。
- 数据影响：无；纯前端本机存储。
- 部署影响：仅前端包，重新预览/上传生效。
- 工程：`login.js` 由 CRLF 转 LF。

### 员工端报工链路重构：首页订单卡 → 工序卡 → 报工 + 工序名高亮 + 搜索

- 背景：①员工首页直接平铺工序，长工序名看不全/显示乱；②希望先看订单再下钻工序。
- 改动（员工端）：
  - 首页「今日报工」由扁平工序列表改为**订单卡片**（`buildHomeOrderView` 按 order 分组，显示负责工序数/待报工数/累计已报），点击订单 `goToOrderProcesses` 进报工页（带 `order_id`/`order_name`）。
  - 报工页 `worklog` 改为「该订单的工序卡片列表」：`buildOrderProcessCards` 按订单筛选 + 关键词搜索（工序名/订单名）；工序名做成**蓝色高亮 pill**（`word-break` 完整展示，解决长名截断）；点击工序卡弹出报工弹窗（数量/快捷/剩余/预估/提交），提交后刷新卡片。保留 `process_id` 直达兼容。
  - 报工页新增搜索框（需求3）；历史报工页搜索本就存在（订单/工序/日期），老板报工管理删除能力本就存在。
- 工程：根治 CRLF——`.gitattributes` 增 `* text=auto eol=lf`，并把 `home.js` 由 CRLF 转 LF（故其 diff 显示整文件变化，实际逻辑改动十余行）。
- 数据影响：无；纯前端交互/展示。
- 部署影响：仅前端包，重新预览/上传生效（员工端报工/工序卡为新交互）。
- 验证：`npm run test:unit` 215 全绿（更新 2 条断言旧 UI 的测试，新增 `buildHomeOrderView`、`buildOrderProcessCards` 单测）。

### 发薪锁「按订单发薪记录 month 污染按月口径」跨订单误锁/误显示全链路修复

- 背景：复制已发薪订单后，副本订单「薪资管理显示未发薪」但「改工价被发薪锁拦截」，口径自相矛盾。
- 根因：按订单发薪的 `SalaryPayments` 记录也带发薪当月 `month`，被多处代码当成「整月已发薪/已锁」。
- 改动（统一口径：按月只认纯按月发薪记录无 `order_id`；按订单只锁该订单）：
  - 闸门 `order/pay-lock.logic.js` `buildPaidSets`：有 `order_id` 只进 orderSet。
  - 同步重写 `order/index.js` `syncZeroPriceWorklogsForProcess`：改用 `buildPaidSets`+`isWorklogPaid`（投影补 `order_id`），删除被取代的残缺口径 `reprice-worklogs.js` 及其测试。
  - 删改报工月兜底 `worklog/index.js` `getPeriodPaidRecord`：where 加 `order_id: _.exists(false)`。
  - 展示侧：`worklog` 管理页 `is_locked`（map key 带 user_id + 区分 order/month）、`salary` 月模式 `is_paid`（`getUserMonthlySalary` 与 `getUserMonthlySalaryByMonth` 月查询加 `order_id: _.exists(false)`）。
- 数据影响：无；纯判定/展示口径修正。已发薪报工仍被正确锁定。
- 部署影响：需部署 `order`、`worklog`、`salary` 三个云函数。
- 验证：`tests/order-pay-lock.logic.test.js` 新增复制订单/按月整月锁/同步重写三条回归；`npm run test:unit` 213 全绿。

### 老板侧工价绿色强调 + 报表表格行列对齐

- 背景：老板要求①全平台工价显示用绿色文字、字号加大醒目；②数据中心和导出报表所有表格单元格行列对齐、宽度合适（旧实现一处用内容自适应宽导致列错位、一处固定 150rpx 过窄）。
- 改动：`app.wxss` 新增语义类 `.price-strong`（`--green-600`、`--fs-sm` 28rpx、加粗，视觉 Token 体系内）；order-detail `process-price-pill` 与 worklog-manage `worklog-price-pill` 改绿底绿字 28rpx；worklog-manage/salary-detail 的「结算价/当前价」、data-center 工序进度工价、order-detail 工序汇总预览工价列全部套用 `.price-strong`。新增纯函数 `miniprogram/utils/table-meta.logic.js`：`buildTableColumnMeta(headers, rows)` 按每列最长内容（CJK=2 单位）统一计算列宽（150-460rpx 夹紧）、数字列右对齐/文本居中/首列左对齐、表头含「工价/单价」的列标记 isPrice；export 预览表、data-center 月年表与订单核算表三处表格全部接入（同列等宽=行列严格对齐，工价列绿色强调）。顺带修正 order-detail 编辑工序弹窗里过时的「修改单价不影响历史报工记录」提示为新口径。
- 数据影响：无；纯前端展示。
- 部署影响：仅前端包，重新预览/上传生效。
- 验证：新增 `tests/table-meta.logic.test.js`（6 用例）；`npm run test:unit` 203 项全绿（含 ui-apple-style 视觉回归）。

### 第1轮：P0 修复 + 改价拦截/发薪即完成/完成订单锁定（高风险区）

- 背景：code review 确认两个 P0（deleteOrder 无发薪/完成保护、改价静默重写未发薪历史报工且文案矛盾）；老板确认的 §2.2/2.3/2.4 口径待落地。
- 改动：新增 `order/pay-lock.logic.js` 纯函数（按月+按订单双模发薪集合、报工发薪命中、completed 判定、冲突预览文案）。`deleteOrder` 增加 completed 拒绝 + 订单级发薪记录拒绝 + 报工发薪冲突拒绝；`updateProcessPrice`/`updateProcess` 改价前命中任一已发薪报工整体拒绝（提示「该工序已发薪，单价不可修改」），未发薪同步重写并修正成功文案；`updateOrderStatus` 把 completed 设为终态；addProcess/deleteProcess/assignProcess/batchAssignProcesses/togglePriceHidden/clearOrderPrices/clearOrderWorklogs 统一拒绝 completed；`clearOrderWorklogs` 发薪检查升级为按月+按订单。`worklog.deleteWorkLog` 补 completed 锁+发薪锁；`updateWorkLog` 改用 `getWorklogPaidRecord`（覆盖订单发薪）+补 completed 锁；删除死代码 `isPeriodLocked`。`salary.markPaid` 返回 `order_fully_paid/order_status`（新纯函数 `isOrderFullyPaid`），老板工资页全员发薪后弹窗一键把订单置为已完成。
- 数据影响：无新字段；行为变化=以上拦截全部生效。
- 部署影响：需部署 `order`、`worklog`、`salary` 云函数 + 前端包。
- 验证：新增 `tests/order-pay-lock.logic.test.js`（7 用例）、`isOrderFullyPaid` 用例；`npm run test:unit` 全绿。

### 第2轮：导出报表重构 + 数据中心修复 + 实时工价（§2.9）

- 背景：数据中心「按订单」读取 `order.getDetail` 不存在的 `worklogs/total_amount/completion` 字段，永远显示 0/空；导出口径分散且每员工 2 次查库；老板要求所有报工/工资明细显示实时工价。
- 改动：`export` 月/年汇总改名「工资核算表」并加合计行、奖惩/考勤批量取数（消 N+1）；月/年明细加「结算单价/当前工价」两列（批量 join Processes）；订单汇总升级为「工资核算表」（数量/计件/奖励/处罚/应发+合计行，含仅奖惩员工）；订单明细标题改「报工核算表」；删除无前端调用的 legacy `getTableData`/`exportToFile`。数据中心「按订单」重写：订单卡片显示总量/工序数（替代恒为 0 的假金额），点入后用 `worklog.getOrderProgress` 渲染真实工序进度+实时工价+整体进度统计卡，「报工核算表/工资核算表」两个预览 chips 复用 `export.getTableDataV2`（与导出同一口径）。`worklog.getManageLogs`、`salary.getUserMonthlySalaryByBoss` 返回 `current_price/price_changed`；worklog-manage、salary-detail 明细行显示「结算价 · 当前价(不一致时)」。
- 部署影响：需部署 `export`、`worklog`、`salary` 云函数 + 前端包。
- 验证：`npm run test:unit` 全绿；数据中心/导出需真机回归（按订单两表、月/年表、Excel 导出）。

### 第3轮：鉴权统一（auth-guard）+ 登录限流加固

- 背景：鉴权逻辑 9 处手写副本分裂成三档强度，order/worklog/salary/export/qrcode/attendance 存在「缺凭证回退 openid」绕过踢下线，org 校验空 catch fail-open，platform 不校验调用者工厂状态；登录限流按姓名结尾正则（跨工厂误伤+可绕过）且 fail-open。
- 改动：新增唯一真源 `cloudfunctions/common/auth-guard.js`（强制 auth_user_id+auth_session_token、无 openid 回退、Organizations.status fail-closed），10 个云函数目录持相同副本并统一接入（部署约束同 beijing-time 模式）；删除 user/settings 两份 `auth.logic.js`；platform 接入同口径并禁止停用 org_platform/org_home。登录失败日志新增结构化 `rate_key=(工厂码/姓名/手机号)`，限流改等值计数 + 计数失败 fail-closed。
- 数据影响：audit_logs 新增 `rate_key` 字段（仅新日志）；**旧版本前端（本地无 session_token 的遗留登录态）将被要求重新登录**——这是有意的安全收口。
- 部署影响：需部署全部 10 个云函数 + login；新增 `tests/auth-guard-copies.test.js` 防副本漂移。
- 验证：`npm run test:unit` 全绿（197 项）。

### 第4轮：静默失败修复 + 时间口径收口

- 背景：callCloud 把完整云返回（含 session_token/openid/手机号）打进 console；app.js 启动恢复登录态时网络错误被空 catch 吞掉并强制登出（弱网冷启动被踢）；order-detail 工价变更时间用本地时区 new Date 且解析不了 serverDate 的 {$date}（显示空白）；订单时间线/超期、leaderboard 订单维度日期用设备/服务器本地时区。
- 改动：callCloud 只记录 code 不打返回体；resumeSession 网络错误保留登录态降级进入（仅云端明确 code!==0 才清退）；order-detail 工价历史改用 `bjTime.toUTCTimestamp+formatBeijingDateTime`；order-detail/orders 时间线改为「北京时间整天差」（新 `dateStrToDayNumber`，删除两份 `parseSafeDate` 副本）；leaderboard `toDateStr` 改走 beijing-time；billing `upsertPermanentSubscriptionForOrg` 在 Subscriptions 写入失败时**中止 permanent 标记**（防两边状态不一致），ensurePermanentHomeFactory/qrcode/leaderboard 等空 catch 补 console.error。
- 部署影响：需部署 `leaderboard`、`billing` 云函数 + 前端包。
- 验证：`npm run test:unit` 全绿。

### 第5轮：性能批量化 + 收尾

- 背景：listOrders 逐订单 count、getAssignedProcesses 逐工序查订单+分页报工、leaderboard 每员工×分页查库（N+1）；checkAbnormal 逐条串行 update；qrcode fallback 漏写 org_id（降级码扫码必被拒）；leaderboard/qrcode 缺 factory_settings 'main' 回退；salary `visiblePieceRate` 死代码；`report_lock_version` 只写不读无说明。
- 改动：listOrders/getAssignedProcesses/leaderboard 全部改为「一次批量拉取 + 内存分组聚合」；checkAbnormal 改 10 条/批并发更新（并注释说明全局扫描是有意设计）；qrcode fallback 补 `org_id`；qrcode/leaderboard 读 factory_settings 补 'main' 回退；删除 salary 死变量并注明「员工端总额含隐藏订单金额属有意口径」；report_lock_version 处注释「此 update 制造写冲突串行化并发报工，勿删」；billing/init 两份套餐种子互相加同步警示注释。
- 部署影响：需部署 `order`、`leaderboard`、`attendance`、`qrcode`、`salary`、`billing`、`init` 云函数。
- 验证：`npm run test:unit` 全绿（197 项）。剩余风险：session_token 无 TTL、callCloud 非幂等写重试、report_quantity 历史兜底、init 迁移脚本多租户化——均已记录在 CLAUDE.md §6。

## 2026-06-10

### 项目交接：重写 CLAUDE.md + 校正业务口径

- 背景：老板将项目全权交付长期维护，并口头确认/补充了若干高风险口径。
- 改动：按新结构重写根目录 `CLAUDE.md`（§2 高风险区集中收口业务口径，标注现状/目标/GAP）。新增/确认口径：①计件工资按 `quantity*snapshot_price`（确认，不按 `passed_qty`）；②改工序单价——已发薪工序/订单禁止改价并提示，未发薪改价同步重写该工序所有未发薪报工；③发薪即订单完成标志——订单全员发薪后弹窗提醒老板置为已完成；④已完成订单禁止删改任何相关数据；⑤老板侧所有报工/工资明细与统计需显示对应工序的实时工价 `Processes.current_price`。其中②③④⑤多为待补 GAP。
- 数据影响：无字段改动；②③④⑤为后续迭代项。
- 部署影响：仅文档；无需部署。

### 全量 code review 救火清单

- 背景：老板反馈代码有屎山味，要求做一次全量 code review 并救火（前端视觉风格不动）。
- 改动：多 agent 分维度扫描 + 对抗式复核（剔除 9 条误报），确认 43 条真实缺陷，按 7 个根因聚类，产出 `docs/CODE_REVIEW_2026-06-10.md`（含 2 个 P0、P1/P2 表、救火执行顺序）。2 个 P0：①`order.deleteOrder` 无发薪/完成保护会静默删已发薪报工+奖惩；②`syncZeroPriceWorklogsForProcess` 改工序价会重写所有未发薪历史报工 snapshot_price/amount 却提示「不影响历史报工」。根因 B/C/F 与老板已提的改价拦截/发薪即完成/导出重构/实时工价需求重叠。
- 数据影响：仅文档，未改代码。
- 部署影响：无。

### 登录页新增「忘记密码」入口

- 背景：用户忘记密码时无引导，不清楚如何重置。
- 改动：登录页密码框下新增右对齐「忘记密码？」入口，点击切换一个 on-brand 气泡，提示「忘记密码请联系工厂老板重置；若您是老板，请联系平台管理员协助」。复用既有 `#007AFF` 强调色与设计 Token，不改动整体视觉风格。
- 数据影响：无。仅前端 `pages/login/login.{wxml,wxss,js}`，新增 `showForgotTip` 状态与 `toggleForgotTip` 方法。
- 部署影响：前端需重新预览/上传小程序包；无云函数改动。
- 验证：`node --check` 通过；模拟器待真机确认气泡显隐。

## 2026-06-09

### 排行榜支持员工仅看本人排名

- 背景：员工需要看到自己的排名激励，但不应默认看到其他员工排名；老板仍需要可选择公开完整排行榜给全员。
- 改动：`leaderboard` 云函数改为先计算全员名次，再按查看者过滤：老板始终返回完整榜单，员工/QC 在 `leaderboard_visible=false` 时只返回本人条目、在开启时返回完整榜单；员工首页新增醒目的“我的排名”卡片，默认展示本月薪资排名并可进入排行榜页；员工排行榜页取消“暂未开放”阻断态；排行榜公开开关从系统设置页迁移到老板端排行榜页，并新增 `settings.updateLeaderboardVisibility` 窄口径保存动作。
- 数据影响：无新增字段；继续使用既有 `factory_settings.leaderboard_visible`，语义调整为“是否向员工公开全员榜”，关闭时员工仍可看本人排名。
- 部署影响：需部署 `leaderboard`、`settings` 云函数，并重新预览或上传小程序包后生效。
- 验证：新增排行榜隐私和员工首页排名卡逻辑测试，覆盖员工私密/公开返回范围、老板完整榜单、首页排名卡和开关迁移。

### 修复复制订单后工序分配展示顺序不一致

- 背景：订单详情复制订单会并发复制工序；副本详情按写入时间展示工序，在并发写库场景下工序顺序可能与源订单不一致，导致看起来工序分配没有完全照搬。
- 改动：复制工序前按详情页同一规则整理源工序顺序，复制时为副本写入 `Processes.process_sort_index`；订单详情读取工序时优先按该索引排序，旧订单缺少该字段时继续按原时间顺序回退；`assigned_user_ids` 仍原样复制。
- 数据影响：新增 `Processes.process_sort_index` 可选字段，仅用于工序展示顺序稳定；无需迁移旧数据，不参与报工、工资、统计或权限判断。
- 部署影响：需部署 `order` 云函数后，复制订单和详情排序修复在真机/体验版生效。
- 验证：新增订单复制和订单详情排序逻辑测试，覆盖复制分配同时保留顺序索引、旧订单时间排序兼容。

### 修复老板端报工编辑权限与订单详情底部弹窗偏移

- 背景：老板端修改员工报工记录时偶发提示“无权修改他人报工记录”；订单详情页点击“编辑工序”后底部编辑面板被全局居中弹窗 transform 推到屏幕左侧，只露出半屏。
- 改动：`worklog.getCallerUserByEvent` 在请求携带 `auth_user_id + auth_session_token` 时改为严格按指定账号解析，校验失败不再回退到同一 openid 最近登录的其它账号，避免老板账号被误识别为员工账号；订单详情的编辑工序、编辑订单、复制订单统一使用 `modal-bottom-sheet`，覆盖全局居中弹窗的 `left/top/transform/animation`。
- 数据影响：无新增字段或迁移；仅调整调用身份解析和前端样式。
- 部署影响：需部署 `worklog` 云函数后，老板端报工编辑权限修复在真机/体验版生效；前端需重新预览或上传小程序包。
- 验证：新增报工身份回退和订单详情底部弹窗样式回归测试；`npm run test:unit` 通过 171 项。

### 修复订单详情修改订单弹窗内容被截断

- 背景：订单详情页「编辑订单」底部弹窗内容超过 70vh 后，下半段表单和操作按钮不可见。
- 改动：订单详情的编辑工序、编辑订单、复制订单底部弹窗 body 改为 `scroll-view scroll-y`；全局 `.modal-sheet` 改为纵向 flex，标题和 footer 固定、body 负责滚动，避免其它普通弹窗内容变长时被 `overflow:hidden` 截断；新增全项目扫描测试，禁止继续写内联 `bottom:0` 的临时底部弹窗。
- 数据/部署影响：无数据影响；仅前端样式和 WXML 结构调整，重新预览或上传小程序包后生效。
- 验证：`node --test tests/ui-apple-style.test.js` 通过 16 项；`npm run test:unit` 通过 174 项。

## 2026-06-07

### 员工端报工记录改为历史总览

- 背景：员工端原报工页只展示今日报工记录，无法快速回看历史报工的总览和明细。
- 改动：员工端拆分两个独立页面：首页工序卡点击后带工序 ID 进入「计件报工」页，该页只保留提交报工表单并自动选中工序；快捷操作「历史报工」进入新增 `worklog-history` 页，只展示「报工总览 + 明细」，总览按订单+工序汇总并用工序卡片风格展示累计件数、金额、明细条数和最近日期；每条未锁定明细支持员工编辑数量或删除本条误报；员工端报工金额、产出和薪资统计通过 `salary_payroll_mode` 跟随老板端发薪机制，月发薪按本月统计，订单发薪按未完成且未发薪订单统计并展示订单工资明细。
- 数据影响：无新增字段；历史记录读取新增 `worklog.getUserPayrollLogs` 并仅由历史页调用，仍沿用订单完成后员工端隐藏已完成订单报工的规则；员工薪资读取新增 `salary.getUserPayrollSalary`，按模式分流到月度或订单汇总；`worklog.cancelOwnWorkLog` 不再限制只能撤销当天，但继续校验本人、工厂归属、订单未完成、月度/订单工资未发放。
- 部署影响：需部署 `worklog` 云函数后，员工删除历史报工的后端行为生效（本次未部署）。
- 验证：新增报工历史总览纯函数、页面结构和历史删除限制测试；`npm run test:unit` 覆盖。

### 发薪机制支持按月/按订单切换

- 背景：原薪酬管理只支持按月发薪；工厂需要保留按月发薪，同时可在系统设置中切换为按订单发薪。订单完成后，员工端不应继续看到该订单的工价和报工信息，但仍要能查看历史发薪记录。
- 改动：
  - 系统设置新增「发薪机制」分段 tab：`按月发薪` / `按订单发薪`，保存到 `factory_settings.salary_payroll_mode`；旧工厂缺省为 `monthly`。
  - 薪酬管理页读取发薪模式：按月模式沿用月份切换、`getAllMonthlySalary` 和月度 `markPaid`；按订单模式改为订单切换，调用新增 `salary.getAllOrderSalary`，`markPaid/getPaidStatus` 带 `order_id` 时按订单发薪。
  - `SalaryPayments` 在订单模式下新增可选字段 `order_id`、`order_name`、`payroll_type=order`、`total_amount`；原有月发薪记录和确定性 ID 兼容保留。
  - 员工首页工序进度改为展示本人负责工序在订单周期内「本人已报 / 本人剩余」；后端仍保留工序总量防超。
  - 员工端报工记录、今日收入、未发薪预估会过滤已完成订单；员工个人中心新增「历史发薪记录」，仅展示发薪周期、订单/月、金额和发放时间，不返回工序/工价/报工明细。
- 数据影响：新增设置字段与 `SalaryPayments` 可选字段，无迁移要求；旧设置默认按月，旧发薪记录仍按 `month` 查询。
- 部署影响：需部署 `settings`、`salary`、`order`、`worklog` 云函数后生效（本次未部署）。
- 验证：`npm run test:unit` 通过 162 项；新增/更新单测覆盖发薪模式默认值、订单发薪记录、员工首页本人进度、已完成订单报工过滤。

## 2026-05-31

### 按订单导出改为计件核算矩阵表

- 背景：原「按订单 · 明细表」是一行一条报工的扁平表（员工/订单/工序/数量…），核对计件工资时需要人工透视。参考工厂手写《计件工资核算表》，改为工序为行、员工为列的矩阵，更高效。
- 改动：
  - 新增纯函数 `cloudfunctions/export/order-matrix.logic.js` 的 `buildOrderMatrix`：工序为行（工序名带工价括号，如「去明线（0.05元）」，工价取 `Processes.current_price`）。**默认每个员工一列、单元格仅报工数量、表头只写员工姓名**（参考工厂手写核算表）；最右「合计」列（工序跨员工数量合计）、最底「合计」行（员工跨工序数量合计）；员工列按姓名拼音排序以保证导出稳定。保留可选 `options.includeAmount=true` 拆「数量｜金额」两列，金额 = `quantity * snapshot_price`（与既有计件工资口径一致，`passed_qty` 不参与），当前导出不启用。
  - `export` 云函数 `buildDetailByOrder`（`dimension=order` + `report_type=detail` 路径）改为调用该纯函数（仅数量），标题改为「订单-xxx 计件核算表」；其余维度（按月/按年）明细表不变。
  - 前端 `pages/boss/export/export`：订单维度下报表类型按钮、路径提示、导出确认中的「明细表」动态显示为「核算表」（新增 `detailLabel`），WXML 绑定 `{{detailLabel}}`；调用参数与接口（`report_type=detail`）不变。
  - 修复预览表格错位：原单元格用 `min-width/max-width` + `flex:0 0 auto`，每格按各自内容撑宽导致同列表头与数据列宽不一致；改为按列序固定列宽（首列工序 340rpx、其余 150rpx）并数字列居中，保证对齐。
  - 新增 `tests/export-order-matrix.logic.test.js`（`node:test`）覆盖表头/数量单元格/行列合计/多条累加/已删工序/零工价/空数据/排序/`includeAmount` 两列，共 12 项。
  - `package.json` 新增 `test:unit`（`node --test tests/*.test.js`）便于本地与后续 agent 跑逻辑单测。
- 数据影响：无新增集合或字段；不改 `WorkLogs`/`Processes` 数据。仅导出展示形态变化。`export_history` 记录的 `report_type` 仍为 `detail`。
- 部署影响：需在微信开发者工具「上传并部署」`export` 云函数后生效（本次未部署）。
- 验证：`node --test tests/*.test.js` 通过 155 项（含本次新增 11 项）；需在开发者工具按订单预览/导出核对矩阵、工价括号与合计。

## 2026-05-15

### 员工首页报工前置

- 背景：员工报工入口藏在快捷操作和报工页选择器中，上手步骤偏多，需要在首页直接看到本人负责的工序并提交数量。
- 改动：员工首页把考勤打卡放在报工入口之前且压缩成双按钮紧凑卡；顶部员工工作台收纳今日预估工资、本月累计工时和入厂时间，移除“今日状态”和下方重复概览；“今日报工”只展示本人负责工序卡片，点击某道工序直接跳转到完整报工页并携带 `process_id` 自动选中；工序卡展示订单、工价/隐藏状态、剩余可报、已报数量和进度，并移除首页工序卡的实体箭头字符。
- 数据影响：无新增集合或字段；报工提交仍在 `pages/employee/worklog/worklog` 中完成并写入既有 `WorkLogs`，继续沿用后端工序归属、订单状态、剩余额度和订阅限制校验。
- 验证：新增员工首页工序展示与页面结构纯逻辑测试；需在微信开发者工具确认打卡区位于报工区上方、点击首页工序卡可进入对应工序报工页。

## 2026-05-13

### 前端视觉系统重构

- 背景：各页面视觉语言碎片化，emoji 图标在不同设备显示不稳，样式大量重复拷贝，信息密度对中老年用户偏高。
- 改动：
  - app.wxss 建立完整设计 Token 体系（CSS 变量）：角色三色体系（boss 蓝/employee 绿/qc 紫）、功能色、6 档字体阶梯、4 档间距、3 档圆角、统一阴影和背景渐变。
  - 新增 templates/shared.wxml 共享组件（hero、data-card、menu-entry、empty-state、confirm-modal、subscription-strip 等）。
  - 新增 18 个 SVG 线框图标（/miniprogram/images/icons/），替换所有 emoji。
  - 老板首页、员工首页、薪资页、员工管理页、订单页、登录页 WXSS 大幅精简（总计 1,500+ 行 → ~250 行），业务样式收归 app.wxss。
  - util.js 新增 translateError 函数，将技术错误码映射为用户能理解的中文提示。
  - 危险操作弹窗新增 confirm-danger 模式（红色顶部边框）。
  - 新增骨架屏、通知条、分隔线等通用 UI 状态组件样式。
- 数据影响：无。未修改任何 JS 业务逻辑、云函数、数据库。仅修改 WXML 结构和 WXSS 样式。
- 验证：`node --test tests/*.test.js` 通过 123 项。

## 2026-05-11

### 订单详情一键清空报工

- 背景：需要在订单详情页快速删除某个订单关联的全部报工记录，并让工资、统计和导出读取同一套 `WorkLogs` 数据源后自然同步。
- 改动：新增 `order.clearOrderWorklogs` 云函数动作和订单详情页“ 一键清空报工记录 ”危险按钮；后端校验老板权限与订单工厂归属，删除前检查 `SalaryPayments.paid=true` 的员工月份，命中已发薪则拒绝清空；成功清空后写入 `audit_logs`。
- 数据影响：无新增字段；会删除该订单关联的 `WorkLogs`，不删除订单、工序、奖惩和发薪记录；工资、排行榜、数据中心和导出会因 `WorkLogs` 变化同步重算。
- 验证：新增清空报工纯逻辑测试，覆盖月份提取、删除 ID 收集、已发薪冲突识别和审计文案。

### 订单详情编辑 504003 修复

- 背景：订单详情修改总数量或起止日期后保存，部分大工序订单会返回云函数执行错误 `504003`。
- 改动：`order.updateOrder` 对历史字符串型 `total_quantity` 做数字化比较，数值不变时不再触发总量防超校验；确实修改总量时，将原来的逐工序查询报工改为按订单一次读取 `WorkLogs` 后按工序汇总，降低 150-200 道工序订单的云函数超时风险。
- 数据影响：无新增字段；继续写入既有 `Orders.total_quantity`，编辑保存时会将其规范为数字；兼容读取历史 `order_total_quantity`。
- 验证：新增订单更新逻辑回归测试，覆盖字符串数量不误判、旧字段兼容和工序报工汇总。

### 复制订单与发薪失败修复

- 背景：订单详情复制订单会在部分场景显示网络错误；薪资管理页勾选发薪后显示操作失败；需要顺手审查同类云函数调用错误展示。
- 改动：`order.copyOrder` 复制工序改为有界分批并发写入，并写回既有 `Processes.status=active`，避免大工序订单逐条串行写入超时且复制后工序不可报工；`salary.markPaid` 首次创建 `SalaryPayments` 时不再把不可写的 `_id` 放入 `set.data`；薪资页发薪失败展示后端具体错误；`callCloud` 区分网络传输失败、云函数执行失败和云函数超时，避免服务端异常一律显示为网络错误。
- 数据影响：无新增集合或字段；继续使用 `Orders`、`Processes`、`SalaryPayments` 既有字段；复制工序对历史缺失 `status` 的源工序默认写为 `active`。
- 验证：新增订单复制、发薪记录和云函数错误分类测试；`node --test tests/*.test.js` 通过 115 项；相关 JS 语法检查通过。

## 2026-05-02

### 登录页隐私勾选与订阅二维码替换

- 背景：小程序审核要求不得通过弹窗或默认状态强制同意隐私政策；服务订阅页需要更换为新的管理员微信二维码。
- 改动：登录页取消隐私协议弹窗，改为表单内显式勾选框，默认不勾选；用户勾选后沿用 `login.recordConsent` 写入授权记录，并在后续登录中记住同意状态；订阅页“联系管理员”弹窗二维码替换为新的微信二维码图片。
- 数据影响：无新增字段；继续使用 `privacy_consents` 记录隐私同意，继续使用本地隐私版本缓存做前端记忆；仅替换小程序静态图片资源。
- 验证：本地已通过登录页 JS 语法检查、全量 Node 测试和 diff 空白检查；仍需在微信开发者工具确认登录页默认未勾选、未勾选无法登录、勾选后可登录且下次进入保持已同意；订阅页联系管理员二维码显示为新图片。

## 2026-05-01

### 报工管理工序明细与老板修改

- 背景：老板需要从报工管理进度总览直接进入某道工序的报工明细，并帮助不熟悉手机操作的员工修正报工。
- 改动：进度总览每道工序可点击进入工序明细；工序明细按日期展示该工序下所有报工；报工管理页新增编辑和新增报工弹窗，老板可选择员工代新增，也可修改数量和备注并填写原因；后端 `getManageLogs` 支持按 `process_id` 查看工序报工。
- 数据影响：无新增字段；新增/修改仍写入同一条 `WorkLogs` 数据源，员工端、工资、统计和导出读取同源数据；`submit` 保持工序总量防超，`updateWorkLog` 保持发薪锁定与审计日志。
- 验证：需在微信开发者工具确认总览工序可进入明细，空工序可新增报工，已有记录可编辑，员工端记录同步变化。

### 工序分配选中与保存修复

- 背景：从订单详情某个未分配工序点击“去分配”后，还需要在分配面板顶部手动滑动查找该工序；批量保存分配时误报“存在无权分配的工序”。
- 改动：分配入口会携带当前工序 ID，打开分配面板后直接选中并滚动到该工序，当前工序名在员工选择区上方明确展示；员工选择区改为双列网格；`order.batchAssignProcesses` 改为按当前 `org_id` 查询工序并校验存在性，避免字段缺失导致误判权限。
- 数据影响：无数据库结构变化。
- 验证：需在微信开发者工具确认点击未分配工序可直接进入该工序分配，并能保存分配。

### 订阅联系管理员二维码

- 背景：老板端服务订阅页需要更直接地引导用户添加管理员微信，完成订阅开通沟通。
- 改动：新增管理员微信二维码静态资源；“联系管理员”改为弹出二维码弹窗，支持点击放大、长按识别/保存，并保留复制开通信息入口。
- 数据影响：无数据库变化。
- 验证：需在微信开发者工具确认二维码图片可显示、可预览、可长按识别。

### 订阅套餐规则收敛

- 背景：订阅制先试行试用版和标准版，飞盛自家工厂 `A001` 需要默认永久免费。
- 改动：默认套餐只保留试用版和标准版；试用版为 7 天、最多 10 名员工；标准版开放全部功能；平台列表和订阅云函数会把飞盛 `org_home/A001` 自动设为 `permanent` 永久免费。
- 数据影响：`Plans` 中基础版/专业版会被置为 `disabled`；`Organizations.billing_status` 新增运行态取值 `permanent`；试用版员工上限在 `user.create` 后端校验。
- 验证：需部署 `billing/platform/init/user` 云函数后，在平台管理页确认只显示试用版/标准版，并确认飞盛显示“永久免费”。

### 大工序订单页面性能巩固

- 背景：多工厂隔离后，每个工厂的单个订单需要稳定承载 150-200 道工序，并避免订单详情和工序分配页面卡顿。
- 改动：订单详情工序列表改为首屏分批渲染、点击加载更多；工序分配面板同样分批显示工序；保存分配由逐工序多次云函数调用改为 `order.batchAssignProcesses` 一次批量提交。
- 数据影响：无新增数据库字段；新增 `order.batchAssignProcesses` 云函数动作，仍校验 `org_id` 和员工归属，禁止跨工厂分配。
- 验证：需在微信开发者工具用 150-200 道工序订单实测滚动、分配和保存；本地已做语法与测试检查。

### 订阅开通保存失败修复

- 背景：平台管理页保存订阅时，云函数创建订阅集合遇到微信云开发 `DATABASE_COLLECTION_ALREADY_EXIST` 返回，导致“集合已存在”被误判为失败。
- 改动：`billing` 与 `init` 的建集合逻辑补充兼容 `-501001`、`ResourceExist`、`Table exist`、`DATABASE_COLLECTION_ALREADY_EXIST`，集合已存在时直接跳过。
- 数据影响：无数据结构变化；重复初始化或重复开通订阅前置检查更稳定。
- 验证：`billing`、`init` 云函数语法检查通过，现有 106 个测试通过。

### 登录态记忆与隐私确认规则修复

- 背景：小程序审核指出登录页存在“默认自动同意《用户服务协议》及《隐私政策》”风险，且用户希望首次登录后减少重复输入。
- 改动：登录页移除“登录即表示同意”文案，改为用户自主阅读后手动勾选；未勾选时无法继续登录；隐私政策和用户协议升级到 `2026-05-01-v2`；登录页记住上次工厂码、姓名、手机号，保留 token 自动恢复能力。
- 数据影响：新增本地缓存 `factory_last_login_info`，不保存密码；隐私同意版本升级后需用户重新确认一次，已有 token 不会因本地同意版本变化被立即清除。
- 验证：登录页不再出现默认同意文案；后续需在微信开发者工具确认审核截图位置已更新。

## 2026-04-30

### 订阅收费一期落地

- 背景：在多工厂隔离基础上，开始落地人工收款/一次性微信支付 + 平台后台手动开通的订阅模式。
- 改动：新增 `billing` 云函数、`migrate_billing_v1` 迁移、老板端服务状态页、老板首页/设置入口、平台端订阅开通/延期模块；新增套餐、订阅、收款记录和用量预留集合；到期后温和拦截新增订单/工序/员工/报工/考勤码生成。
- 数据影响：`Organizations` 增加订阅快照字段；新增 `Plans`、`Subscriptions`、`BillingOrders`、`UsageMonthly`；未迁移或 `not_enabled` 工厂不会被误拦截。
- 验证：已对新增/修改 JS 执行 `node --check`，并通过 `git diff --check`；小程序页面需在微信开发者工具部署云函数后联调。

### 纳入项目上下文资料

- 背景：多工厂原始方案和小程序审核素材仍处于未跟踪状态，不利于后续接手和项目记忆延续。
- 改动：纳入 `一期多工厂隔离重构方案_Codex.md` 与 `审核/` 素材目录，并在 `docs/PROJECT_MEMORY.md` 登记长期上下文用途。
- 数据影响：无代码、云函数或数据库变更；新增 1 份方案文档、1 个审核素材目录。
- 验证：确认审核目录包含 1 个 MP4 和 4 张 JPG；项目记忆已补充引用入口。

### 商业化订阅一期方案（文档）

- 背景：多工厂隔离完成后，需要规划人工收款/一次性微信支付 + 平台后台开通的商业化路径。
- 改动：新增 `docs/一期订阅收费迭代方案.md`，明确老板端订阅页入口、平台端开通能力、数据库模型、迁移方案、到期策略和合规边界。
- 数据影响：本次仅为方案文档，无数据库或云函数实际变更；后续实施需新增 `billing` 云函数、订阅集合及 `migrate_billing_v1`。
- 验证：已按产品完整性、技术完整性、迁移风险和小程序支付合规边界做自审。

## 2026-04-29

### `b1f1cae` 修复历史租户数据可见性

- 背景：多工厂隔离后，老工厂前端看不到部分历史报工、考勤、工序数据。
- 改动：增强 `init` 迁移，支持按 `order_id/user_id/process_id` 分批回填缺失 `org_id`；修复 `order/worklog/attendance` 对缺少排序字段的老数据兼容查询。
- 数据影响：已将老工厂历史 `Processes/WorkLogs/Attendances` 归回 `org_home`；分批动作 `migrate_missing_org_batch` 可重复执行。
- 验证：老工厂前端订单、工序、报工、考勤恢复可见；`node --test tests/*.test.js` 通过 106 项。

### `b3dba3c` 优化平台工厂管理

- 背景：平台管理员需要管理多个工厂，且管理页在手机端存在布局溢出。
- 改动：支持编辑工厂名、工厂码、联系人；增加选中态；平台管理页改为单列、大字号、大按钮结构。
- 数据影响：新增 `platform.updateOrganization`，工厂码变更会保持原 `org_id` 不变。
- 验证：平台管理页可选择工厂、编辑工厂资料、创建工厂管理员；测试通过。

### `a38628b` 一期多工厂隔离基础

- 背景：原系统为单工厂模型，需要隔离多工厂数据。
- 改动：新增 `Organizations`、平台管理员、工厂码登录、核心集合 `org_id` 隔离查询、默认老工厂 `org_home/A001` 与平台组织 `org_platform/PLATFORM`。
- 数据影响：历史单厂数据迁移到 `org_home`；新工厂数据按各自 `org_id` 独立。
- 验证：两个工厂功能链路独立；平台管理员可管理工厂；测试通过。
