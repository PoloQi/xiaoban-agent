# CLAUDE.md

## 项目：小伴（留守儿童情感陪伴智能体）

儿童情感陪伴产品（受控试点方向），智能体与儿童进行情感陪伴对话。当前定位是「能真实对话」，不是纯展示壳。

### 项目路径
`D:\code\agent`（pnpm monorepo）

### 核心原则（务必遵守）
1. 先跑起来再逐步优化，不预先设计宏大愿景、不做过度设计。
2. 最核心的功能是「智能体能与儿童真实对话」。安全只做基本护栏，不因纠结安全而锁死对话，也不只做空壳。
3. 每次只推进一个可验证目标，小步稳定，先验证再继续。

### 标准文档路径
- Agent 工作规则（最高优先级，操作前必读）：`agent.md`
- 工作交接快照：`docs/16_AGENT_HANDOVER.md`
- 规范索引：`docs/00_INDEX.md`
- 分阶段路线：`docs/07_EXECUTION_ROADMAP.md`
- 当前产品 PRD：`AI陪伴智能体_PRD_V0.4_产品版.md`
- 技术架构：`docs/02_TECHNICAL_ARCHITECTURE.md`
- 本地 MySQL 开发：`docs/08_LOCAL_MYSQL_DEVELOPMENT.md`

### 开发日志
- 日志目录：`开发日志/`
- 日志格式：`YYYY-MM-DD.md`

### 技术栈
- 前端：React 19 + Vite
- 后端：Fastify 5 + TypeScript
- 数据库：MySQL 8.4 + Kysely
- 契约校验：Zod
- 模型：DeepSeek（deepseek-v4-pro）
- 包管理：pnpm 11（Node ≥22.12）

### 工作说明
- 生成开关默认关闭，儿童端「陪我聊」返回固定降级文案；真实对话需 `pnpm generation:on` + 有效 DeepSeek key
- 遵守 agent.md 的当前轨道与暂停条件，不擅自进入真实儿童试点
- 每次开发结束更新当天开发日志
