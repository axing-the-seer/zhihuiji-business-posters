# 开发与发布

本文档用于 GitHub 维护和本地开发，不进入 SkillHub 发布包。

## 项目结构

```text
zhihuiji-business-posters/
├── .codebuddy-plugin/plugin.json    # 插件信息与官方 Connector 依赖
├── hooks/hooks.json                 # 会话开始时准备图片渲染依赖
├── icon.png                         # 插件图标
├── docs/screenshots/                # 输出样图
├── scripts/                         # 依赖初始化、图片内嵌与发布脚本
└── skills/business-posters/
    ├── SKILL.md                     # 能力边界与运行入口
    ├── agents/openai.yaml           # Skill 展示信息
    ├── assets/                      # 品牌和视觉资产
    ├── references/                  # 运行规则与数据契约
    ├── scripts/                     # 数据读取、校验与渲染
    ├── dev/                         # 本地合成数据预览
    └── tests/                       # 自动测试
```

## 本地开发

要求 Node.js `>=20.9.0`，并已通过官方 Connector 安装、登录 `ailit 0.8.1` 或更高兼容版本。

```bash
cd skills/business-posters
npm ci --omit=dev
npm test
npm run generate:calendar -- --month 2026-08 --output /absolute/path/calendar.png
npm run generate:monthly -- --month 2026-08 --output-dir /absolute/path/monthly
```

官方 Connector 负责 `ailit` 的安装与认证；本插件只在私有目录中初始化图片渲染依赖。

## 发布边界

- `scripts/prepare-release.mjs` 通过白名单生成 GitHub/WorkBuddy 目录。
- `scripts/build-embedded-assets.mjs` 把五张原始 PNG 转为文本模块；原始文件仍保留在源码仓库中。
- `scripts/prepare-skillhub-release.mjs` 生成 SkillHub 专用目录；不携带会被平台剔除的外置二进制图片，但会携带并校验五张原图的内嵌字节。
- `scripts/build-release.mjs` 只在工作区已提交且无变更时工作，一次生成 GitHub 和 SkillHub 两个 ZIP。
- 正式构建会校验两个包的运行文件列表和 SHA-256；元数据、README 与展示图可按平台不同而不同。
- 发布包不包含 `dev/`、`tests/`、`node_modules/`、`PACKAGE_AUDIT.md`、本地经营数据或输出图片。
- 根目录 `README.md` 只作为用户介绍；开发记录和发布验证不写入 README。
- SkillHub 界面会展示 `SKILL.md`，因此公开正文只能包含产品介绍和两项能力；运行细节放在 `references/runtime-workflow.md`。
- 任何发布文件都不得放入密钥、token、账号、真实店铺数据或其他秘密。
