# 工厂记账小程序 V2 验收报告

**版本**: V2.0  
**日期**: 2026-03-05  
**状态**: 开发完成，待测试验收

---

## I. 全局 UI — 适老化字体放大

### 修改文件
- `miniprogram/app.wxss` — 全局样式重写

### 变更内容
| 元素 | 原值 | 新值 |
|------|------|------|
| 基础字体 | 32rpx | 36rpx |
| 标题字体 | 36rpx | 40rpx |
| 按钮最小高度 | — | 88rpx |
| 输入框高度 | 88rpx | 96rpx |
| 统计数值 | 56rpx | 64rpx |
| 小号文字 | 24rpx | 28rpx |
| 大号文字 | 36rpx | 40rpx |
| 超大文字 | 44rpx → 56rpx | 48rpx → 64rpx |
| 标签文字 | 24rpx | 28rpx |

### 验收标准
- [ ] 所有页面文字可读性增大
- [ ] 按钮、输入框触控区域增大
- [ ] 无文字溢出或布局异常

---

## II. 薪资隐私保护

### 修改文件
- `cloudfunctions/salary/index.js` — 后端字段级脱敏
- `miniprogram/pages/employee/profile/profile.js` — 前端适配
- `miniprogram/pages/employee/profile/profile.wxml` — 隐私视图

### 功能说明
- 员工端 `getUserMonthlySalary` 接口：当月工资标记已发放后，不再返回 `piece_rate`、`logs`、`work_stats.total_quantity`、`total_passed`、`pass_rate`
- 仅返回 `total`（应发合计）、`reward`、`penalty`、`attend_days`、`total_hours`、`adjustments`（简化版）
- Boss 端 `getUserMonthlySalaryByBoss` 接口不受影响，始终返回完整数据
- 员工个人中心：已发薪月份显示"已发放"标记，计件工资显示 `***`，产出和合格率显示 `--`

### 验收标准
- [ ] 员工端已发薪月份看不到具体计件数量和单价
- [ ] 员工端未发薪月份可正常查看完整数据
- [ ] Boss端不受任何影响，始终可见完整明细
- [ ] 已发薪显示"已发放"绿色标记
- [ ] 显示"工资已发放，计件明细已归档"提示

---

## III. 排行榜 — 3周期×3维度

### 修改文件
- `cloudfunctions/leaderboard/index.js` — 3 actions: getMonthlyRank, getOrderRank, getYearlyRank
- `miniprogram/pages/boss/leaderboard/leaderboard.js` — 前端全面重写
- `miniprogram/pages/boss/leaderboard/leaderboard.wxml` — 新布局
- `miniprogram/pages/boss/leaderboard/leaderboard.wxss` — 新样式

### 功能说明
- **周期 Tab**: 本月 / 按订单 / 年度
- **维度 Tab**: 工时 / 薪资 / 品质
- 所有活跃员工均参与排名（包括零值员工）
- 相同值员工同排名
- 月度支持月份选择器
- 年度支持年份选择器
- 订单维度支持订单下拉选择
- 排名前3名显示金银铜奖牌

### 验收标准
- [ ] 切换"本月/按订单/年度"正常
- [ ] 切换"工时/薪资/品质"正常
- [ ] 月份选择器有效
- [ ] 订单选择器有效
- [ ] 年份选择器有效
- [ ] 零值员工也出现在列表中
- [ ] 排名正确（降序，相同值同排名）

---

## IV. 数据中心

### 修改文件
- `miniprogram/pages/boss/data-center/data-center.js` — 月度+订单视图
- `miniprogram/pages/boss/data-center/data-center.wxml` — 完整布局
- `miniprogram/pages/boss/data-center/data-center.wxss` — 完整样式

### 功能说明
- **月度视图**: 月份选择 → 3个 Tab（考勤/报工/薪资）
  - 考勤: 工作天数、打卡次数、迟到次数，按日期分组显示
  - 报工: 报工条数、总数量、总金额，按日期分组显示
  - 薪资: 发薪人数、总薪资、已发放比例，按员工卡片显示
- **订单视图**: 订单列表 → 点击进入详情
  - 详情: 报工条数、总数量、总成本，工序进度条，报工明细

### 验收标准
- [ ] 按月/按订单模式切换正常
- [ ] 月份选择有效
- [ ] 考勤/报工/薪资 Tab 数据正确
- [ ] 订单列表加载正常
- [ ] 订单详情展示工序进度和报工明细

---

## V. 登录安全增强

### 修改文件
- `cloudfunctions/login/index.js` — 登录、改密、token验证
- `cloudfunctions/user/index.js` — 密码重置
- `miniprogram/pages/login/login.js` — 前端改密弹窗
- `miniprogram/pages/login/login.wxml` — Logo + 改密弹窗
- `miniprogram/pages/login/login.wxss` — 样式
- `miniprogram/pages/boss/employees/employees.js` — 重置密码按钮
- `miniprogram/pages/boss/employees/employees.wxml` — 重置密码按钮
- `miniprogram/pages/boss/employees/employees.wxss` — 按钮样式
- `miniprogram/images/logo.png` — 新增 Logo 图片

### 功能说明
- **Logo 显示**: 登录页顶部显示飞盛 Logo
- **首次登录强制改密**: 新用户或管理员重置密码后，登录将弹出改密弹窗，不可跳过
- **密码强度**: ≥8位 + 包含字母 + 包含数字 + 不能等于手机号
- **登录限流**: 5分钟内50次失败上限（全局）
- **会话 Token**: 每次登录/改密生成新 token (crypto.randomBytes)
- **Boss 重置密码**: 员工管理页新增"重置密码"按钮，重置为手机号，强制下线并要求改密
- **审计日志**: 登录失败、密码重置均写入 audit_logs

### 验收标准
- [ ] 登录页显示 Logo
- [ ] 新员工首次登录弹出改密弹窗
- [ ] 改密弹窗不可被关闭（只能完成修改）
- [ ] 密码强度校验生效（弱密码拒绝）
- [ ] 管理员可在员工管理页重置密码
- [ ] 重置后员工被踢出登录态
- [ ] 重置后员工再次登录需改密

---

## VI. 系统设置 — QR码过期天数 + 居家打卡

### 修改文件
- `cloudfunctions/settings/index.js` — qrcode_expire_days + allow_home_checkin
- `cloudfunctions/qrcode/index.js` — 使用天数单位计算过期
- `miniprogram/pages/boss/settings/settings.js` — 天数 + 开关
- `miniprogram/pages/boss/settings/settings.wxml` — 天数输入 + 居家打卡开关
- `miniprogram/pages/boss/settings/settings.wxss` — 开关样式

### 功能说明
- 二维码有效期从小时改为天数，兼容旧数据（自动 hours→days 转换）
- 新增"允许居家打卡"开关

### 验收标准
- [ ] 设置页显示"二维码有效期（天）"
- [ ] 保存后二维码按天数过期
- [ ] 居家打卡开关可正常切换与保存
- [ ] 旧设置中的 qrcode_expire_hours 自动转换

---

## VII. 人脸识别调研

### 产出文件
- `docs/face-auth.md` — 调研报告

### 结论
- 微信官方 `wx.startFacialRecognitionVerify` 为付费/受限 API，非企业级主体无法使用
- 建议保持功能开关（默认关闭），待条件成熟后接入

---

## VIII. 稳定性 / 架构

### 修改文件
- `miniprogram/utils/util.js` — callCloud 自动重试
- `cloudfunctions/init/index.js` — V2 迁移脚本

### 功能说明
- **自动重试**: `callCloud` 网络错误时自动重试最多2次，指数退避（500ms → 1000ms）
- **迁移脚本**: `init` 云函数新增 `migrate_v2` action，为所有用户添加 `password_changed`、`must_change_password`、`session_token` 字段，更新工厂设置字段

### 验收标准
- [ ] 网络波动时云函数调用自动重试
- [ ] 执行 `migrate_v2` 后旧用户数据兼容新版本

---

## 部署步骤

1. **上传云函数**: 在微信开发者工具中右键每个云函数目录 → "上传并部署: 云端安装依赖"
   - 必须上传: init, login, user, salary, leaderboard, settings, qrcode
   - 其他未修改的可选上传: attendance, export, order, worklog
2. **执行数据库迁移**: 在微信开发者工具云开发控制台中调用 `init` 云函数，传入 `{ action: 'migrate_v2' }`
3. **预览小程序**: 点击"预览"或"真机调试"验证功能
4. **提交审核**: 功能验收通过后提交版本审核

---

## 修改文件汇总

| 文件 | 修改类型 | 所属需求 |
|------|----------|----------|
| miniprogram/app.wxss | 重写 | I. 字体放大 |
| miniprogram/images/logo.png | 新增 | V. 登录 Logo |
| miniprogram/utils/util.js | 修改 | VIII. 重试 |
| miniprogram/pages/login/login.js | 重写 | V. 登录 |
| miniprogram/pages/login/login.wxml | 重写 | V. 登录 |
| miniprogram/pages/login/login.wxss | 重写 | V. 登录 |
| miniprogram/pages/employee/profile/profile.js | 重写 | II. 薪资隐私 |
| miniprogram/pages/employee/profile/profile.wxml | 重写 | II. 薪资隐私 |
| miniprogram/pages/employee/profile/profile.wxss | 修改 | II. 薪资隐私 |
| miniprogram/pages/boss/leaderboard/leaderboard.js | 重写 | III. 排行榜 |
| miniprogram/pages/boss/leaderboard/leaderboard.wxml | 重写 | III. 排行榜 |
| miniprogram/pages/boss/leaderboard/leaderboard.wxss | 重写 | III. 排行榜 |
| miniprogram/pages/boss/employees/employees.js | 重写 | V. 密码重置 |
| miniprogram/pages/boss/employees/employees.wxml | 修改 | V. 密码重置 |
| miniprogram/pages/boss/employees/employees.wxss | 修改 | V. 密码重置 |
| miniprogram/pages/boss/settings/settings.js | 重写 | VI. 设置 |
| miniprogram/pages/boss/settings/settings.wxml | 重写 | VI. 设置 |
| miniprogram/pages/boss/settings/settings.wxss | 修改 | VI. 设置 |
| miniprogram/pages/boss/data-center/data-center.* | 已有 | IV. 数据中心 |
| cloudfunctions/login/index.js | 重写 | V. 登录 |
| cloudfunctions/user/index.js | 重写 | V. 密码重置 |
| cloudfunctions/salary/index.js | 重写 | II. 薪资隐私 |
| cloudfunctions/leaderboard/index.js | 重写 | III. 排行榜 |
| cloudfunctions/settings/index.js | 重写 | VI. 设置 |
| cloudfunctions/qrcode/index.js | 重写 | VI. QR码 |
| cloudfunctions/init/index.js | 修改 | VIII. 迁移 |
| docs/face-auth.md | 新增 | VII. 人脸调研 |
| docs/acceptance-report.md | 新增 | 验收报告 |
