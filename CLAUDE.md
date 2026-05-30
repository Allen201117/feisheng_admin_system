# CLAUDE.md

本文件给在此仓库工作的 Claude / AI 代理使用，约定项目认知、铁律与工作流。**动手改任何代码前，先读完本文件，再读 `docs/PROJECT_MEMORY.md`、`docs/ARCHITECTURE.md`、`docs/VERSION_HISTORY.md`。**

## 项目定位

面向服装厂 / 加工厂的内部管理微信小程序（飞盛），业务闭环：**订单 → 工序报工 → 质检 → 工资核算 → 统计 → 报表导出**，并叠加考勤打卡、多工厂租户隔离与订阅收费。

- AppID：`wxdea72acb7b86befa`，云环境：`cloud1-5gr08st9c198f437`。
- 角色：`boss`（老板/管理员）、`qc`（质检）、`employee`（员工），另有 `platform_admin` 平台管理员（按 `platform_role` 判定）。

## 技术栈

- 前端：微信小程序原生开发（WXML / WXSS / JS），无框架。`style: v2`，`lazyCodeLoading: requiredComponents`。
- 后端：微信云开发 CloudBase 云函数，Node.js，`wx-server-sdk ~2.6.3`。
- 数据库：CloudBase 云数据库集合（见架构文档数据模型）。
- 导出 `xlsx ^0.18.5`；二维码 `qrcode ^1.5.3`。
- 测试：根目录 `jest` + `miniprogram-automator`（E2E）。

## 目录结构

```text
miniprogram/            小程序前端
  app.js / app.json / app.wxss   入口、路由、全局样式
  pages/{login,employee,qc,boss,platform,privacy-policy,user-agreement}/
  utils/                auth(登录态) / util(callCloud) / beijing-time / location / privacy / config
cloudfunctions/         云函数，每个目录一个函数，入口 index.js
  login user attendance order worklog salary leaderboard
  settings qrcode export billing init  (common/ 通用工具)
tests/                  Jest 业务逻辑测试 + tests/e2e smoke test
scripts/                微信开发者工具 CLI / 构建 / 预览 / E2E 封装脚本
docs/                   项目记忆、架构、版本历史、验收报告等（权威文档）
审核/                    小程序审核用截图与视频素材
一期多工厂隔离重构方案_Codex.md   多租户隔离原始工程方案
```

## 关键架构约定

- **调用链**：页面 → `utils/util.js` 的 `callCloud(name, data)` → 云函数 → CloudBase。`callCloud` 自动从本地登录态注入 `auth_user_id` 与 `auth_session_token`；云函数用 `getCallerUserByEvent` 校验 token + `status=active` + 所属 `Organizations.status=active`。
- **`.logic.js` 纯函数模式**：业务逻辑尽量抽到同目录 `*.logic.js`（不依赖 `wx`/`db`），由 `index.js` 或页面 `require` 引入，并在 `tests/` 用 Jest 单测。**新增可测业务逻辑时沿用此模式**，不要把复杂计算堆在页面层或散在带副作用的代码里。
- **多工厂隔离**：核心集合按 `org_id` 隔离，云函数用 `getOrgId(user)` 取租户。涉及多工厂/租户/平台管理/历史迁移，必须参考 `一期多工厂隔离重构方案_Codex.md`。
- **时间口径**：业务日期 / 跨天 / 月结 / 统计周期一律北京时间 UTC+8，统一走 `beijing-time.js`。禁止用 `new Date().getFullYear()/getMonth()/getDate()/getHours()` 等本地时区方法做业务判断。`db.serverDate()` 记真实时间戳，`toISOString()` 存时间点但展示/归属需转北京时间。

## 高风险区（改动前必须先确认口径并出 Plan）

工资 / 权限 / 时间 / 统计 / 导出 / 数据库字段 / 订单删除 / 发薪锁定。

- **工资口径**：当前计件工资按 `WorkLogs.quantity * snapshot_price`，**不是** `passed_qty`（合格数仅用于质量统计）。这是最高风险点，改动前必须业务确认。
- **发薪锁定**：`SalaryPayments.paid=true` 后报工修改受限；已发薪月份奖惩改/删走冲正记录（`is_reversal`/`is_correction`），不改原记录。
- **删除规则**：`order.deleteOrder` 连带删工序/报工/奖惩；`order.clearOrderWorklogs` 命中已发薪月份会拒绝。
- **权限**：所有写操作必须校验登录态 + 角色；员工只能访问自己的数据；QC 不得默认拥有 boss 权限。部分订单/工序/工价读接口权限边界仍待加固。
- **统计口径漂移**：工资/排行榜/数据中心/导出有多套聚合实现，禁止再复制第四套，优先复用或抽象统一逻辑。
- **隐私合规**：登录/手机号采集/协议页禁止「登录即同意」「默认同意」「自动同意」文案；勾选框默认未勾选，由用户手动确认。

## 工作流铁律（来自 docs/DEVELOPMENT_RULES.md）

1. 改代码前先读 `PROJECT_MEMORY.md` + `ARCHITECTURE.md`，确认涉及哪些高风险区。
2. **先出 Plan 再改**：说明修改范围、涉及文件、数据字段、旧数据兼容方式、测试路径。
3. 禁止：猜字段/猜口径/猜权限；一次性大规模重构；复制第二套工资/考勤/统计/导出逻辑；空 `catch` 吞错；私改工资/计薪/发薪/权限/时间口径。
4. 新增字段必须说明：用途、来源、写入位置、读取位置、默认值、旧数据兼容方式。
5. 完成后同步文档：先更 `docs/VERSION_HISTORY.md`；涉及架构/字段/权限/业务口径/时间/统计/删除规则时，同步更新 `PROJECT_MEMORY.md` 和/或 `ARCHITECTURE.md`。
6. 交付说明写清：改了什么、为什么、怎么测、还有什么风险。小功能单独小步提交。

## Git 约定

每次完成任务后自动执行并汇报：`git status --short`、`git diff --stat`、改动总结、建议 commit message。

**未经用户明确确认，禁止执行**：`git add` / `git commit` / `git restore` / `git reset` / `git clean` / `git push`。用户说「确认提交」后只提交本次相关文件（禁止 `git add .`），提交后再输出 `git status --short`。

当前分支 `main`；另有 `codex/apple-design-refresh-*` 等设计分支。

## 测试与自动化命令

```bash
npm run test:unit     # node:test 逻辑单测（tests/*.test.js，纯函数，无需开发者工具）
node --test tests/xxx.test.js   # 跑指定逻辑单测（项目用 node:test，不是 jest）
npm run test:e2e      # Jest E2E smoke test（仅验证首页可打开，不绕登录、不写库；需 Mac 上开发者工具）
npm run wx:check      # 检查项目结构 / CLI / 服务端口 / Node / Jest
npm run wx:open       # 用微信开发者工具 CLI 打开项目
npm run wx:build-npm  # 构建 npm
npm run wx:preview    # 仅预览，不 upload
```

微信开发者工具服务端口 `48909`，自动化端口 `9420`（详见 `docs/DEVTOOLS_AUTOTEST.md`）。

**禁止 AI 自动执行**：小程序 `upload` / 正式发布 / 部署或删除云函数 / 清空数据库 / 改生产云环境 / 改 appid / 改线上环境 ID / 写真实生产数据。涉及写库或生产的测试必须先单独设计隔离方案并获明确授权。

## 关键文档索引

- `docs/PROJECT_MEMORY.md` — 项目记忆，功能/路由/云函数 API/集合字段/P0-P2 风险清单（必读）。
- `docs/ARCHITECTURE.md` — 架构、数据流、数据模型、时间口径、架构风险（必读）。
- `docs/VERSION_HISTORY.md` — 版本与迭代记录（每次改完先更新）。
- `docs/DEVELOPMENT_RULES.md` — 开发规则全文。
- `docs/DEVTOOLS_AUTOTEST.md` — 开发者工具自动化自测说明。
- `一期多工厂隔离重构方案_Codex.md` / `docs/一期订阅收费迭代方案.md` — 多租户与订阅收费专项方案。
