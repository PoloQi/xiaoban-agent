# 分支任务书：阶段6 通知韧性与数据权利（Agent B）

> 分支：codex/phase6-notice-resilience
> 基线：main a45273f（6A.6 已完成）
> 工作目录：D:\code\agent\.worktrees\phase6-notice-resilience
> 开工前必读（按 agent.md 顺序）：agent.md → docs/00_INDEX.md → docs/07_EXECUTION_ROADMAP.md → docs/02/03/06 → 开发日志/2026-09-17.md

## 一句话目标
在无外部网络、仅本地合成边界内，补齐通知故障用户侧降级、本地退避调度演练，以及数据权利请求（删除/导出申请与审计链路），支撑阶段6"通知故障降级"和"删除和审计链路"两项退出门槛。

## 范围内（建议切片顺序）
1. 6A.7 通知故障用户侧降级：当工单/通道为 failed/timed_out/escalated 或在确认窗口内未回执时，成人端与儿童相关页面只显示安全中性的"暂时没能送达，可稍后查看/请直接当面告诉可信任大人"提示；未回执绝不显示成功；不透传内部异常。
2. 6A.8 本地退避调度演练：在不启动常驻 worker 的前提下，用确定性 runner 演示"到期可重试行被领取、退避窗口内不被领取、达到上限后升级"的完整调度判断（复用 RiskOutboxClaimWorker 的门槛，不复制逻辑）；仍固定 networkCallMade:false。
3. 6B.1 数据权利请求：新增 apps/api/src/datarights/ 模块——监护人提交删除/导出请求、校验权限与身份、记录追加式审计事件、执行/排队删除的最小闭环（虚构数据）；新增迁移编号 018（018_datarights_requests.ts），含回滚与触发器禁改禁删审计。
4. 前端只做最小状态提示（可放 guardian-dashboard 相关新文件），不做独立工作台。

## 明确非目标（禁止）
- 不改工作台接单/关闭逻辑、不建 RiskConsole UI（属 Agent A）。
- 不接真实短信/邮件/微信/推送、不存真实联系方式、不做真实送达/查看/确认。
- 不启动常驻 worker/定时器服务；调度只做可重放的本地演练 runner。
- 不恢复 5F、不覆盖 V1–V7、不进入阶段7；不新增外部依赖。

## 文件边界（避免与 Agent A 冲突）
- 你拥有：apps/api/src/datarights/（新目录）、apps/api/src/database/migrations/018_*、apps/api/src/tickets/ 中仅"通知降级/退避调度"必需的新 runner 文件（新文件名，不改既有 6 个 runner/adapter/store 文件，确需扩展优先新文件包装）。
- 共享文件只允许追加式改动并保持区块隔离：
  - apps/api/src/app.ts：只加本分支路由的 import 与注册行；
  - packages/contracts/src/index.ts：只追加 NOTICE/DATARIGHTS 区块契约，不改既有枚举字面量；
  - apps/web/src/：降级提示尽量用独立新文件（如 notice-status.*），不改 GuardianDashboard.tsx 主体，仅在其路由处最小挂载；
  - docs/：更新 00/02/03/07 中通知降级、退避、数据权利段落（小节追加并标注日期）。
- 开发日志：追加 `### B-` 前缀小节。

## 验证（完成前必须全绿，结果如实写入日志）
- 契约/离线单测/MySQL 集成测试命令同 Agent A（见 docs/08）；新迁移需在 xiaoban_test 验证 应用→回滚→重放；
- pnpm typecheck（三工作区）、api build、web build；
- 降级回归：failed/timed_out/escalated/未回执 四种状态均不出现成功文案；删除请求产生不可改删的审计记录，删除后儿童自由功能按权限停止；
- 全程无外部网络请求，并在日志中明确"不代表真实通知链路达成"。

## 交付与合并
- 小步提交到本分支；每个切片更新开发日志。
- 完成后推送；本分支计划**先于** Agent A 合并到 main（迁移号与路由先行）。
- SLA 桌面演练不在本分支做（两分支合并后统一进行）；阶段6总体验收待工作台与本分支全部合并后评估。
