# 自检报告（二维码 + 隐私合规 + 审核体验）

## A. 考勤二维码闭环
- [x] 服务端生成小程序码：`cloudfunctions/qrcode/index.js` 使用 `cloud.openapi.wxacode.getUnlimited`。
- [x] 生成失败降级：返回 `qr_type=text` + `scene` + `debug_path`，前端可复制联调。
- [x] 二维码与业务标记强绑定：`qr_id/token` 写入 `qr_codes`，打卡记录写入 `Attendances.qr_id`。
- [x] 扫码后服务端校验：`attendance.clockIn` 对 `source=qrcode` 强制校验 `qr_id` 是否存在/过期/作废。
- [x] 作废能力：`qrcode.revoke` + 老板端按钮 `作废当前二维码`。
- [x] 审计日志：`qrcode_generate_fallback/qrcode_verify/qrcode_revoke/clock_in_success/...`。

## B. 隐私合规（3.4）
- [x] 首次弹窗协议确认：`pages/login/login.wxml` 协议确认弹窗。
- [x] 协议页面：`pages/privacy-policy/*`、`pages/user-agreement/*`。
- [x] 同意记录落库：`privacy_consents`（openid、user_id、consent_version、policy_hash、channel、agreed_at）。
- [x] 先同意后收集手机号：
  - 前端：登录前检查 `hasCurrentConsent`。
  - 后端：`cloudfunctions/login/login` 在手机号登录前强制 `hasCurrentConsent(openid)`。
- [x] 协议可再次查看：登录页、员工我的页、老板设置页均可进入协议页。

## C. 登录受限（3.3）
- [x] 体验模式：`pages/review/home/home` 支持免登录浏览核心流程。
- [x] 审核快速登录：`login.reviewLogin`，受 `factory_settings.review_mode_enabled` 控制。
- [x] 不明文写死账号密码：审核账号读取云端配置（`review_user_name/review_user_phone`）。
- [x] 提审说明文档：`docs/review/README.md`。

## 手工验证建议
1. 登录页冷启动：未同意时无法登录，显示协议弹窗。
2. 同意后登录：手机号登录成功。
3. 老板端生成二维码：体验版/正式版返回图片；开发工具无权限时返回文本联调信息。
4. 员工扫码：扫码进入后上班打卡成功且来源标记 `source=qrcode`、`qr_id` 落库。
5. 作废二维码后再扫码：提示“二维码已作废”，不可打卡。
