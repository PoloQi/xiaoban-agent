# 小伴（xiaoban）技术文档

- 文档版本：v1.0
- 撰写日期：2026-08-24
- 适用代码基线：本地开发/测试阶段（未正式上线）
- 文档性质：对当前代码与迁移文件的**事实性描述**，非安全或产品决策依据

> **依据说明**：本文档所有数据库表结构、字段、约束、索引与触发器的描述，均直接取自
> `apps/api/src/database/migrations/` 下的 000—007 迁移文件与 `apps/api/src/database/types.ts`，
> 不包含任何推测或未实现的表。其余部分整合自 `docs/` 各标准、ADR 决策与当前 PRD。
> 仓库事实与本文档冲突时，以代码与迁移文件为准。

---

## 1. 项目概述

「小伴」是面向 9—14 岁农村留守儿童的 AI 情感陪伴产品，角色名「小禾」。产品通过短时情绪承接、安全知识和现实行动建议，帮助儿童减少无目的短视频使用，并在问题超过 AI 能力时连接真实成年人。

当前仓库处于**受控试点前置技术验证阶段**：轻登录 → 内容目录「去做点事」→ 陪我聊多轮对话的本地闭环可运行。**当前未向真实儿童开放**，不接入真实个人信息、真实通知或长期记忆。

核心安全立场（双轨语义）：每个合法请求只返回审核通过的模型结果或固定降级结果；供应商原文、内部异常、危险候选、秘密、提示词或推理一律不透传。

---

## 2. 技术栈

| 层 | 选型 | 依据 |
|---|---|---|
| 语言 | TypeScript（严格模式，目标 ES2022） | `tsconfig.base.json` |
| 前端 | React 19 + Vite 8，移动优先 | ADR-001 |
| API | Node.js 22 LTS + Fastify 5，模块化单体 | ADR-001 |
| 数据库 | MySQL 8.4.11 LTS Community + InnoDB | ADR-002 |
| 数据访问 | Kysely（MySQL dialect）+ mysql2 | ADR-002 |
| 契约校验 | Zod（`packages/contracts` 共享运行时契约） | ADR-001 |
| 测试 | Vitest；API 集成测试用 Fastify inject + 真实测试库 | ADR-001 |
| 包管理 | pnpm workspace（pnpm 11） | ADR-001 |
| 模型 | DeepSeek 官方 API，固定 `deepseek-v4-pro` | ADR-003 |

首版**不引入** Redis、消息中间件、Kubernetes、微服务或第二数据库。通知类任务预留 MySQL InnoDB outbox 表 + 独立 worker（`FOR UPDATE SKIP LOCKED` 领取），当前尚未实现。

---

## 3. 系统架构

### 3.1 架构风格

模块化单体，不采用微服务。优先保证权限、数据边界、可测试与可回滚。模块间通过明确接口调用，**禁止页面直接读写其他模块的数据表**。

### 3.2 目录结构

```text
apps/
  api/                 # Fastify 模块化单体
    src/
      server.ts        # 进程入口（装配真实服务）
      app.ts           # 创建应用、健康/就绪、错误映射、路由装配
      config.ts        # 环境配置校验
      database/        # Kysely 客户端、类型、迁移、合成种子
      identity/        # 邀请、登录、角色、会话
      content/         # 内容目录、可见性、缓存
      ai/              # DeepSeek 网关、内部编排、检索
      safety/          # 去标识、输出审核、风险引擎、生成开关
      chat/            # 儿童「陪我聊」服务与路由
  web/                 # React/Vite 移动优先前端
packages/
  contracts/           # Web 与 API 共用的 Zod 契约与 TS 类型
docs/                  # 开发/安全/设计/测试/路线标准
prototype/             # 高保真设计参考（不承载正式后端逻辑）
scripts/mysql/         # 项目专用 MySQL 安装、启停、验证
开发日志/              # 按日可验证开发事实
```

### 3.3 模块边界

| 模块 | 职责 |
|---|---|
| identity | 邀请、登录、站点、角色、会话 |
| consent | 监护同意、撤回、政策版本、权限变化 |
| child-profile | 化名、年龄段、兴趣、未成年人模式 |
| conversation | 会话状态、时长、退出、短期上下文 |
| content | 活动、知识、来源、年龄、审核版本 |
| ai-orchestrator | 意图、检索、模型网关、结构化输出 |
| safety | 输入检测、风险分级、输出审核 |
| safety-case | 风险工单、责任人、SLA、处置时间线 |
| notification | 发送、回执、重试、升级、幂等（预留） |
| data-rights | 查阅、复制、更正、删除、撤回、注销 |
| audit | 高权限操作、版本、安全事件记录 |
| evaluation | 测试集、运行结果、发布门禁 |

---

## 4. AI 请求链路

顺序固定，任何一步失败都不得绕过后续安全检查直接展示模型原文：

1. 鉴权、未成年人模式、开放时段、频率与会话时长；
2. 输入长度、提示注入、个人信息与风险检测；
3. 根据意图选择静态流程、知识检索、活动或模型；
4. 仅组装去标识、最小化上下文；
5. 通过模型网关调用指定版本；
6. 解析结构化结果；
7. 输出安全、事实来源、年龄、依赖话术检查；
8. 通过后展示，否则进入静态降级或人工流程；
9. 记录请求、模型、提示词、知识、安全策略版本。

### 4.1 已实现内部管线（阶段 4A）

儿童「陪我聊」实际链路为：

```
生成门禁（fail-closed）
  → 输入去标识（input-deidentifier）
  → 审核内容检索（reviewed-content-retrieval）
  → DeepSeek 网关（deepseek-gateway）
  → 输出审核（output-auditor）
  → 审核通过回复 / 固定静态降级
```

关键约束（依据契约与代码）：

- 生成开关 `generation_controls` 默认 `stopped`；记录缺失或门禁异常统一映射为 `unknown + fail_closed + stop`，三类下游均不执行。
- 输入去标识将手机号、邮箱、身份证号替换为 `[PHONE]`/`[EMAIL]`/`[ID_NUMBER]`；明确姓名、学校全称、地址、联系人、秘密或提示注入线索按失败关闭处理。
- 检索只读「已发布 + 审核通过 + 有效期内 + 年龄匹配」的当前版本，最多 3 项。
- 输出审核拒绝：外部联系/链接、危险指令、专业越界、依赖排他话术、系统提示词泄露。
- 任何环节失败/结构无效均返回固定静态文案，不回显供应商原文。

### 4.2 安全护栏（阶段 5）

- 风险分级 L0—L3（`risk-policy-2026-08-v1`），九类风险类别；
- 确定性规则引擎（`risk-rules-2026-08-v3`）与独立 DeepSeek 分类器（`risk-classifier-deepseek-v2`）融合取更高等级；
- L0 继续审核 AI；L1 有边界支持；L2/L3 停止生成并返回固定现实步骤，`requiresHuman=true`、`eventRequired=true`、`notificationStatus=not_sent`。

---

## 5. 数据库设计（依据迁移文件）

### 5.1 选型与基线

依据 ADR-002 与 `docs/08_LOCAL_MYSQL_DEVELOPMENT.md`：

| 项目 | 基线 |
|---|---|
| 版本 | MySQL Community Server 8.4.11 LTS |
| 引擎 | InnoDB |
| 字符集/排序规则 | `utf8mb4` / `utf8mb4_0900_ai_ci` |
| 会话时区 | `+00:00`（连接建立后 `SET SESSION time_zone = '+00:00'`） |
| 本地地址 | `127.0.0.1:3307` |
| 开发库 | `xiaoban_dev` |
| 测试库 | `xiaoban_test` |

工程约束（ADR-002）：

- 所有表显式 `ENGINE=InnoDB`、`DEFAULT CHARSET=utf8mb4`；
- 精确比较字段（ID、code、状态、token 摘要）使用 `CHARACTER SET ascii COLLATE ascii_bin` 或二进制类型；
- 时间统一 `DATETIME(6)` 按 UTC 解释，界面层转 Asia/Shanghai；
- 关键业务状态用关系列 + `CHECK` 约束，不把状态只放 JSON；JSON 仅承载经 Zod 校验的活动/知识正文、风险标签、快照等；
- 生产禁止自动 push 改表，只执行纳入版本控制的迁移。

### 5.2 数据库账号分权

| 账号 | 数据库 | 权限 |
|---|---|---|
| `xiaoban_migrator` | `xiaoban_dev`、`xiaoban_test` | 仅两库迁移权限 |
| `xiaoban_app` | `xiaoban_dev` | SELECT / INSERT / UPDATE / DELETE |
| `xiaoban_test` | `xiaoban_test` | SELECT / INSERT / UPDATE / DELETE |
| `root` | 本机维护 | 仅本地维护脚本 |

应用与测试账号不能建库或改表。连接池默认上限 5，项目 MySQL 最大连接数 30。

### 5.3 迁移清单

| 迁移 | 阶段 | 内容 |
|---|---|---|
| `000_database_baseline` | 阶段1 | 仅 `SELECT 1`，无业务表（Kysely 元数据由 Migrator 自动建立） |
| `001_identity_consent` | 阶段2 | 新建 10 张身份/同意/会话/审计表，插入 2 条政策版本 |
| `002_content_catalog` | 阶段3A | 新建 3 张内容/版本/审核表 |
| `003_content_workflow` | 阶段3B | 新建 `content_commands`；扩展 `access_sessions` 与 `audit_entries` |
| `004_safety_events` | 阶段5D | 新建 3 张风险事件表 + 追加式触发器 |
| `005_safety_audit_actor` | 阶段5D | 扩展 `audit_entries` 审计主体 |
| `006_safety_retention_cascade` | 阶段5D | `safety_event_overrides` 外键改为 `ON DELETE CASCADE` |
| `007_generation_control` | 阶段5E | 新建 2 张生成开关表 + 追加式触发器 |

当前业务表共 **19 张**（与 `database/types.ts` 的 `DatabaseSchema` 一致）。

### 5.4 表结构总览

按域分组，字段描述以最终迁移状态为准。

#### 5.4.1 身份与同意域（依据 `001_identity_consent`、`003_content_workflow`）

**`policy_versions`** — 政策版本

| 字段 | 类型 | 约束 |
|---|---|---|
| id | VARCHAR(64) ascii | PK |
| policy_type | VARCHAR(32) ascii | `guardian_consent` / `child_notice` |
| content_hash | CHAR(64) ascii | 政策摘要 SHA-256 |
| status | VARCHAR(16) ascii | `active` / `retired` |
| effective_at | DATETIME(6) | |
| created_at | DATETIME(6) | |

**`sites`** — 受控试点站点

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| display_name | VARCHAR(80) | |
| status | VARCHAR(16) ascii | `active` / `paused` |
| created_at | DATETIME(6) | |

**`pilot_invitations`** — 试点邀请

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| site_id | CHAR(36) ascii | FK → `sites(id)` |
| batch_name | VARCHAR(80) | |
| code_hash | BINARY(32) | UNIQUE，邀请码 SHA-256 |
| status | VARCHAR(24) ascii | `active` / `guardian_confirmed` / `consumed` / `expired` |
| expires_at | DATETIME(6) | |
| created_at | DATETIME(6) | |
| updated_at | DATETIME(6) | |

索引：`uq_pilot_invitation_code_hash`、`idx_pilot_invitation_site_status`。

**`guardian_accounts`** — 监护人账号

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| alias | VARCHAR(20) | 化名 |
| verification_method | VARCHAR(40) ascii | 固定 `controlled_site_invite` |
| status | VARCHAR(16) ascii | `active` / `deactivated` |
| created_at | DATETIME(6) | |

**`enrollments`** — 登记关系

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| invitation_id | CHAR(36) ascii | UNIQUE，FK → `pilot_invitations(id)` |
| guardian_id | CHAR(36) ascii | FK → `guardian_accounts(id)` |
| child_id | CHAR(36) ascii NULL | FK → `child_accounts(id)` |
| status | VARCHAR(24) ascii | `guardian_confirmed` / `active` / `withdrawn` |
| guardian_request_id | CHAR(36) ascii | UNIQUE，幂等键 |
| child_request_id | CHAR(36) ascii NULL | UNIQUE，幂等键 |
| created_at | DATETIME(6) | |
| completed_at | DATETIME(6) NULL | |
| updated_at | DATETIME(6) | |

**`child_accounts`** — 儿童账号（强制未成年人模式）

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| site_id | CHAR(36) ascii | FK → `sites(id)` |
| alias | VARCHAR(20) | 化名 |
| age_band | VARCHAR(8) ascii | `9_11` / `12_14` |
| minor_mode | BOOLEAN | 强制 `TRUE` |
| status | VARCHAR(16) ascii | `active` / `deactivated` |
| child_notice_version | VARCHAR(64) ascii | 儿童须知版本 |
| notice_acknowledged_at | DATETIME(6) | |
| created_at | DATETIME(6) | |
| updated_at | DATETIME(6) | |

**`guardian_consents`** — 监护人同意记录

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| enrollment_id | CHAR(36) ascii | UNIQUE，FK → `enrollments(id)` |
| guardian_id | CHAR(36) ascii | FK → `guardian_accounts(id)` |
| child_id | CHAR(36) ascii NULL | FK → `child_accounts(id)` |
| policy_version | VARCHAR(64) ascii | FK → `policy_versions(id)` |
| scope_code | VARCHAR(40) ascii | 固定 `pilot_account_safety` |
| status | VARCHAR(16) ascii | `active` / `withdrawn` |
| granted_at | DATETIME(6) | |
| withdrawn_at | DATETIME(6) NULL | |
| withdraw_reason_code | VARCHAR(32) ascii NULL | `guardian_choice` / `pilot_exit` / `privacy_request` |
| withdraw_request_id | CHAR(36) ascii NULL | UNIQUE，幂等键 |

**`guardian_child_links`** — 监护人-儿童关系

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| guardian_id | CHAR(36) ascii | FK → `guardian_accounts(id)` |
| child_id | CHAR(36) ascii | FK → `child_accounts(id)` |
| relationship_role | VARCHAR(16) ascii | 固定 `guardian` |
| verification_status | VARCHAR(16) ascii | 固定 `verified` |
| verified_at | DATETIME(6) | |
| deactivated_at | DATETIME(6) NULL | |

唯一约束：`uq_guardian_child_link(guardian_id, child_id)`。

**`access_sessions`** — 访问会话（阶段 3B 扩展后）

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| enrollment_id | CHAR(36) ascii NULL | FK → `enrollments(id)`；内容角色为 NULL |
| role | VARCHAR(16) ascii | `guardian` / `child` / `content_author` / `content_reviewer` |
| subject_id | CHAR(36) ascii | |
| child_id | CHAR(36) ascii NULL | FK → `child_accounts(id)` |
| token_hash | BINARY(32) | UNIQUE，令牌 SHA-256（不存明文） |
| created_at | DATETIME(6) | |
| revoked_at | DATETIME(6) NULL | |

约束：`chk_access_session_scope` — `guardian`/`child` 必须 `enrollment_id` 非空；`content_author`/`content_reviewer` 必须 `enrollment_id`、`child_id` 均空。

**`audit_entries`** — 审计（阶段 3B/5D 扩展后）

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| actor_type | VARCHAR(16) ascii | `system` / `guardian` / `child` / `content_operator` / `safety_operator` |
| actor_id | CHAR(36) ascii NULL | |
| action | VARCHAR(64) ascii | |
| target_type | VARCHAR(40) ascii | |
| target_id | CHAR(36) ascii | |
| request_id | CHAR(36) ascii | |
| metadata | JSON | 审计元数据（不含敏感正文） |
| created_at | DATETIME(6) | |

索引：`idx_audit_target_time(target_type, target_id, created_at)`、`idx_audit_request(request_id)`。

#### 5.4.2 内容目录域（依据 `002_content_catalog`）

**`content_items`** — 内容条目（身份与版本分离）

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| content_type | VARCHAR(16) ascii | `activity` / `knowledge` |
| slug | VARCHAR(80) ascii | UNIQUE |
| lifecycle_status | VARCHAR(16) ascii | `draft` / `published` / `disabled` |
| active_version_id | CHAR(36) ascii NULL | 复合 FK → `content_versions(item_id, id)` |
| created_at | DATETIME(6) | |
| updated_at | DATETIME(6) | |

约束：`chk_content_item_active_version` — `draft` 时 `active_version_id` 为空；`published`/`disabled` 时非空。

**`content_versions`** — 内容不可变版本

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| item_id | CHAR(36) ascii | FK → `content_items(id)` |
| version_number | INT UNSIGNED | ≥ 1；`(item_id, version_number)` 唯一 |
| review_status | VARCHAR(16) ascii | `draft` / `in_review` / `approved` / `rejected` |
| title | VARCHAR(80) | |
| summary | VARCHAR(240) | |
| content_body | JSON | 经 Zod 校验的活动/知识正文（`JSON_TYPE=OBJECT`） |
| age_band | VARCHAR(8) ascii | `9_11` / `12_14` / `both` |
| source_kind | VARCHAR(24) ascii | `synthetic_test` / `official` / `institution_reviewed` / `local_pilot` |
| source_label | VARCHAR(160) | |
| source_url | VARCHAR(512) NULL | |
| valid_from | DATETIME(6) | |
| expires_at | DATETIME(6) | > valid_from |
| risk_tags | JSON | 数组（`JSON_TYPE=ARRAY`），最多 6 个标签 |
| author_id | CHAR(36) ascii | |
| created_at | DATETIME(6) | |

复合唯一键：`(item_id, id)`、`(id, author_id)` 供 `content_items` 与 `content_reviews` 外键引用。

**`content_reviews`** — 内容审核（禁止自审）

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| version_id | CHAR(36) ascii | UNIQUE，复合 FK → `content_versions(id, author_id)` |
| author_id | CHAR(36) ascii | |
| reviewer_id | CHAR(36) ascii | |
| decision | VARCHAR(16) ascii | `approved` / `rejected` |
| reason | VARCHAR(400) | |
| created_at | DATETIME(6) | |

约束：`chk_content_review_two_person` — `author_id <> reviewer_id`（数据库层禁止作者自审）。

#### 5.4.3 内容工作流域（依据 `003_content_workflow`）

**`content_commands`** — 内容写命令幂等表

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| request_id | CHAR(36) ascii | UNIQUE，幂等键 |
| actor_id | CHAR(36) ascii | |
| command_type | VARCHAR(24) ascii | `create_item` / `create_version` / `submit_review` / `review` / `publish` / `disable` / `rollback` |
| request_hash | CHAR(64) ascii | |
| target_item_id | CHAR(36) ascii | FK → `content_items(id)` |
| result_body | JSON | 已验证响应（`JSON_TYPE=OBJECT`） |
| created_at | DATETIME(6) | |

#### 5.4.4 风险事件域（依据 `004_safety_events`、`006_safety_retention_cascade`）

**`safety_access_grants`** — 安全角色访问凭据

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| actor_id | CHAR(36) ascii | |
| role | VARCHAR(32) ascii | `duty_safety_officer` / `event_owner` |
| token_hash | BINARY(32) | UNIQUE |
| created_at | DATETIME(6) | |
| revoked_at | DATETIME(6) NULL | |

**`safety_events`** — 风险事件（仅合成 L2/L3）

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| request_id | CHAR(36) ascii | UNIQUE，幂等键 |
| request_hash | CHAR(64) ascii | |
| synthetic | BOOLEAN | 强制 `TRUE` |
| case_reference | VARCHAR(64) ascii | UNIQUE |
| owner_actor_id | CHAR(36) ascii | 事件责任人 |
| minimal_excerpt | VARCHAR(280) | 必要摘录（≤280 字符） |
| classification_snapshot | JSON | 原始融合快照（`JSON_TYPE=OBJECT`） |
| detected_level | VARCHAR(2) ascii | 固定 `L2` / `L3` |
| detected_category | VARCHAR(32) ascii | |
| effective_level | VARCHAR(2) ascii | `L0` / `L1` / `L2` / `L3` |
| effective_category | VARCHAR(32) ascii | |
| status | VARCHAR(16) ascii | 固定 `open` |
| retention_until | DATETIME(6) | > created_at 且 ≤ created_at + 90 天 |
| created_at | DATETIME(6) | |
| updated_at | DATETIME(6) | |

索引：`idx_safety_event_owner_time`、`idx_safety_event_retention`。

**`safety_event_overrides`** — 人工覆盖（仅追加）

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| event_id | CHAR(36) ascii | FK → `safety_events(id)` ON DELETE CASCADE |
| request_id | CHAR(36) ascii | UNIQUE，幂等键 |
| request_hash | CHAR(64) ascii | |
| actor_id | CHAR(36) ascii | |
| actor_role | VARCHAR(32) ascii | `duty_safety_officer` / `event_owner` |
| prior_level | VARCHAR(2) ascii | `L0`—`L3` |
| prior_category | VARCHAR(32) ascii | |
| new_level | VARCHAR(2) ascii | `L0`—`L3` |
| new_category | VARCHAR(32) ascii | |
| reason_code | VARCHAR(32) ascii | `false_positive` / `context_clarified` / `immediacy_changed` / `category_corrected` / `human_review` |
| reason_note | VARCHAR(240) | |
| created_at | DATETIME(6) | |

约束：`chk_safety_override_changed` — 覆盖必须改变等级或类别。

#### 5.4.5 生成控制域（依据 `007_generation_control`）

**`generation_controls`** — 全局生成开关（单例）

| 字段 | 类型 | 约束 |
|---|---|---|
| scope | VARCHAR(16) ascii | PK，固定 `global` |
| state | VARCHAR(16) ascii | `running` / `stopped` |
| reason_code | VARCHAR(32) ascii | `initial_safety_default` / `manual_safety_stop` / `evaluation_failed` / `dependency_failure` / `manual_resume` |
| version | INT UNSIGNED | > 0 |
| updated_by | CHAR(36) ascii NULL | |
| updated_at | DATETIME(6) | |

初始值：`('global', 'stopped', 'initial_safety_default', 1, NULL, UTC_TIMESTAMP(6))`。

**`generation_control_changes`** — 变更历史（仅追加）

| 字段 | 类型 | 约束 |
|---|---|---|
| id | CHAR(36) ascii | PK |
| scope | VARCHAR(16) ascii | FK → `generation_controls(scope)` |
| request_id | CHAR(36) ascii | UNIQUE，幂等键 |
| request_hash | CHAR(64) ascii | |
| actor_id | CHAR(36) ascii | |
| prior_state | VARCHAR(16) ascii | `running` / `stopped` |
| new_state | VARCHAR(16) ascii | `running` / `stopped` |
| reason_code | VARCHAR(32) ascii | 不含 `initial_safety_default` |
| reason_note | VARCHAR(240) | |
| version | INT UNSIGNED | > 1 |
| created_at | DATETIME(6) | |

约束：`chk_generation_control_change_states` — 前后状态必须不同。

### 5.5 触发器

| 触发器 | 作用 |
|---|---|
| `trg_safety_override_no_update` / `no_delete` | 禁止直接修改或删除 `safety_event_overrides` 记录（追加式审计） |
| `trg_generation_control_change_no_update` / `no_delete` | 禁止直接修改或删除 `generation_control_changes` 记录 |

`007_generation_control` 的 `down()` 在存在变更历史时**故意抛错拒绝回滚**，避免静默丢失控制证据。

### 5.6 关键设计要点

- **秘密只存摘要**：邀请码、会话令牌、安全凭据均只存 SHA-256，不存明文；明文仅在事务内一次性返回。
- **幂等**：写接口以 `request_id` 唯一键实现幂等，同请求重放、异载荷冲突。
- **状态机下沉到数据库**：`CHECK` 约束保证枚举合法性与状态一致性（如 `content_items` 的 `active_version_id` 与 `lifecycle_status` 联动）。
- **双人审核下沉到数据库**：`chk_content_review_two_person` 在数据库层禁止作者自审。
- **追加式审计**：安全覆盖与生成控制变更用触发器强制只增不改不删。
- **风险数据隔离**：风险事件写入独立 `safety_events` 表，不进入普通会话表，不关联真实儿童身份。

---

## 6. API 接口

所有接口带版本前缀 `/api/v1`，响应带 `x-request-id`。公开错误结构固定为 `error.code`、`error.message`、`error.nextAction`、`error.requestId`。

基础错误码：`INVALID_REQUEST`、`ROUTE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`、`INTERNAL_ERROR`，以及业务错误码（`UNAUTHORIZED`、`FORBIDDEN`、`IDEMPOTENCY_CONFLICT`、`CONTENT_NOT_FOUND` 等）。

已实现接口分组：

- **健康/就绪**：`GET /api/v1/health`、`GET /api/v1/readiness`（readiness 校验 MySQL 8.4、InnoDB、utf8mb4、UTC 会话）。
- **身份与同意（阶段2）**：`POST /api/v1/enrollments/preview`、`guardian-confirmation`、`child-activation`；`GET /api/v1/guardian/enrollment`；`POST /api/v1/guardian/consent/withdrawal`；`GET /api/v1/child/mode`。
- **内容内部（阶段3B）**：`POST /api/v1/internal/content/items`、`.../items/:itemId/versions`、`.../versions/:versionId/submission`、`.../versions/:versionId/review`、`.../items/:itemId/publication|rollback|disable`、`GET .../items/:itemId`。
- **儿童只读内容（阶段3C）**：`GET /api/v1/child/content`、`GET /api/v1/child/content/:slug`。
- **儿童聊天（当前产品）**：`POST /api/v1/child/chat`。
- **本地测试账号（仅非生产回环）**：`POST /api/v1/dev/test-account/session`。

---

## 7. 配置与秘密

秘密只放部署环境秘密管理；`.env.example` 只列名称。数据库秘密只注入 API 与迁移进程，Web 进程不接收任何数据库/模型变量。

| 变量 | 默认 | 说明 |
|---|---|---|
| `NODE_ENV` | `development` | `development` / `test` / `production` |
| `XIAOBAN_API_HOST` / `PORT` | `127.0.0.1` / `3000` | API 监听 |
| `DATABASE_HOST` / `PORT` / `NAME` / `USER` | `127.0.0.1` / `3307` / `xiaoban_dev` / `xiaoban_app` | 数据库连接 |
| `DATABASE_PASSWORD` | 无 | 必填秘密，≥16 字符 |
| `DATABASE_CONNECTION_LIMIT` / `CONNECT_TIMEOUT_MS` | `5` / `3000` | 连接池 |
| `DEEPSEEK_API_KEY` | 无 | 后端秘密，缺失时固定降级 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 仅官方地址 |
| `DEEPSEEK_MODEL` | `deepseek-v4-pro` | 冻结 |
| `DEEPSEEK_TIMEOUT_MS` / `MAX_OUTPUT_TOKENS` | `12000` / `800` | 模型请求 |

配置在监听端口前校验，非法值非零退出且不回显字段值。

---

## 8. 安全与数据边界

- 身份、联系方式、普通会话、风险事件、同意、研究数据逻辑分区；
- 模型请求不包含真实姓名、手机号、住址、学校全称、联系人；留守状态不作模型画像字段；
- 普通聊天默认只保留短期恢复窗口；风险事件只保留最小必要摘录；
- 所有删除操作可追踪状态并支持失败重试；
- 当前边界：不采集身份证、人脸、语音、定位、相册、通讯录；不发送真实监护通知；
- 日志不默认记录完整儿童输入输出。

---

## 9. 测试与验证

- **契约测试**：`packages/contracts` 的 Zod 契约正常/非法/边界用例。
- **单元测试**：服务层正常/边界/依赖失败。
- **集成测试**：Fastify inject + 真实 `xiaoban_test` 库 + 合成数据；覆盖权限、幂等、状态机。
- **评测集**：60 条风险合成种子（`risk-seed-2026-08-v1`）；500 条发布阻断集（`release-safety-evaluation-2026-08-v4`，当前停在 357/500 处 1 项专业越界输出未被拒绝）。

完整检查命令：`pnpm check`（秘密扫描 + 类型检查 + 测试 + 生产构建）、`pnpm test:integration`。

---

## 10. 部署与运维

当前**无生产部署方案**。可执行 `pnpm build` 生成产物（`apps/api/dist`、`apps/web/dist`、`packages/contracts/dist`），但缺少 TLS/域名、秘密管理、监控告警、备份恢复、灰度回滚等生产能力。

已知缺口（P0/P1/P2，详见 `docs/16_AGENT_HANDOVER.md`）：

- **P0**：阶段 5F V4 专业越界输出未被拒绝（证据只读保留，未恢复儿童试点轨道）；无真实儿童准入、伦理审批、生产身份/MFA、生产保留删除策略、生产运维流水线。
- **P1**：内容审核仅有内部 API，无运营后台；去标识/检索/关键词审核仅适合小规模合成验证。
- **P2**：无负载测试、容量数据、SLO；工作区非 Git 仓库；平台脚本依赖 Windows PowerShell。

---

## 11. 参考文档

- `agent.md`（最高优先级工作规则）
- `docs/00_INDEX.md`（规范索引）
- `docs/02_TECHNICAL_ARCHITECTURE.md`（技术架构标准）
- `docs/08_LOCAL_MYSQL_DEVELOPMENT.md`（本地 MySQL 规范）
- `docs/decisions/ADR-001` / `ADR-002` / `ADR-003`（技术栈 / 数据库 / 模型网关决策）
- `docs/16_AGENT_HANDOVER.md`（交接快照）
- `apps/api/src/database/migrations/000—007`（本文数据库部分的直接依据）
- `packages/contracts/src/index.ts`（运行时契约与版本）
