# 经营海报 Connector v1.2.0 发布检查

对齐规范：`WorkBuddy Connector 第三方开发者对接规范 v3.0（2026-06-24）`

## 接入方案

- 采用“CLI + Skill”。
- Connector ID：`zhihuiji-business-posters`。
- Connector 负责安装、认证、登出和状态检测 `ailit`。
- 单个 `business-posters` Skill 同时提供经营日历、三页经营月报，以及月报后的客户欠款查询和对账单 PDF 导出连续流程。
- 三页月报的对外名称和文件名统一为“经营概览、商品与库存、收款与客户”。
- Connector初始化同时安装`ailit`和Skill生产依赖，生成阶段不再临时安装Sharp。

## 已通过

- `connector-meta.json`、`cli.json`、`icon.png`、`skills/business-posters/SKILL.md` 齐全。
- Connector 元信息包含中英文名称、描述和示例，`source` 为 kebab-case，`type` 为 `cli`。
- 使用 `statusMatchJson`、`versionCheck` 等 v4.24.0 能力，已声明 `minWorkbuddyVersion: 4.24.0`。
- npm 包 `@co-ailit/ailit-cli@0.8.0` 已发布，声明支持 macOS/Linux/Windows、x64/arm64；Connector 与 Sharp 渲染依赖统一要求 Node.js >=20.9.0。
- 本机 `ailit version 0.8.0`，`ailit doctor --format json` 返回 `allPass: true`。
- Skill 通过 Codex `quick_validate.py` 校验，自动测试 26 项全部通过。
- 图标为透明背景 64×64 PNG，小尺寸可识别。
- v1.2.0 已按固定白名单重新封包，共 29 个文件；不包含 `node_modules`、测试、开发预览、视觉基线、PDF 或真实经营输出。
- 经营月报标准化库存已验证：按商品去重，低库存只含正数，缺货归零，两组互斥。
- 收款单状态仅接受已验证的数值 `1`，日历与月报都执行列表/详情、优惠、预存款和账户金额检查；销售退货在真实契约完成前采用严格停止策略。
- 生产生成脚本不再包含 synthetic preview；开发预览保留在不进入发布白名单的 `dev/` 目录。
- 客户对账单使用安全执行脚本和标准输入，包含客户消歧、金额核对、可信域名、PDF 文件头、大小限制和原子写入。客户汇总与对账明细按账款净变动核对，不再直接比较不同统计含义的金额。
- 已使用固定发布白名单生成 SHA-256 文件清单并逐项复核；发布压缩包 SHA-256 为 `05bc573560518ec4f4ffa84a6a49b2497cd8206ad49de1d79fbbf697d7a6675d`。

## 提交前仍需确认

- `source` 是否全局唯一需由 WorkBuddy 团队最终确认。
- Connector 隔离目录下的完整 `init → auth → status → unAuth` 应在 WorkBuddy 客户端安装态联调；本次未执行 `unAuth`，避免清除当前真实登录态。
- 智慧记店铺名称仍未保存：网页要求先填写“店铺详细地址”，这属于账号资料问题，不影响 Connector 包结构，但会影响海报默认店名。
