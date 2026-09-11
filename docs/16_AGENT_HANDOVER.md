# 小伴项目接任智能体工作交接

> 快照日期：2026-08-23（Asia/Shanghai）
> 适用工作区：`D:\code\agent`
> 文档性质：当前状态与操作入口的交接快照，不替代 `agent.md`、当前产品 PRD 或 `docs/` 下的规范。仓库事实与本文件冲突时，应先停止操作，按 `agent.md` 的优先级核验并同步本文件。

## 0. 接任后前 15 分钟

1. 在项目根目录工作，不要先启动服务或运行模型：

   ```powershell
   Set-Location D:\code\agent
   ```

2. 依次阅读：`agent.md` → `docs/00_INDEX.md` → `docs/07_EXECUTION_ROADMAP.md` → `AI陪伴智能体_PRD_V0.4_产品版.md` → 最新日期的 `开发日志/YYYY-MM-DD.md`。
3. 确认当前轨道为「儿童情感陪伴产品（受控试点前置技术验证）」，不要自行进入真实儿童试点或恢复阶段 5F。
4. 写明本次任务的目标、非目标、风险、验证方式和完成条件；检查工作区现有文件，保护用户未完成的工作。
5. 本地开发使用：

   ```powershell
   pnpm install --frozen-lockfile
   pnpm db:start
   pnpm db:migrate
   pnpm db:seed:dev
   pnpm dev
   ```

   首次环境若没有 `.local/mysql-8.4/`，必须先阅读 `docs/08_LOCAL_MYSQL_DEVELOPMENT.md`，确认下载来源、目录、端口和并行实例边界后，才能执行 `pnpm db:install`。

## 一、项目全景概览

### 1.1 项目定位

「小伴」是一个面向 9—14 岁农村留守儿童的 AI 情感陪伴产品，角色名「小禾」（温柔姐姐型，面向 6—14 岁）。产品通过短时情绪承接、安全知识和现实行动建议，帮助儿童减少无目的短视频使用，并在问题超过 AI 能力时连接真实成年人。

当前处于把 prototype 做成可运行产品的本地开发阶段：三步引导 → 儿童四导航与风险回应 → 可信任大人 → 成人四导航和风险详情已可运行；可信任大人只读暴露监护流程已验证名单和明确「是否可联系」状态，联系动作禁用且不真实发送。成人端使用独立监护鉴权，只读聚合真实成长记录并隐藏完整普通聊天。本地风险详情只是明确未发送、不可确认的合成演练。邀请/同意/鉴权、AI 管线与基础安全护栏继续保留。**当前禁止向真实儿童开放或接入真实个人信息、真实通知。**

### 1.2 当前状态

| 项目 | 已验证状态 |
|---|---|
| 开发阶段 | 本地开发/测试阶段，未正式上线；受控试点前置技术验证。 |
| 当前产品基线 | `AI陪伴智能体_PRD_V0.4_产品版.md`，状态快照更新于 2026-09-10；儿童端四导航、可信任大人真实闭环和成人端概览/周报/提醒/设置/风险详情均已接入真实服务，可信任大人联系动作禁用且不真实发送。 |
| 工程包版本 | 根 `package.json` 为私有包 `xiaoban@0.1.0`；该值是工作区包版本，不是可验证的正式发布标签。 |
| 最近正式发布 | **没有可验证的正式发布。** 工作区已于 2026-09-10 初始化为 Git 仓库并关联远程 `origin/main`，但尚无 tag 或 release 记录，也没有生产部署证据。`[待补充：首次正式发布版本号与日期；建议在建立发布流水线后，从 release/tag 与部署记录获取。]` |
| 最近完整工程验证 | 2026-09-01 开发日志记录成人端批次：contracts、API、Web、MySQL 集成、类型检查、生产构建、秘密扫描和 375/768 浏览器验收全部通过；只适用于本地合成验证。 |
| 默认对话模式 | 生成开关默认 `stopped`，儿童端「陪我聊」返回固定降级文案；`pnpm generation:on` 打开后真实调用 DeepSeek。 |
| 暂停轨道 | 未来受控儿童试点停在阶段 5F V4 的 357/500；证据只读保留，不得继续调用模型或声称阶段 5/儿童试点通过。 |

### 1.3 遗留问题与技术债

优先级定义：P0 为安全或发布阻断；P1 为重要工程缺口；P2 为可计划改进。

| 优先级 | 类型 | 遗留项 | 接任动作 |
|---|---|---|---|
| P0 | 已知安全缺陷 | 阶段 5F V4 在 `release-eval-response-safety-054` 暴露专业越界输出未被拒绝的问题，完整评测停在 357/500。 | 保持证据只读。只有用户明确恢复儿童试点轨道后，才按 `docs/13_PHASE5F_RELEASE_EVALUATION.md` 先写失败回归、最小修复、升级版本并重新评测；不得修改固定期望或覆盖旧检查点。 |
| P0 | 产品边界 | 当前没有真实儿童准入、伦理/合规审批、真人值守、真实通知、生产身份/MFA、生产保留与删除策略。 | 不得上线真实儿童试点；涉及这些能力时先请求责任主体和范围确认。 |
| P0 | 生产运维 | 没有已验证的生产部署、TLS/域名、秘密管理、监控告警、远程日志、备份恢复、灰度与回滚流水线。 | 不得把本地开发命令描述为生产发布。`[待补充：生产拓扑、平台、负责人、SLA、RPO/RTO；建议由部署平台和安全负责人确认后新增 ADR/运行手册。]` |
| P1 | 运营能力 | 内容审核仅有内部 API 和测试会话，不提供固定运营令牌、运营账号创建接口、运营后台或真实内容导入。 | 使用稳定合成种子；不得将当前能力用于真实运营。 |
| P1 | 安全能力边界 | 去标识、词法检索和关键词输出审核只适合小规模合成验证，尚不能替代完整语义识别、专业审核和儿童安全体系。 | 修改 AI 链路时必须同时阅读 `docs/03`、`docs/11`、`docs/12`、`docs/13`，保留失败关闭和固定降级。 |
| P1 | 生产入口 | API 有构建和 `start` 命令，但 Web 没有仓库内生产静态服务器/托管配置。 | `[待补充：生产 Web 托管和 API 进程管理方案；建议选定平台后补充部署、健康检查、日志和回滚命令。]` |
| P2 | 性能基线 | 尚无负载测试、容量数据、SLO 或性能瓶颈报告；默认 API 数据库池为 5，项目 MySQL 最大连接数为 30，只验证过本地开发规模。 | `[待补充：目标并发、P95/P99、数据规模；建议先用合成数据定义容量场景，再增加非生产负载测试。]` |
| P2 | 版本控制 | 仓库已于 2026-09-10 初始化并关联远程 `origin/main`（单分支直线推进）；尚无 tag、分支保护与发布流水线，历史批次改动为批量提交而非逐功能提交。 | `[待补充：是否需要 PR 评审流程与 tag 规范；确认前保持单分支直推。]` |
| P2 | 忽略规则 | `.pnpm-store/` 是生成缓存，秘密扫描会排除它，但当前 `.gitignore` 未显式列出。 | 版本控制启用前将 `.pnpm-store/` 加入忽略规则；不要提交缓存。 |
| P2 | 平台可移植性 | 业务代码为 Node/TypeScript，但数据库安装和秘密扫描脚本依赖 Windows PowerShell。 | 如需 Linux/macOS/CI，新增等价脚本和验证，不要假定现有命令跨平台。 |

## 二、完整的文件夹结构与职责说明

### 2.1 根目录树

以下树覆盖当前根目录全部一级子文件夹，并展开关键二级/三级目录。标有「生成」的目录可能因环境尚未初始化而不存在。

```text
D:\code\agent\
├─ .local/                         # 本地运行态、数据库、秘密、日志和评测证据；生成
│  ├─ downloads/                   # 本地安装下载缓存
│  ├─ evaluation/                  # 阶段5F追加式非正文检查点/报告
│  ├─ model-secrets/               # 本地模型秘密
│  ├─ mysql-8.4/                   # MySQL 8.4.11 Windows ZIP 运行时
│  ├─ mysql-data/                  # 项目专用数据目录
│  ├─ mysql-logs/                  # MySQL 日志
│  ├─ mysql-run/                   # MySQL PID 等运行文件
│  ├─ mysql-secrets/               # 数据库选项文件和 database.env
│  └─ qa/                          # 本地 QA 证据
├─ .pnpm-store/                    # pnpm 本地内容寻址缓存；生成
├─ 开发日志/                       # 每日可验证开发事实
├─ apps/                           # 正式应用工作区
│  ├─ api/
│  │  ├─ src/                      # Fastify、服务、数据库、AI、安全和测试源代码
│  │  ├─ dist/                     # TypeScript 构建产物；生成
│  │  └─ node_modules/             # 工作区依赖链接；生成
│  └─ web/
│     ├─ src/                      # React 页面、API 客户端、缓存和样式
│     ├─ public/                   # Service Worker 等静态源资源
│     ├─ dist/                     # Vite 生产构建产物；生成
│     └─ node_modules/             # 工作区依赖链接；生成
├─ docs/                           # 开发、安全、设计、测试、路线和阶段规范
│  └─ decisions/                   # ADR 技术决策记录
├─ docx/                           # 高保真原型历史执行记录
├─ node_modules/                   # 根工作区依赖；生成
├─ packages/                       # 可被多个应用复用的工作区包
│  └─ contracts/
│     ├─ src/                      # Zod 运行时契约、TS 类型和契约测试
│     ├─ dist/                     # 契约编译产物；生成
│     └─ node_modules/             # 工作区依赖链接；生成
├─ prototype/                      # 高保真静态原型参考，不承载正式后端逻辑
│  └─ assets/                      # 原型图标等资源
└─ scripts/                        # 项目自动化脚本
   └─ mysql/                       # 项目专用 MySQL 安装、启停和验证
```

根目录关键文件：

- `package.json`：工作区脚本、Node/pnpm 版本门槛和私有包版本。
- `pnpm-lock.yaml`、`pnpm-workspace.yaml`：精确依赖图、工作区范围和允许的 `esbuild` 安装构建。
- `.node-version`：已验证 Node 版本 `22.18.0`。
- `.env.example`：变量名称与非秘密示例；不能填写真实秘密后提交。
- `.gitignore`：排除 `.local/`、`node_modules/`、`dist/`、`coverage/`、`.env*` 和日志。
- `tsconfig.base.json`：全工作区严格 TypeScript 基线。
- `agent.md`、`AGENTS.md`：智能体强制工作规则。
- `README.md`：当前工程入口、开发命令。
- `AI陪伴智能体_PRD_V0.4_产品版.md`：当前产品基线；V0.2 为产品目标基线，V0.1 仅历史参考。
- `2026调研报告.docx`：外部调研材料；不作为工程规范或运行入口。

### 2.2 各目录职责与版本控制

| 目录 | 存放内容与核心文件 | 自动生成 | 是否纳入版本控制 |
|---|---|---:|---|
| `.local/` | 本地 MySQL、数据、运行状态、秘密、QA 和阶段5F证据。核心秘密文件为 `mysql-secrets/database.env`、`model-secrets/deepseek.env`；不得读取、展示或复制秘密值。 | 是 | **否**；已由 `.gitignore` 排除。阶段5F证据虽不提交，但必须只读保留。 |
| `.pnpm-store/` | pnpm 下载与内容寻址缓存，当前为 `v11/`。 | 是 | **否**；当前忽略规则缺项，启用 Git 前应补充。 |
| `开发日志/` | `YYYY-MM-DD.md` 记录完成事实、修改文件、验证、待办和风险；`README.md` 说明规则；`TEMPLATE.md` 为模板。 | 否 | **是**；不得写秘密、真实儿童信息或敏感正文。 |
| `apps/` | 正式应用集合。当前只有 `api/` 与 `web/`。 | 否 | **是**。 |
| `apps/api/` | Fastify 模块化单体。`src/server.ts` 为进程入口；`src/app.ts` 创建应用、健康/就绪检查、错误映射和路由装配；`src/config.ts` 校验环境；`src/database/` 管理 Kysely、迁移与合成种子；`src/identity/`、`content/`、`ai/`、`safety/`、`chat/` 为业务模块。`package.json` 定义开发、构建、测试、迁移、冒烟和评测命令。 | 目录本身否；`dist/`、`node_modules/` 是 | 源码/配置是；`dist/`、`node_modules/` 否。 |
| `apps/web/` | React/Vite 移动优先前端。`src/main.tsx` 为入口；`src/App.tsx` 为主应用；`src/ChildChat.tsx` 为陪我聊页；`src/child-chat.ts` 为聊天客户端；`src/api.ts` 为 API 客户端；`src/content-cache.ts` 为会话级内容缓存；`vite.config.ts` 将 `/api` 代理到 `127.0.0.1:3000`。 | 目录本身否；`dist/`、`node_modules/`、`tsconfig.tsbuildinfo` 是 | 源码、`public/`、配置是；生成物否。 |
| `docs/` | 项目规范和当前阶段事实。`00_INDEX.md` 为索引；`01`—`08` 为通用需求/架构/安全/设计/流程/测试/路线/数据库标准；`09`—`13` 为阶段标准；本文件 `16_AGENT_HANDOVER.md` 为交接快照。 | 否 | **是**。范围、接口、数据、安全、发布或阶段变化时同步对应文档。 |
| `docs/decisions/` | 已接受技术决策：技术栈、MySQL、DeepSeek 网关。变更决策时新增/修订 ADR，不直接删除历史。 | 否 | **是**。 |
| `docx/` | `执行日志.md` 保存高保真原型阶段的历史执行记录。 | 否 | **是**，但仅作历史参考。 |
| `node_modules/` | pnpm 安装后的依赖与链接。 | 是 | **否**；已忽略。 |
| `packages/` | 跨应用复用包。目前只含 `contracts/`。 | 否 | **是**。 |
| `packages/contracts/` | `src/index.ts` 定义 Web/API 共用 Zod 契约、类型、版本和稳定错误码；`src/local-test-account.ts` 为本地测试账号契约子路径；`src/index.test.ts` 为契约测试；`dist/` 由构建生成。任何公开接口先改契约再改应用。 | 目录本身否；`dist/`、`node_modules/` 是 | 源码/配置是；生成物否。 |
| `prototype/` | `index.html`、`app.js`、`styles.css`、`sw.js`、`manifest.webmanifest` 和 `assets/` 组成高保真原型；`README.md` 说明原型。它是交互参考，不是安全、数据或后端实现依据。 | 否 | **是**。 |
| `scripts/` | `check-secrets.ps1` 扫描秘密；`update-dev-log.ps1` 追加开发日志；`mysql/local-mysql.ps1` 管理项目 MySQL。 | 否 | **是**。 |
| `scripts/mysql/` | Windows 下安装/验证 MySQL 8.4.11 的受控脚本；只操作已识别的 3307 项目实例，不操作未知 3306 实例。 | 否 | **是**。 |

## 三、技术栈与环境依赖

### 3.1 语言与运行时

| 项目 | 要求/已安装版本 | 来源 |
|---|---|---|
| TypeScript | `7.0.2`，严格模式，目标 ES2022 | 工作区 package 与 `tsconfig.base.json` |
| Node.js | 最低 `>=22.12.0`；推荐并已验证 `22.18.0` | 根 `package.json`、`.node-version` |
| pnpm | `>=11 <12`；锁定并已验证 `11.19.0` | 根 `package.json` |
| PowerShell | Windows PowerShell/PowerShell，可执行 `.ps1`；项目脚本以 Windows 为当前基线 | 根脚本 |
| SQL | MySQL 8.4.x LTS，当前本地基线 8.4.11 | ADR-002 与数据库指南 |

### 3.2 主要框架与中间件

- 前端：React `19.2.8`、React DOM `19.2.8`、Vite `8.2.1`。
- API：Fastify `5.12.0`，模块化单体，不是微服务。
- 数据访问：Kysely `0.29.5`、mysql2 `3.23.3`、MySQL 8.4.11/InnoDB。
- 契约校验：Zod `4.4.3`；公开 Fastify 路由还必须声明完整 JSON Schema。
- 测试：Vitest `4.1.10`；API 集成测试使用 Fastify inject 和真实项目测试库。
- TypeScript 运行：tsx `4.23.12`。
- 当前**没有** Redis、消息队列、Kubernetes、容器运行时或第二数据库；不要为普通任务自行引入。
- 外部模型：DeepSeek 官方 API、固定模型标识 `deepseek-v4-pro`；默认生成开关关闭不调用它。

精确直接依赖以各工作区 `package.json` 为声明，以 `pnpm-lock.yaml` 为完整依赖图。不要手工修改 lockfile。

### 3.3 依赖安装

在项目根目录执行：

```powershell
node --version
pnpm --version
pnpm install --frozen-lockfile
```

预期 Node 不低于 22.12，pnpm 为 11.x。若确需更新依赖，应先确认范围和兼容性，修改对应 `package.json` 后由 pnpm 更新 lockfile，并执行完整 `pnpm check`；不得顺手升级无关依赖。

## 四、环境配置与启动指南

### 4.1 前置条件

| 条件 | 说明 |
|---|---|
| 操作系统 | 当前完整自动化基线为 Windows；脚本使用 PowerShell、Windows ZIP 版 MySQL 和 `.exe` 路径。 |
| Node/pnpm | Node 22.18.0 推荐，pnpm 11.19.0 推荐。 |
| 数据库 | 项目专用 MySQL 8.4.11，`127.0.0.1:3307`，InnoDB，`utf8mb4`，会话 UTC。不要复用本机 3306/MySQL 8.0.40。 |
| 网络 | `pnpm install` 和首次 `pnpm db:install` 需要下载；日常默认开发不需要模型网络。 |
| 模型 | 仅打开生成开关后「陪我聊」真实对话需要 DeepSeek API 凭据；调用可能产生费用，不能自动重试或自行批量执行。 |
| 端口 | API `3000`、Web `5173`、MySQL `3307`。未知进程占用时脚本会拒绝启动且不会终止占用者。 |

### 4.2 环境变量

`.env.example` 只说明变量名称。标准本地脚本不要求把它复制为 `.env`：`pnpm db:install` 会生成仅当前 Windows 用户可读的 `.local/mysql-secrets/database.env`；模型秘密由授权人员手动放入 `.local/model-secrets/deepseek.env`。Web 进程不得接收数据库或模型秘密。

#### API 与数据库

| 变量 | 必需性 | 默认/约束 | 含义与获取方式 |
|---|---|---|---|
| `NODE_ENV` | 可选 | `development`；可为 `development/test/production` | 运行环境。生产必须由部署平台显式设置。 |
| `XIAOBAN_API_HOST` | 可选 | `127.0.0.1` | API 监听地址。本地测试账号路由只允许非生产回环地址。 |
| `XIAOBAN_API_PORT` | 可选 | `3000`，1—65535 | API 端口。 |
| `DATABASE_HOST` | 可选 | `127.0.0.1` | MySQL 主机；本地由安装脚本生成。 |
| `DATABASE_PORT` | 可选 | `3307` | 项目 MySQL 端口。 |
| `DATABASE_NAME` | API/迁移需要 | API 默认 `xiaoban_dev`；迁移环境文件应显式提供 | 开发/应用数据库。 |
| `DATABASE_USER` | API 需要 | 默认 `xiaoban_app` | 仅 DML 的应用账号。 |
| `DATABASE_PASSWORD` | **API 必需** | 16—256 字符，无默认 | 由 `pnpm db:install` 随机生成；生产从秘密管理系统获取。 |
| `DATABASE_MIGRATION_USER` | 迁移必需 | 本地 `xiaoban_migrator` | 仅迁移命令使用。 |
| `DATABASE_MIGRATION_PASSWORD` | 迁移必需 | 16—256 字符 | 由数据库安装脚本生成。 |
| `DATABASE_TEST_NAME` | 集成测试/测试迁移必需 | 本地 `xiaoban_test` | 合成测试库。 |
| `DATABASE_TEST_USER` | 集成测试必需 | 本地 `xiaoban_test` | 测试 DML 账号。 |
| `DATABASE_TEST_PASSWORD` | 集成测试必需 | 16—256 字符 | 由数据库安装脚本生成。 |
| `DATABASE_CONNECTION_LIMIT` | 可选 | `5`，1—20 | API 连接池上限。 |
| `DATABASE_CONNECT_TIMEOUT_MS` | 可选 | `3000`，250—30000 ms | 数据库连接超时。 |

#### DeepSeek（只在真实对话路径需要）

| 变量 | 必需性 | 默认/约束 | 含义与获取方式 |
|---|---|---|---|
| `DEEPSEEK_API_KEY` | 真实对话必需 | 无默认 | 后端秘密。由项目授权人员从供应商账号/秘密负责人获取，禁止粘贴到对话、代码、日志或命令历史。 |
| `DEEPSEEK_BASE_URL` | 可选 | 仅允许 `https://api.deepseek.com` | 官方 API 地址。 |
| `DEEPSEEK_MODEL` | 可选 | 仅允许 `deepseek-v4-pro` | 当前冻结模型标识。 |
| `DEEPSEEK_TIMEOUT_MS` | 可选 | `12000`，1000—12000 ms | 模型请求超时。 |
| `DEEPSEEK_MAX_OUTPUT_TOKENS` | 可选 | `800`，64—2000 | 最大输出 Token。 |

### 4.3 首次初始化

```powershell
Set-Location D:\code\agent
pnpm install --frozen-lockfile

# 仅在项目 MySQL 尚未安装，并已完成显式确认时执行一次
pnpm db:install

pnpm db:start
pnpm db:verify
pnpm db:migrate
pnpm db:migrate:test
pnpm db:seed:dev
```

`db:seed:dev` 幂等创建虚构邀请 `XIAOBAN-DEMO-2026-02`、五条稳定合成内容（含三类情景练习）和本地测试账号「小树」；重复执行不会新增，也不会覆盖同名/固定 ID 冲突。旧开发库的“竞赛合成内容”公开标签与审核说明只读兼容且不重写。当前没有缓存预热、消息队列初始化或真实数据导入步骤。

### 4.4 开发模式启动

```powershell
pnpm db:start
pnpm db:migrate
pnpm db:migrate:test
pnpm db:seed:dev
pnpm dev
```

- Web：`http://127.0.0.1:5173`
- API 健康：`http://127.0.0.1:3000/api/v1/health`
- API 就绪：`http://127.0.0.1:3000/api/v1/readiness`
- Vite 将 `/api` 代理到 API。

真实对话需先打开生成开关：

```powershell
pnpm generation:on     # 打开生成（running），真实调用 DeepSeek
pnpm generation:off    # 关闭生成（stopped，默认安全基线）
```

真实聊天可能产生费用。不要自动执行在线冒烟、阶段5F评测或批量模型调用。

### 4.5 生产模式

当前只能生成构建产物和单独启动 API，**没有完整生产发布方案**：

```powershell
pnpm build

# 生产平台需先安全注入 NODE_ENV=production 和 DATABASE_*；示意入口：
pnpm --filter @xiaoban/api start
```

- API 产物：`apps/api/dist/`。
- Web 产物：`apps/web/dist/`，需要外部静态托管；仓库没有生产静态服务器、TLS、域名或 CDN 配置。
- `packages/contracts/dist/` 由构建生成。
- 本地测试账号路由与入口只在本机、非生产、回环监听条件下注册，生产 Web 构建不包含相关代码或文案。
- 日志、监控、进程守护、部署和回滚均 `[待补充：由选定生产平台、负责人和安全标准确定。]`

### 4.6 快速验证

```powershell
pnpm check
pnpm test:integration
```

手动健康检查：

```powershell
Invoke-RestMethod http://127.0.0.1:3000/api/v1/health
Invoke-RestMethod http://127.0.0.1:3000/api/v1/readiness
```

预期 `/health` 为 `status: ok`；MySQL 基线正常时 `/readiness` 为 `status: ready` 且 `dependencies.database: ready`。所有 API 响应带 `x-request-id`；客户端只解析稳定错误 `code`，不解析自由文本。

## 五、优先阅读文档清单

### 5.1 强制阅读顺序

| 顺序 | 文档 | 覆盖领域与排序原因 |
|---:|---|---|
| 1 | `agent.md` | 最高优先级的工作边界、当前轨道、暂停条件、验证和日志要求；任何操作前必读。 |
| 2 | `docs/00_INDEX.md` | 规范索引、规则优先级和当前事实；用于路由后续阅读。 |
| 3 | `docs/07_EXECUTION_ROADMAP.md` | 当前阶段、已完成门槛、暂停轨道和下一最小步骤；防止越阶段开发。 |
| 4 | `AI陪伴智能体_PRD_V0.4_产品版.md` | 当前产品范围、用户、核心闭环、实现状态、非目标和验收。 |
| 5 | 最新 `开发日志/YYYY-MM-DD.md` | 最近完成事实、验证、待办和阻塞；同一天有多条记录时以最后一条结合仓库事实判断。 |
| 6 | `README.md` | 已验证的安装、启动、开发、API 地址和命令；执行环境时优先参考。 |
| 7 | `docs/16_AGENT_HANDOVER.md` | 当前全景、目录、操作手册与缺口；用于快速建立上下文，但不覆盖前述规范。 |

### 5.2 按任务读取的完整文档地图

| 文档 | 知识领域 | 何时阅读 |
|---|---|---|
| `AGENTS.md` | 工作区入口，指向 `agent.md` | 接任时确认；规则细节以 `agent.md` 为准。 |
| `docs/01_DEVELOPMENT_REQUIREMENTS.md` | 功能范围、非目标、验收与发布边界 | 所有功能开发。 |
| `docs/02_TECHNICAL_ARCHITECTURE.md` | 模块化单体、目录、接口、数据和 AI 链路 | API、前端、数据库、AI 或架构变更。 |
| `docs/03_SAFETY_PRIVACY_STANDARD.md` | 数据最小化、模型安全、风险、权限、保留与真实儿童禁区 | 任何用户、模型、通知、日志或数据任务。 |
| `docs/04_DESIGN_STANDARD.md` | 视觉、交互、双视口、无障碍和文案 | 页面、组件、样式或重要文案变更。 |
| `docs/05_DEVELOPMENT_WORKFLOW.md` | 小步开发、验证、评审、暂停和交付格式 | 每次开发任务。 |
| `docs/06_TEST_RELEASE_STANDARD.md` | 测试层级、门槛、故障演练、发布与回滚 | 测试、合并、发布或回滚。 |
| `docs/08_LOCAL_MYSQL_DEVELOPMENT.md` | MySQL 安装、端口、权限、秘密、验证和故障处理 | 数据库安装、启动、迁移或排障。 |
| `docs/09_PHASE2_IDENTITY_CONSENT.md` | 邀请、角色、会话、同意、撤回、表结构与权限矩阵 | 身份与同意模块。 |
| `docs/10_PHASE3_CONTENT_CATALOG.md` | 内容契约、状态机、双人审核、可见性、缓存与离线策略 | 内容模块、种子、缓存或审核 API。 |
| `docs/11_PHASE4_AI_TECH_VALIDATION.md` | DeepSeek 网关、去标识、检索、输出审核和内部编排 | 模型接入和 AI 安全链路。 |
| `docs/12_PHASE5_RISK_SAFETY_EVALUATION.md` | L0—L3、规则/模型融合、事件、生成开关和限制 | 风险引擎；当前儿童试点轨道暂停。 |
| `docs/13_PHASE5F_RELEASE_EVALUATION.md` | 500 条固定集、V4 检查点、指标、失败和专业审核 | 只有用户明确恢复阶段5F后阅读并执行。 |
| `docs/decisions/ADR-001-TECH-STACK.md` | TypeScript/React/Fastify/pnpm 决策及版本依据 | 技术栈、运行时或依赖变更。 |
| `docs/decisions/ADR-002-MYSQL-DATABASE.md` | MySQL 替换 PostgreSQL 的原因、约束和本地实例 | 数据库设计、升级或迁移。 |
| `docs/decisions/ADR-003-DEEPSEEK-MODEL-GATEWAY.md` | 供应商、模型、秘密、结构输出和传输边界 | 模型配置、供应商或网关变更。 |
| `AI陪伴智能体_PRD_V0.2.md` | 受控儿童试点完整产品目标基线 | 仅在明确讨论/恢复儿童试点时。 |
| `AI陪伴智能体_PRD_V0.1.md` | 历史产品需求 | 追溯历史决策时，不作为现行范围。 |
| `prototype/README.md` | 高保真原型运行和交互说明 | UI 参考；不能替代正式设计/安全标准。 |
| `docx/执行日志.md` | 原型生成历史 | 追溯原型工作时。 |
| `开发日志/README.md`、`开发日志/TEMPLATE.md` | 日志格式、时机、禁止内容 | 每次结束前。 |
| `2026调研报告.docx` | 调研背景材料 | 需要业务调研背景时；不是运行或工程规范。 |

当前项目未发现 `db_schema.png`、独立 API reference、OpenAPI 文件或正式部署手册。`[待补充：若后续新增，应登记到 docs/00_INDEX.md 并在本节给出阅读顺序。]`

## 六、日常开发任务操作手册

### 6.1 新增一个 API 接口

当前结构是「共享契约 → Fastify 路由 → 服务层 → 数据访问 → 测试 → 装配」，不要从页面直接访问数据库。

1. 确认接口属于当前产品范围，不扩展范围。
2. 在 `packages/contracts/src/index.ts` 新增版本化请求/响应 Zod 契约和导出类型，并在 `index.test.ts` 写正常、非法字段、额外字段和边界测试。
3. 在 `apps/api/src/<module>/` 新增或修改服务层。数据库查询通过 Kysely，参数化执行；业务错误使用稳定错误码，不向客户端返回内部异常。
4. 在 `*-routes.ts` 注册路由。参考 `chat/child-chat-routes.ts`：请求与每个响应状态必须声明完整 JSON Schema，处理器只做 HTTP 边界转换。
5. 在 `apps/api/src/app.ts` 增加可注入依赖并注册路由；在 `server.ts` 创建真实服务。这样单元测试可使用替身，生产装配集中在入口。
6. 添加测试：
   - 契约测试：正常、非法、额外字段；
   - 服务单元测试：正常、边界、依赖失败；
   - 路由测试：HTTP 状态、响应契约、`x-request-id`、不泄露内部异常；
   - 涉及数据库时添加 `*.integration.test.ts`，使用 `xiaoban_test` 和合成数据；
   - 涉及权限时覆盖无令牌、错角色和停用状态；涉及写入时覆盖幂等/冲突。
7. 更新相应 `docs/` 标准、README（若命令/接口入口变化）和当天开发日志。

验证命令：

```powershell
pnpm --filter @xiaoban/contracts test
pnpm --filter @xiaoban/api test
pnpm --filter @xiaoban/api test:integration
pnpm check
```

### 6.2 修改数据库模型并生成迁移

本项目不使用「自动生成迁移」。迁移是显式、可审查的 Kysely/SQL 文件。

1. 在 `apps/api/src/database/migrations/` 创建下一个三位编号文件，例如 `008_<purpose>.ts`；导出 `up(database)` 和 `down(database)`。
2. 所有表明确 `ENGINE=InnoDB`、`utf8mb4`；时间使用 UTC/`DATETIME(6)`；关键状态使用关系列、检查约束和索引；精确码使用明确大小写敏感排序规则。
3. 同步 `apps/api/src/database/types.ts` 的 `DatabaseSchema` 类型，以及服务/契约/文档。
4. 先在测试库应用、回滚、重放。注意 MySQL DDL 不按多语句事务回滚设计；`db:rollback:test` 只回滚最近一条迁移，部分追加式审计迁移会在已有历史时故意拒绝回滚。
5. 集成测试通过后才迁移开发库。不要在生产使用自动 push，也不要为测试删除 `.local/mysql-data/`。

```powershell
pnpm db:start
pnpm db:verify
pnpm db:migrate:test
pnpm test:integration
pnpm db:rollback:test
pnpm db:migrate:test
pnpm test:integration
pnpm db:migrate
pnpm check
```

### 6.3 运行单元测试与集成测试

```powershell
# 全工作区单元/契约测试（先构建 contracts）
pnpm test

# 真实 xiaoban_test 数据库集成测试；需先启动并迁移测试库
pnpm db:start
pnpm db:migrate:test
pnpm test:integration

# 类型、秘密、测试和生产构建总检查
pnpm check
```

API 集成配置禁用文件并行，默认单用例超时 10 秒。测试只使用合成数据；禁止把真实输入、模型正文、秘密或供应商原始异常写入快照和日志。

### 6.4 打包构建与发布产物

```powershell
pnpm build
```

产物为：

- `packages/contracts/dist/`：共享 ESM 与声明文件；
- `apps/api/dist/`：Node ESM API；
- `apps/web/dist/`：Vite 静态站点。

交付前使用：

```powershell
pnpm check
pnpm test:integration
```

正式发布还缺少平台、版本 tag、制品仓库、签名、部署和回滚流程，不能只复制 `dist/` 就声称发布完成。

### 6.5 本地调试与日志查看

```powershell
pnpm db:start
pnpm dev
```

- `pnpm dev` 使用 Node watch/tsx 启动 API、Vite 启动 Web，输出在当前终端。
- 可用浏览器开发者工具检查前端；请求关联使用响应头 `x-request-id`。
- MySQL 启动故障查看 `.local/mysql-logs/error.log`；不得把可能敏感的日志整段粘贴到对话或开发日志。
- 在线模型调试只记录模型标识、版本、耗时、Token 计数等允许的元数据，不记录提示词、输入/回复正文、密钥或供应商原文。

远程日志：`[待补充：当前没有远程环境和集中日志。确定平台后补充安全访问命令、日志保留、脱敏规则和负责人；禁止临时共享生产秘密或完整用户文本。]`

### 6.6 数据备份与恢复

当前只允许本地合成数据，仓库**没有**批准的数据库备份/恢复脚本，也没有生产 RPO/RTO。不要把复制 `.local/mysql-data/`、删除数据目录或使用未知 3306 实例当作备份方案。

对于可重建的本地开发环境，权威来源是版本化迁移和幂等合成种子：

```powershell
pnpm db:start
pnpm db:migrate
pnpm db:migrate:test
pnpm db:seed:dev
pnpm db:verify
```

如果现有 `.local/mysql-data/` 异常，需要删除、重置或恢复，必须先停止操作并请求确认；不得自动重建覆盖。生产备份/恢复为 P0 缺口：`[待补充：由数据库负责人定义加密备份位置、最小权限账号、保留期、RPO/RTO、恢复演练和审计命令。]`

### 6.7 常用数据库操作

```powershell
pnpm db:start
pnpm db:verify
pnpm db:stop
```

## 七、注意事项与已知陷阱

### 7.1 特殊业务与安全规则

- 当前只有产品开发轨道活动；进入真实儿童试点、继续 5F、接入真实儿童/真实个人信息/真实通知必须暂停并取得明确确认。
- 合法聊天请求只能向客户端返回审核通过的 `model_reply` 或固定 `static_fallback`。供应商原文、内部异常、被拒危险候选、秘密、系统提示词和推理永远不能透传。
- L0—L3 分歧采用更高风险等级；L2/L3 只能返回固定现实行动，当前通知状态必须明确为 `not_sent`，不能伪装为真实送达。
- 内容只有当前发布、审核通过、有效期内且年龄匹配的版本可见；作者不能审核自己的版本。
- 儿童端只允许合成数据、会话内短时记忆、不保存历史；现实行动不是医疗、法律或紧急救援承诺。
- 生成控制默认为 `stopped`，依赖或门禁失败必须失败关闭。不要为「演示成功」绕过开关、审核或固定降级。

### 7.2 外部服务与降级

- DeepSeek 是唯一当前模型供应商配置；网络、超时、非 2xx、结构错误、缺密钥或输出拒绝都应映射为固定降级。
- 一次真实冒烟不代表模型质量或儿童安全通过；重复调用可能产生费用。未经明确任务不要运行在线冒烟、完整 500 条评测或批量模型调用。
- 当前没有 Redis、消息队列、通知平台或对象存储。不要编造这些服务的启动/恢复命令。

### 7.3 配置陷阱

- 本地 MySQL 是 `127.0.0.1:3307` 的 8.4.11，不是已有 3306 的 8.0.40。脚本不得停止、修复或迁移未知 3306 实例。
- 数据库连接固定 `utf8mb4` 和 UTC；界面显示再转换为 `Asia/Shanghai`。不要在数据库混用本地时区或三字节 `utf8`/`utf8mb3`。
- `DATABASE_PASSWORD` 至少 16 字符；DeepSeek 地址和模型被白名单冻结。非法配置会在监听端口前安全失败。
- 终端继承数据库/模型变量、未知进程占用 3000/5173 都会被启动守卫拒绝。先识别来源，不要强行杀进程或改端口。

### 7.4 权限、秘密与文件

- `.local/mysql-secrets/` 和 `.local/model-secrets/` 仅当前 Windows 用户可读，不进入 Web、不提交、不截图、不打印。
- 数据库应用、迁移和测试账号分权；应用账号不能建表。内容运营角色和安全角色目前只是受控测试身份，不是生产 MFA 身份。
- `.local/evaluation/` 的 V1—V4 检查点虽然被忽略，仍是追加式质量证据；不得覆盖或清理。
- 删除、重置 `.local/mysql-data/`，升级 MySQL，或重新安装覆盖现有目录都属于破坏性操作，必须单独确认。
- 工作区已于 2026-09-10 初始化为 Git 仓库并同步远程 `origin/main`。仓库内禁止破坏性 Git 操作（如 `git gc` 会损坏对象库），沙箱内 `git` 命令的已知坑见 `.workbuddy/memory/MEMORY.md`。

### 7.5 版本与迁移陷阱

- Node 低于 22.12 不满足 Vite 8 要求；使用 pnpm 11，不能混用 npm/yarn 生成其他锁文件。
- 依赖精确解析以 `pnpm-lock.yaml` 为准，`package.json` 使用范围不等于已安装精确版本。
- MySQL DDL 不能假设多语句事务回滚；迁移要小、可前向修复，并验证测试库 down/up。
- `007_generation_control.ts` 在存在变更历史时故意拒绝向下回滚，避免删除追加式安全证据；类似保护不是 Bug。
- `dist/`、`node_modules/`、`tsconfig.tsbuildinfo` 和 `.pnpm-store/` 是生成物。不要手工编辑；通过构建重建。

## 八、任务完成检查表

- [ ] 仍在当前产品轨道和阶段范围内；未把计划写成完成。
- [ ] 每条改动都能追溯到任务目标，没有顺手重构。
- [ ] 契约、API、数据、权限、安全和文档保持同步。
- [ ] 已按风险运行静态、单元、集成、核心流程、视觉、安全、故障和回滚验证；不能运行的项目已明确记录。
- [ ] 未读取、打印或提交秘密、真实账号、真实儿童信息或敏感正文。
- [ ] 当天 `开发日志/YYYY-MM-DD.md` 已记录完成事实、修改文件、具体验证、待办和风险。
- [ ] 最终汇报先给结果，再列验证、未完成/风险、下一最小步骤和绝对路径链接。
