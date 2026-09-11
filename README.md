# 小伴

「小伴」是一个面向 9—14 岁农村留守儿童的 AI 情感陪伴产品，角色名「小禾」（温柔姐姐型，面向 6—14 岁）。产品通过短时情绪承接、安全知识和现实行动建议，帮助儿童减少无目的短视频使用，并在问题超过 AI 能力时连接真实成年人。

当前仓库处于把高保真原型做成真实可运行产品的阶段：已完成欢迎页与三步引导 → 儿童四导航与风险回应 → 成人四导航（概览/周报/提醒/设置）及风险详情。成人端使用独立监护令牌和已验证绑定，只读聚合本周现实活动、目标尝试和行动天数；不读取完整普通聊天、不伪造使用时长，周报为确定性自动整理而非心理诊断。本地合成账号额外提供明确标注"未发送、不可确认"的风险演练，真实通知、回执和工单仍未接入。邀请/同意/鉴权后端基线、AI 管线和基础安全护栏继续保留。**当前未向真实儿童开放**，不接入真实个人信息、真实通知或长期记忆。

2026-09-10 批次：完成活动细分筛选（都看看 / 想动一动 / 安静做点事 子筛选 + 卡片 movement 标签，5 条合成活动：2 move + 3 quiet）、风险回应页「告诉可信任的大人」链接到可信任大人只读闭环、bored 故事线（无聊关键词触发回复+建议快捷回复；movement 关键词返回 ≤3 活动推荐并跳转活动页带子筛选）、risk 故事线（风险关键词触发 L2/L3 固定响应 → 告诉可信任的大人 → 已验证名单 → 我已告诉他/她 → 收尾页含演示通知预览与未真实发送边界，回首页闭环）、lonely 故事线（服务端正则识别想念 → 情绪分流「很想念/有点难过/有点委屈」→ 动作分流「请外婆帮我联系 / 我想先自己写下来 / 先做一分钟呼吸」→ 「请外婆帮我联系」命中 `lonely_connection` 路由 → 跳转到可信任大人页，lonely 来源 backLabel=「返回陪我聊」、联系按钮禁用、不真实发送）、资料编辑（迁移 014 给 `child_profiles` 加 `updated_at` 字段；新增 `PATCH /api/v1/child/profile` + `ChildOnboardingService.update()` 鉴权 + 校验 grade 属 ageBand + 事务更新 child_profiles + alias 变化时更新 child_accounts；「我的」半屏弹层 `ChildProfileEdit` 改昵称/年级/兴趣/伙伴，不重新看边界说明、不创建新账户、不扩张成人端；alias 拒绝纯数字避免误填电话）、成长目标编辑（迁移 015 给 `child_profiles` 加 `current_goal_id` 字段；新增 `GET /api/v1/child/growth-goals` 列表（5 个候选目标池：screen-free-bedtime-30m / daily-move-20m / daily-read-10-pages / tidy-my-space / three-good-things）+ `PATCH /api/v1/child/growth-goal` 切换；成长计划页右上角「换一个目标」按钮 + 半屏选择器）、语音按钮（聊天页底部 disabled 麦克风按钮 + 点击提示「语音暂未开放，试着打字告诉我吧」3 秒气泡，不录音不上传不读麦克风权限）、前端视觉全面对齐（CSS design token 统一到 `:root`：--design-teal #0F766E、--design-teal-deep #0A5C56、--design-warm #D6A447、--design-paper #F5F0E4、--design-surface #FFFDF7、--design-ink #183B3A、--design-radius-card 20px、--design-radius-pill 999px、--design-tap 44px；375/768 双视口各页面 teal + 暖米纸 + 楷体标题 + 手账圆角视觉一致）。三条核心故事线 + 资料编辑 + 成长目标编辑均已迁移真实服务端到端无断点；剩余待办仅离线无网络完整降级（已确认暂缓）、check-secrets.ps1 兼容性、真实通知/回执/成人承接/可信任大人管理界面等 P1。

## 本地要求

- Node.js 22.12 以上；推荐按 `.node-version` 使用已验证的 22.18.0；
- pnpm 11；
- 数据库基线为项目专用 MySQL 8.4.11 LTS + InnoDB，地址 `127.0.0.1:3307`。本机已有的 MySQL 8.0.40 不作为项目运行基线。

## 本地开发最少步骤

```powershell
pnpm install --frozen-lockfile

# 仅在项目 MySQL 尚未安装，并已确认后执行一次
pnpm db:install

pnpm db:start
pnpm db:migrate
pnpm db:migrate:test
pnpm db:seed:dev

pnpm dev
```

- Web：http://127.0.0.1:5173
- API 健康检查：http://127.0.0.1:3000/api/v1/health
- API 就绪检查：http://127.0.0.1:3000/api/v1/readiness

Web 开发服务器会把 `/api` 请求代理到本地 API。首次进入按 welcome → 边界说明 → 昵称/年级/兴趣 → 伙伴选择完成三步引导，完成后默认落「陪我聊」首页，刷新会直接恢复；情绪签到支持跳过、清除和当日回显，选择"无聊"会进入真实聊天并自动发送 bored 提示，对话可继续走「想动一动/安静做点事」获得活动推荐；四个快捷入口进入聊天、活动、独立知识中心和可信任大人页，今日小计划读取真实成长计划进度；「我的」直接读取同一份已校验引导资料，并提供知识中心与可信任大人入口。知识中心的三类情景题均来自现有儿童只读内容接口，答题不新增写接口或历史记录。使用本地合成账号在聊天中输入"虚构测试：陌生人要我发家庭住址和验证码。"，可验证服务端 L2 规则真实触发独立风险回应页；首页求助入口和风险页都不会发送通知。

活动详情可进入真实计时闭环：选择 5/10/15 分钟或输入 1—120 分钟自定义目标，开始后可暂停、继续、提前完成或无惩罚退出；每次计时随机选定一条本地固定激励语。明确完成后可选择“轻松一点/差不多/还想休息”或跳过感觉，目标分钟与可选感觉写入行为区并计入成长计划；退出计时不会写入失败记录。

`db:seed:dev` 幂等创建虚构站点邀请 `XIAOBAN-DEMO-2026-02`、五条稳定合成内容（两条既有活动/知识、三类情景练习）和两名监护流程已验证的合成大人（外婆·可当面说·现在就可以找；林老师·需约定时间·需要先约时间）；重复执行不新增、不覆盖同名或固定 ID 冲突。开发模式下可从“我的 → 预览监护端”签发独立合成监护会话，验收成人四导航和风险详情；该入口不进入生产构建。旧开发库的“竞赛合成内容”公开来源标签与审核说明仅作为兼容值接受，不会被重写。

本地人工验收可在欢迎页点击「开始认识小伴」完成首次引导；已有合成资料时点击「直接进入」会重新签发临时儿童会话且不覆盖资料。`POST /api/v1/dev/test-account/session` 与 `/resume` 只在非生产回环 API 环境注册；它们不提供密码或公众注册能力。

### 真实对话

「陪我聊」默认返回固定降级文案。要真实调用 DeepSeek，先打开生成开关：

```powershell
pnpm generation:on    # 打开生成（running）
pnpm generation:off   # 关闭生成（stopped，默认安全基线）
```

打开后「陪我聊」每次聊天会真实调用 DeepSeek 并产生费用；使用结束务必 `pnpm generation:off` 恢复默认关闭。

## 完整检查

```powershell
pnpm db:start
pnpm db:migrate
pnpm db:migrate:test
pnpm check            # 秘密扫描 + 类型检查 + 测试 + 生产构建
pnpm test:integration
```

## 非秘密配置

API 读取下列启动配置。本地 `pnpm dev` 把 `.local/mysql-secrets/database.env` 和可选的 `.local/model-secrets/deepseek.env` 只注入 API 进程，不注入 Web 进程；生产环境必须由秘密管理系统注入：

| 变量 | 缺省值 | 允许值或范围 |
|---|---|---|
| `NODE_ENV` | `development` | `development`、`test`、`production` |
| `XIAOBAN_API_HOST` | `127.0.0.1` | 非空主机名或监听地址 |
| `XIAOBAN_API_PORT` | `3000` | 1—65535 的整数 |
| `DATABASE_HOST` | `127.0.0.1` | 数据库主机 |
| `DATABASE_PORT` | `3307` | 1—65535 的整数 |
| `DATABASE_NAME` | `xiaoban_dev` | 应用数据库 |
| `DATABASE_USER` | `xiaoban_app` | 仅 DML 应用账号 |
| `DATABASE_PASSWORD` | 无 | 必填秘密，不少于 16 字符 |
| `DATABASE_CONNECTION_LIMIT` | `5` | 1—20 |
| `DATABASE_CONNECT_TIMEOUT_MS` | `3000` | 250—30000 毫秒 |
| `DEEPSEEK_API_KEY` | 无 | 后端秘密；缺少或非法时固定降级 |
| `DEEPSEEK_BASE_URL` | `https://api.deepseek.com` | 只允许官方地址 |
| `DEEPSEEK_MODEL` | `deepseek-v4-pro` | 只允许该模型 |
| `DEEPSEEK_TIMEOUT_MS` | `12000` | 1000—12000 毫秒 |
| `DEEPSEEK_MAX_OUTPUT_TOKENS` | `800` | 64—2000 |

配置和数据库基线在 API 监听端口前校验。非法配置或数据库不可用会以非零状态退出，错误信息不回显秘密。变量名称见 `.env.example`，真实值不得写入仓库。

所有 API 响应都带 `x-request-id`。公开错误使用统一结构，客户端依据稳定的 `code` 判断状态，不解析自由文本。内部异常原文不会返回客户端。

## 工程边界

- `apps/web`：React/Vite 移动优先 Web 应用；
- `apps/api`：Fastify API；
- `packages/contracts`：Web 与 API 共用的运行时契约和 TypeScript 类型；
- `prototype`：高保真设计参考，不承载正式后端逻辑；
- `docs`：开发、安全、设计、测试和执行标准；
- `开发日志`：按日记录可验证的开发事实。

开始开发前请先阅读 `agent.md` 与 `docs/00_INDEX.md`。
