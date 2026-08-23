# 智慧记经营海报 Connector

面向智慧记AI进销存用户的经营图片工具。用户用自然语言发起请求后，可生成手机端经营日历、三页经营月报，并继续查询客户欠款或导出官方对账单。

## 主要能力

- 读取已登录店铺的智慧记AI进销存经营数据。
- 生成 `1080×1620` PNG 经营日历，按天查看本月实际收款。
- 生成三页 `1080×1620` PNG 经营月报：经营概览、商品与库存、收款与客户。
- 从月报继续查询客户欠款、核对账务明细并导出官方对账单 PDF。
- 对分页、金额、收款状态、文件来源和 PDF 完整性进行检查，数据不可靠时停止输出。

## 输出示例

以下图片使用模拟经营数据，仅用于展示最终版式和信息结构。

<table>
  <tr>
    <td align="center"><strong>经营日历</strong></td>
    <td align="center"><strong>经营月报 · 经营概览</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/01-business-calendar.png" alt="经营日历示例"></td>
    <td width="50%"><img src="docs/screenshots/02-monthly-overview.png" alt="经营月报经营概览示例"></td>
  </tr>
  <tr>
    <td align="center"><strong>经营月报 · 商品与库存</strong></td>
    <td align="center"><strong>经营月报 · 收款与客户</strong></td>
  </tr>
  <tr>
    <td width="50%"><img src="docs/screenshots/03-products-inventory.png" alt="经营月报商品与库存示例"></td>
    <td width="50%"><img src="docs/screenshots/04-receipts-customers.png" alt="经营月报收款与客户示例"></td>
  </tr>
</table>

## 使用方式

在 WorkBuddy 中连接并启用 Connector 后，直接用业务语言提出需求：

- “看下经营日历”
- “看下月报”
- “查询月报里这几家客户的欠款情况”
- “把这些客户的本月对账单下载下来”

未指定月份时默认使用当前月；未指定保存位置时，图片和对账单保存在当前工作目录的 `经营海报输出/`。

## 工作流程

```mermaid
flowchart LR
    A[用户自然语言请求] --> B[Skill 识别业务意图]
    B --> C{经营日历 / 经营月报 / 客户对账}
    C --> D[读取智慧记AI进销存数据]
    D --> E[分页、状态与金额核对]
    E --> F[标准化经营数据]
    F --> G[生成 PNG 或下载官方 PDF]
    G --> H[返回图片、金额摘要或对账单]
```

## 项目结构

```text
zhihuiji-business-posters/
├── connector-meta.json              # Connector 名称、版本和示例
├── cli.json                         # 安装、登录、状态检测和运行环境
├── icon.png                         # Connector 图标
├── docs/
│   └── screenshots/                 # README 输出样图
├── scripts/
│   └── prepare-release.mjs          # 按白名单生成发布目录和文件清单
└── skills/business-posters/
    ├── SKILL.md                     # 触发方式、业务路由和用户沟通规则
    ├── agents/openai.yaml           # Skill 展示信息
    ├── assets/                      # 品牌、日历和月报视觉资源
    ├── references/                  # 日历、月报和客户对账数据说明
    ├── scripts/                     # 数据读取、核对、渲染和对账单导出
    ├── dev/                         # 本地合成数据预览工具
    └── tests/                       # 自动测试与合成测试数据
```

正式发布包通过固定白名单生成，不包含 `dev/`、`tests/`、`node_modules/`、本地经营数据、输出图片或对账单。

## 本地开发

要求 Node.js `>=20.9.0`，并已安装、登录 `ailit 0.8.0`。

```bash
cd skills/business-posters
npm ci --omit=dev
npm test
```

WorkBuddy 安装 Connector 时会准备 `ailit` 和图片渲染依赖，实际生成过程中不会临时安装依赖。

## 数据与安全

- 仓库中的测试数据由固定种子生成，并明确标记为合成数据。
- 不读取或展示登录令牌、手机号等认证信息。
- 客户名称通过标准输入传入对账脚本，不拼接到 Shell 命令。
- 对账单只接受智慧记可信地址，并在保存前检查文件大小和 PDF 格式。
- 退货、收款状态或字段含义尚未验证时停止生成，不猜测金额。
