# ADR-001：阶段 1 技术栈与本地基线

- 状态：已接受
- 日期：2026-08-17
- 决策范围：工程基础

> 数据库选型已由 `ADR-002-MYSQL-DATABASE.md` 部分替代；其他技术栈决策继续有效。

## 1. 背景

项目已完成高保真原型与产品化 PRD，需要从静态原型过渡到可运行、可测试且不含真实业务数据的产品骨架。首个工程决策应控制技术数量，保留共享契约和后续数据库能力，同时避免提前引入模型与复杂部署。

## 2. 本地环境核验

本次开始前验证到：

| 工具 | 本地结果 | 本次处理 |
|---|---|---|
| Node.js | 22.18.0 | 直接复用 |
| pnpm | 11.19.0；安装器宿主运行时为 Node 24.19.0 | 直接复用并锁定主版本；应用命令仍解析到 Node 22.18.0 |
| npm | 11.13.0 | 保留，不作为仓库包管理器 |
| Corepack | 0.33.0 | 保留 |
| Git | 2.54.0.windows.1 | 直接复用 |
| PostgreSQL / psql | 未发现 | 历史盘点；ADR-002决定不再安装 |
| Docker / Podman | 未发现 | 本阶段不为脚手架额外引入 |

Node 22.18.0 满足 Vite 8 所需的 Node 22.12 以上版本，也在 Fastify 5 支持的 Node 20/22 范围内。

## 3. 决策

采用以下基线：

| 层 | 决策 |
|---|---|
| 语言 | TypeScript，严格模式 |
| 前端 | React 19 + Vite 8，移动优先 |
| API | Fastify 5，模块化单体 |
| 数据库 | 历史决定为PostgreSQL；已由ADR-002替换为MySQL 8.4 LTS |
| 契约 | 独立 `packages/contracts`，以 Zod 提供运行时校验和类型推导 |
| 测试 | Vitest；API 使用 Fastify `inject` 做无端口集成测试 |
| 包管理 | pnpm workspace，单一 lockfile |
| 运行时 | Node.js 22 LTS 线，`.node-version` 固定已验证的 22.18.0，最低约束为 `>=22.12` |

## 4. 目录边界

- `apps/web` 只负责界面和调用 API；
- `apps/api` 负责 HTTP 边界和后续业务模块；
- `packages/contracts` 不依赖应用层，可被 Web、API 和测试复用；
- `prototype` 继续作为设计参考，不被正式应用直接依赖。

## 5. 当前明确不做

- 不接入大模型或模型密钥；
- 不采集真实个人信息；
- 不建立登录、监护通知和长期记忆；
- 不引入 Redis、消息中间件、微服务、容器编排；
- 不在本次顺带安装数据库。

## 6. 影响与复核条件

该决策支持最小 Web/API 纵向闭环和共享契约测试。数据库部分后续由ADR-002更新。新增第三方服务、模型渠道、敏感字段或拆分微服务时必须另写 ADR。

## 7. 首次解析版本与依据

首次 lockfile 解析到的主要版本为 React 19.2.8、Vite 8.2.1、Fastify 5.12.0、TypeScript 7.0.2、Vitest 4.1.10 和 Zod 4.4.3。版本范围记录在各工作区 `package.json`，精确依赖图记录在根目录 `pnpm-lock.yaml`。

兼容性判断依据：

- React 版本说明：https://react.dev/versions
- Vite 入门与 Node 要求：https://vite.dev/guide/
- Vite 版本支持策略：https://vite.dev/releases
- Fastify LTS 支持：https://fastify.dev/docs/latest/Reference/LTS/
- Fastify 5 迁移要求：https://fastify.dev/docs/v5.0.x/Guides/Migration-Guide-V5/
- pnpm 构建脚本白名单：https://pnpm.io/settings/build

依赖安装保持 pnpm 默认的严格构建脚本策略，只在 `pnpm-workspace.yaml` 中明确允许 Vite/tsx 所需的 `esbuild`，未启用全局脚本放行。
