# 分支任务书：阶段6 风险工作台（Agent A）

> 分支：codex/phase6-risk-console
> 基线：main a45273f（6A.6 已完成）
> 工作目录：D:\code\agent\.worktrees\phase6-risk-console
> 开工前必读（按 agent.md 顺序）：agent.md → docs/00_INDEX.md → docs/07_EXECUTION_ROADMAP.md → docs/02/03/04/06 → 开发日志/2026-09-17.md

## 一句话目标
在无真实通知、仅 synthetic 工单边界内，为已验证成年人提供风险工单的只读+人工处置工作台 API 与成人端 UI（接单、记录处置说明、解决、关闭），不发送任何真实消息。

## 范围内（只做这些）
1. 后端新增文件放 apps/api/src/tickets/（建议 risk-console-service.ts、risk-console-routes.ts 及对应测试），复用现有 RiskTicketStore / risk-ticket-state-machine，不重写状态机。
2. API：成人监护鉴权下的工单列表、详情、接单（claim/assign）、追加处置记录、解决、关闭；严格权限矩阵，禁止儿童端与普通监护人越权访问他人工单。
3. 前端新增 apps/web/src/RiskConsole.tsx（+ 独立 css），在成人端导航内挂载入口；遵守 docs/04 设计令牌与 375/768 双视口；普通完整聊天继续不可见，只展示风险摘要（不展示供应商原文、秘密、提示词、推理、危险候选）。
4. 不注册任何发送动作；工作台只能读取通知/回执状态（含 simulated/networkCallMade:false 边界文案），不得触发通知重发。

## 明确非目标（禁止）
- 不改 outbox 租约、attempt runner、receipt runner、LocalSyntheticNotificationAdapter（属 Agent B / 6A 既有文件）。
- 不做通知降级提示、退避调度器、数据权利请求（属 Agent B）。
- 不接入真实渠道、真实回执、真实个人信息；不新增外部依赖。
- 不恢复 5F 评测、不覆盖 V1–V7 证据、不进入阶段7。
- 不新增数据库迁移；如确有必要，迁移编号用 019（018 已让给 Agent B），且必须先在本任务书追加说明。

## 文件边界（避免与 Agent B 冲突）
- 你拥有：apps/api/src/tickets/ 中**新增**的 console 相关文件、apps/web/src/RiskConsole.*。
- 共享文件只允许"追加式"改动并保持区块隔离：
  - apps/api/src/app.ts：只加 registerRiskConsoleRoutes 的 import 与一行注册；
  - apps/web/src/App.tsx：只加 RiskConsole 挂载区块；
  - packages/contracts/src/index.ts：只追加 WORKBENCH/console 区块的契约与版本，不改既有枚举字面量；
  - docs/：只更新 00/02/07 中工作台相关段落（用小节追加，标注日期），不同时改 03 安全文档中通知通道章节。
- 开发日志：只在 开发日志/2026-09-17.md（或新建当日日志）追加 `### A-` 前缀小节。

## 验证（完成前必须全绿，结果如实写入日志）
- pnpm --filter @xiaoban/contracts test；pnpm --filter @xiaoban/api test（离线单测）；
- 需 MySQL 的集成测试：apps/api 下 `node --env-file=../../.local/mysql-secrets/database.env ./node_modules/vitest/vitest.mjs run --config vitest.integration.config.ts`（遵守 docs/08）；
- pnpm typecheck（三工作区）；pnpm --filter @xiaoban/api build；pnpm --filter @xiaoban/web build（如有）；
- 权限回归：未授权/儿童/他户监护人访问工作台一律 403；追加式事件触发器仍禁止 UPDATE/DELETE。

## 交付与合并
- 小步提交到本分支；每个切片更新开发日志（完成事实/修改文件/验证结果/待办/风险）。
- 完成后推送并在 main 上发起合并；合并顺序：Agent B 先合，本分支后合（或由用户指定）。冲突仅限 app.ts/App.tsx/contracts 追加区块，按区块保留双方。
- SLA 桌面演练不在本分支做（两分支合并后统一进行）。

---

## 执行补充说明（2026-09-17 Agent A）

### 启用 019 迁移（已在任务书预授权范围内）

现有 `risk_tickets`（迁移 016）只有合成工单自身字段，没有儿童归属与责任人字段；既有 `risk_ticket_events` 枚举也没有“接单/追加处置备注”。为落地“他户监护人 403、接单、追加处置记录、解决、关闭”，本分支启用编号 **019**（018 已让给 Agent B，不占用）：

- 仅对 `risk_tickets` **追加可空列**：`child_id`、`claimed_by_guardian_id`、`claimed_at`，不改变既有状态枚举、状态机、outbox、attempt/receipt runner 或 016/017 触发器；
- 新增独立 append-only 表 `risk_ticket_console_notes` 保存 `claimed` 与 `disposition_note`，并配 UPDATE/DELETE 禁止触发器；处置备注仍强制 `虚构处置：` 前缀；
- “解决/关闭”继续复用 `RiskTicketStore.applyEvent` 与既有 `risk_ticket_events`，不重写状态机、不新增通知发送动作；
- 迁移向下回滚只删除本迁移新增的触发器、备注表与追加列。

### 装配层最小追加（保持纯追加、区块隔离）

除已列明的 `app.ts` / `App.tsx` / contracts 外，编译与装配还必须对以下既有文件做**纯追加式**改动，不修改既有行语义：

- `apps/api/src/database/types.ts`：仅追加 019 新列/新表接口；
- `apps/api/src/server.ts`：仅追加 `RiskConsoleService` 的 import、实例化与 `riskConsoleService` 依赖传入；
- 不修改 outbox 租约、attempt runner、receipt runner、`LocalSyntheticNotificationAdapter`，也不改通知通道章节。