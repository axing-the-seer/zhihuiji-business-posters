# 经营海报 Connector v1.1.0 封包检查

对齐规范：`WorkBuddy Connector 第三方开发者对接规范 v3.0（2026-06-24）`

## 接入方案

- 采用“CLI + Skill”。
- Connector ID：`zhihuiji-business-posters`。
- Connector 负责安装、认证、登出和状态检测 `ailit`。
- 单个 `business-posters` Skill 同时提供经营日历、三页经营月报，以及月报后的客户欠款查询和对账单 PDF 导出连续流程。

## 已通过

- `connector-meta.json`、`cli.json`、`icon.png`、`skills/business-posters/SKILL.md` 齐全。
- Connector 元信息包含中英文名称、描述和示例，`source` 为 kebab-case，`type` 为 `cli`。
- 使用 `statusMatchJson`、`versionCheck` 等 v4.24.0 能力，已声明 `minWorkbuddyVersion: 4.24.0`。
- npm 包 `@co-ailit/ailit-cli@0.8.0` 已发布，声明支持 macOS/Linux/Windows、x64/arm64、Node.js >=18。
- 本机 `ailit version 0.8.0`，`ailit doctor --format json` 返回 `allPass: true`。
- Skill 通过 Codex `quick_validate.py` 校验。
- 图标为透明背景 64×64 PNG，小尺寸可识别。
- 发布包未包含 `node_modules`、测试、视觉基线或真实经营输出。
- 经营月报标准化库存已验证：按商品去重，低库存只含正数，缺货归零，两组互斥。

## 提交前仍需确认

- `source` 是否全局唯一需由 WorkBuddy 团队最终确认。
- Connector 隔离目录下的完整 `init → auth → status → unAuth` 应在 WorkBuddy 客户端安装态联调；本次未执行 `unAuth`，避免清除当前真实登录态。
- 智慧记店铺名称仍未保存：网页要求先填写“店铺详细地址”，这属于账号资料问题，不影响 Connector 包结构，但会影响海报默认店名。
