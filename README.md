# 智慧记经营海报 Connector

这是按《WorkBuddy Connector 第三方开发者对接规范 v3.0》封装的 CLI + Skill 项目。

## 能力

- 使用已认证的 `ailit` CLI 读取智慧记真实经营数据。
- 生成 `1080×1620` PNG 经营日历。
- 生成三页 `1080×1620` PNG 经营月报。
- 从月报继续查询客户欠款、核对明细并导出官方对账单 PDF。

## 目录

- `connector-meta.json`：WorkBuddy Connector 元信息。
- `cli.json`：`ailit` 安装、认证、登出、状态检测和版本检查。
- `icon.png`：Connector 市场图标。
- `skills/business-posters/`：单一经营海报 Skill、脚本、品牌资产、数据契约和测试。
- `PACKAGE_AUDIT.md`：本地封包检查结果与待联调事项。

## 本地验证

```bash
cd skills/business-posters
npm ci --omit=dev
npm test
```

真实数据生成要求本机已安装并登录 `ailit`。仓库不包含令牌、手机号、真实经营输出、对账单、历史探索稿或 `node_modules`。

## 建议审查重点

1. `connector-meta.json` 与 `cli.json` 是否完全符合 WorkBuddy v3.0 CLI Connector 规范。
2. 两种海报路由、数据口径、分页与交叉校验是否严谨。
3. 标准化库存是否满足去重、低库存仅正数、缺货归零且两组互斥。
4. 月报到客户欠款查询及对账单 PDF 导出的连续流程是否完整。
5. 是否存在凭证泄露、真实数据混入或跨平台安装风险。

