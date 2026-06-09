# 微信开发者工具自动化自测说明

## 当前目标

为「飞盛_Codex」建立可重复使用的微信开发者工具 CLI、`miniprogram-automator` 和 Jest 自测闭环。后续 agent 可以用固定命令做项目检查、打开项目、构建 npm、预览和 E2E smoke test。

## 固定环境

- 微信开发者工具服务端口：`48909`
- 默认 CLI 路径：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`
- 项目根目录由脚本自动识别，也可以用 `PROJECT_ROOT=/path/to/project` 覆盖。
- E2E 自动化 WebSocket 默认端口：`9420`，可用 `WX_AUTOMATOR_PORT` 覆盖。
- CLI、端口可通过环境变量覆盖：

```bash
WX_CLI=/custom/path/cli npm run wx:check
WX_DEVTOOLS_PORT=48909 npm run wx:check
WX_AUTOMATOR_PORT=9420 npm run test:e2e
```

## 手动开启服务端口

1. 打开微信开发者工具。
2. 打开当前小程序项目。
3. 进入「设置」或「安全设置」。
4. 开启「服务端口」。
5. 确认端口为 `48909`，或运行命令时用 `WX_DEVTOOLS_PORT` 覆盖。

## 常用命令

```bash
npm run wx:check
npm run wx:open
npm run wx:build-npm
npm run wx:preview
npm run wx:e2e
npm run test:e2e
```

## 命令用途

- `npm run wx:check`：检查项目结构、CLI、服务端口、Node/npm、Jest 和 `miniprogram-automator`。
- `npm run wx:open`：通过微信开发者工具 CLI 打开当前项目。
- `npm run wx:build-npm`：通过 CLI 构建 npm；如果当前 CLI 不支持，会提示手动执行「工具 -> 构建 npm」。
- `npm run wx:preview`：只执行 preview，不会执行 upload。
- `npm run wx:e2e`：运行 `npm run test:e2e`。
- `npm run test:e2e`：运行 Jest E2E smoke test。

说明：`WX_DEVTOOLS_PORT` 是微信开发者工具安全设置里的服务端口；`WX_AUTOMATOR_PORT` 是 `miniprogram-automator` 与开发者工具连接用的自动化端口。

## 安全命令

当前自动化只允许执行：

- 项目结构检查
- 打开本地项目
- 构建 npm
- 预览
- smoke test

## 禁止 agent 自动执行

- `git add`
- `git commit`
- `git push`
- `git reset`
- `git clean`
- 微信小程序 `upload`
- 正式发布小程序
- 部署或删除云函数
- 清空数据库
- 修改生产云环境
- 修改 appid
- 修改线上环境 ID
- 写入真实生产业务数据

## 常见错误与排查

- CLI 不存在：确认微信开发者工具安装路径，或用 `WX_CLI=/custom/path/cli` 覆盖。
- 服务端口不可访问：确认微信开发者工具已打开，并在安全设置中开启服务端口。
- 端口不是 `48909`：用 `WX_DEVTOOLS_PORT=实际端口 npm run wx:check`。
- 未登录：在微信开发者工具内登录后重试。
- appid 权限问题：确认当前微信账号有该项目的开发或预览权限。
- `build-npm` 失败：先手动执行「微信开发者工具 -> 工具 -> 构建 npm」。
- `__NO_NODE_MODULES__`：当前 `miniprogramRoot` 下没有需要微信开发者工具构建的 npm 包，通常表示本项目暂时无需构建小程序 npm；不要因此移动根目录的测试依赖。
- E2E 启动超时：确认项目已在开发者工具中手动打开过，必要时关闭多余窗口后重试。
- Jest 提示 open handles：先运行 `npx jest tests/e2e --runInBand --detectOpenHandles` 定位；`miniprogram-automator` 连接外部开发者工具时可能会短暂保留连接句柄。
- 首页运行错误：smoke test 只验证首页可打开，不绕过登录，不写数据库；如果首页自身报错，需要先修复页面启动错误。

## 后续 E2E 扩展方向

建议在 smoke test 跑通后再逐步添加业务流程测试：

1. 报工流程：打开员工首页，进入报工页，验证表单可渲染；不要写入真实报工数据。
2. 质检流程：打开质检首页和质检详情页，验证页面加载与关键控件存在。
3. 老板端流程：打开老板端首页、订单、员工、数据中心页面，验证只读页面加载。
4. 工资计算：优先补纯函数 unit test，再考虑只读 E2E 展示验证。

任何涉及写入数据库、调用生产云函数写操作、上传发布或修改线上环境的测试，都必须先单独设计隔离方案并获得明确授权。
