# 技术架构标准

## 1. 架构目标

首版采用模块化单体，不采用微服务。优先保证权限、数据边界、可测试和可回滚。

技术设计必须支持：

- 替换模型服务商；
- 在不调用模型时运行完整静态安全流程；
- 普通会话与风险事件分区；
- 通知幂等、可重试和可审计；
- 按站点或全局停止生成服务；
- 测试、生产和研究数据隔离。

## 2. 已确认技术基线

2026-08-17 已通过 `docs/decisions/ADR-001-TECH-STACK.md` 确认：

| 层 | 决策 |
|---|---|
| 语言 | TypeScript |
| 前端 | React 19 + Vite 8，移动优先；原生Service Worker仅缓存版本化静态应用壳 |
| API | Node.js 22 LTS线 + Fastify 5 |
| 数据库 | MySQL 8.4 LTS Community + InnoDB；详见ADR-002 |
| 校验 | `packages/contracts` 共享Zod契约；Fastify路由同时声明完整JSON Schema |
| 测试 | Vitest、Fastify inject API集成测试；关键用户流程后续使用Playwright |
| 包管理 | pnpm workspace |
| 部署 | 单区域、最少服务数量、环境隔离 |

首版不引入Redis、消息中间件、Kubernetes和多数据库。通知任务优先使用MySQL InnoDB outbox表和独立worker进程，并以短事务和`FOR UPDATE SKIP LOCKED`领取任务。

## 3. 建议目录

产品代码启动后建议使用：

- apps/web：儿童端、成人端和受角色控制的运营页面；
- apps/api：API、业务模块和worker；
- packages/contracts：请求、响应、事件和数据契约；
- packages/ui：经过审核的共享组件；
- packages/config：非秘密配置定义；
- tests/evals：安全评测集和发布门槛；
- docs：项目标准；
- 开发日志：按日工作记录。

高保真prototype目录保留为设计参考，不直接作为生产应用继续堆叠后端逻辑。

## 4. 模块边界

| 模块 | 职责 |
|---|---|
| identity | 邀请、登录、站点、角色和会话 |
| consent | 监护同意、撤回、政策版本和权限变化 |
| child-profile | 化名、年龄段、兴趣和未成年人模式 |
| conversation | 会话状态、时长、退出和短期上下文 |
| content | 活动、知识、来源、年龄和审核版本 |
| ai-orchestrator | 意图、检索、模型网关和结构化输出 |
| safety | 输入检测、风险分级、输出审核和依赖检测 |
| safety-case | 风险工单、责任人、SLA和处置时间线 |
| notification | 发送、回执、重试、升级和幂等 |
| data-rights | 查阅、复制、更正、删除、撤回和注销 |
| audit | 高权限操作、版本和安全事件记录 |
| evaluation | 测试集、运行结果和发布门禁 |

模块之间通过明确接口调用，不允许从页面直接读写其他模块的数据表。

## 5. AI请求链路

顺序固定为：

1. 鉴权、未成年人模式、开放时段、频率和会话时长；
2. 输入长度、提示注入、个人信息和风险检测；
3. 根据意图选择静态流程、知识检索、活动或模型；
4. 仅组装去标识、最小化上下文；
5. 通过模型网关调用指定版本；
6. 解析结构化结果；
7. 输出安全、事实来源、年龄和依赖话术检查；
8. 通过后展示，否则进入静态降级或人工流程；
9. 记录请求、模型、提示词、知识和安全策略版本。

任何一步失败都不得绕过后续安全检查直接展示模型原文。

## 6. 数据边界

- 身份、联系方式、普通会话、风险事件、同意和研究数据逻辑分区；
- 模型请求不包含真实姓名、手机号、住址、学校全称和联系人；
- 留守状态不作为模型画像字段；
- 普通聊天默认只保留短期恢复窗口；
- 风险事件只保留最小必要摘录和处理记录；
- 研究数据必须单独授权、去标识并与生产身份表隔离；
- 所有删除操作可追踪状态并支持失败重试。

## 7. API标准

- 所有接口有版本前缀；
- 请求和响应使用共享契约校验；
- 写操作携带request_id并支持幂等；
- 错误返回稳定错误码、用户可理解消息和恢复建议；
- 客户端不根据自由文本错误判断业务状态；
- 列表接口使用明确分页；
- 时间统一存储UTC，界面按Asia/Shanghai显示；
- 高风险状态更新采用服务端权限校验和状态机；
- 不在URL、日志或分析事件中传递敏感正文。

当前工程约定：

- Fastify为每个请求生成内部`request_id`，并通过`x-request-id`响应头返回；
- 公开错误响应固定为`error.code`、`error.message`、`error.nextAction`和`error.requestId`；
- 基础稳定错误码为`INVALID_REQUEST`、`ROUTE_NOT_FOUND`、`DEPENDENCY_UNAVAILABLE`和`INTERNAL_ERROR`；业务错误码由对应共享契约追加；
- 校验错误返回400，未知路由返回404，未处理异常返回500；
- 内部异常的原始消息、堆栈和配置值不得返回客户端；
- Web和API通过`packages/contracts`中的`errorResponseSchema`共享运行时契约。

阶段2已实现的版本化接口：

- `POST /api/v1/enrollments/preview`：核对受控站点邀请；
- `POST /api/v1/enrollments/guardian-confirmation`：记录监护人主动同意并创建监护会话；
- `POST /api/v1/enrollments/child-activation`：在监护会话下创建化名儿童和儿童会话；
- `GET /api/v1/guardian/enrollment`：仅监护角色读取同意与儿童状态；
- `GET /api/v1/guardian/dashboard`：仅活跃监护角色与已验证绑定读取本周只读成长聚合、确定性周报、隐私/设置状态和受控提醒；
- `POST /api/v1/guardian/consent/withdrawal`：仅监护角色撤回并立即停用儿童账号和会话；
- `GET /api/v1/child/mode`：仅活跃儿童角色读取未成年人模式边界。

阶段2本地人工验收补充：

- `POST /api/v1/dev/test-account/session`复用非生产回环运行边界，只随本地服务装配；生产、非回环监听和未显式注入服务的`buildApp()`均不注册；
- `POST /api/v1/dev/test-account/guardian-session`在相同开发边界内单独签发监护令牌，撤销该合成监护人既有活跃监护会话；不复用儿童令牌，不在生产注册；
- `seed-dev.ts`幂等建立固定虚构的“小树”身份关系；若固定标识或关系发生碰撞则失败，不覆盖现有数据；
- 会话接口不接收密码、邀请码、身份字段或请求令牌。服务端生成新的随机令牌，在事务内撤销该账号既有活跃儿童会话，并仅向本次响应返回明文；数据库继续只存SHA-256摘要；
- Web仅在`import.meta.env.DEV`下动态导入测试账号客户端，临时令牌仍使用`sessionStorage`。生产构建必须排除端点、契约版本、账号文案和按钮；正式一次性邀请流程不改为持久会话。

阶段3B已实现的内部内容接口：

- `POST /api/v1/internal/content/items`和`POST /api/v1/internal/content/items/:itemId/versions`：内容作者创建条目或不可变新版本；
- `POST /api/v1/internal/content/items/:itemId/versions/:versionId/submission`：版本作者提交审核；
- `POST /api/v1/internal/content/items/:itemId/versions/:versionId/review`：不同的内容审核员批准或驳回；
- `POST /api/v1/internal/content/items/:itemId/publication`、`rollback`和`disable`：内容审核员发布、历史回滚或停用；
- `GET /api/v1/internal/content/items/:itemId`：内容作者和审核员读取内部版本详情。

阶段3C已实现的儿童只读内容接口：

- `GET /api/v1/child/content`：仅活跃儿童角色分页读取已发布、审核通过、处于有效期且年龄匹配的当前版本；
- `GET /api/v1/child/content/:slug`：在相同筛选边界下读取活动步骤，或知识正文与可选情景练习；隐藏内容统一按不存在处理。

儿童内容响应不包含作者、真实审核人身份、审核理由、内部版本标识、风险标签或来源URL。详情仅提供固定公开标识“小伴内容审核组”与审核时间，用于儿童识别内容状态，不映射内部人员。监护角色和内容运营角色不能调用儿童接口。阶段3D为每条公开响应增加由内部版本ID单向摘要得到的16位`revision`，列表增加由当前可见内容集合计算的`catalogRevision`；二者只用于客户端缓存失效，不暴露内部版本ID。

产品原型对齐知识中心与情景小练习：

- 不新增接口或数据表，复用 `GET /api/v1/child/content?type=knowledge` 与详情接口、审核发布状态机、年龄过滤、版本和会话缓存；
- 知识正文主题扩展为 `general_growth`、`emotional_social`、`digital_safety`、`body_boundaries`，可选 `quiz` 随同不可变内容版本创建、审核和发布；
- `quiz` 严格包含场景ID/标签、题干、恰好三项唯一选择、存在于选项中的正确项、正确/错误标题、原因解释和1—4条行动步骤；列表仅公开 `hasQuiz`，详情公开完整题目；
- 首页和“我的”都进入同一独立知识中心；从哪个入口进入就返回到哪个页面；答题结果只使用 React 当前页面状态，不新增写接口、分数、历史、画像或统计。

阶段3D离线边界：

- Service Worker使用版本化缓存名，仅缓存同源静态应用壳，所有`/api/`请求和Authorization均绕过Cache Storage；
- 儿童内容缓存只写当前标签页`sessionStorage`，仅保存共享契约允许的公开列表和详情字段，按儿童年龄段隔离；
- 内容缓存最长24小时，同时以每条`expiresAt`为硬上限；在线目录刷新后按slug和`revision`清理删除或换版详情；
- 弱网或服务不可用时允许只读回退；鉴权失败、角色错误或账号停用时禁止回退并清理儿童内容缓存；
- 当前会话另存经`childModeResponseSchema`验证的最小儿童模式快照，以支持静态应用壳断网重载；退出儿童内容或监护撤回时同步清理会话快照和内容缓存。

产品原型对齐风险回应接口：

- `POST /api/v1/child/chat` 在内部生成编排前，以当前请求和最多两条儿童历史消息调用既有确定性规则；当前仍只运行于本地合成账号边界；
- L0/L1 继续既有聊天路径；L2/L3 不调用模型，返回 `child-chat-2026-09-v2` 的 `fixed_safety` 分支，只包含等级、儿童可见标题、2—4条固定步骤和 `notificationStatus=not_sent`；
- 外部响应不包含规则ID、风险类别、事件要求、模型追踪、输入正文或内部错误；Web 收到 `fixed_safety` 后卸载普通聊天和四导航，显示独立风险回应页；
- 三个前端动作仅支持退出当前聊天、查看保存必要证据的方法和查看告诉可信任成年人的开口提示；不读取截图、不查联系人、不创建工单、不发送通知，也不显示送达或处置状态。

产品原型对齐成人端接口：

- `GET /api/v1/guardian/dashboard`先识别会话角色，再校验活跃监护账号、活跃 enrollment/consent/child 和未停用的 verified link；儿童令牌返回角色错误，撤回或停用关系禁止读取；
- 服务只查询当前 Asia/Shanghai 自然周的 `growth_attempts`，返回现实活动数、目标尝试数、行动天数和七日分布；不查询聊天正文、心情历史或联系人，不虚构使用时长；
- 周报 `source=deterministic_summary`，只把相同统计组织成非诊断文字；设置为只读状态，不提供权限写接口；
- 生产聚合默认提醒数组为空。本地合成监护账号可收到固定 `synthetic_preview` 演练，其 `occurredAt=null`、`notificationStatus=not_sent`、`acknowledgementStatus=unavailable`；风险详情确认按钮保持禁用，不创建回执或工单。

产品原型对齐首批成长计划接口：

- `GET /api/v1/child/growth-plan`：仅活跃儿童读取当前 Asia/Shanghai 自然周的固定目标、七日尝试状态、真实统计和可解释回顾；不返回虚构进度；
- `POST /api/v1/child/growth-attempts`：使用UUID `requestId`幂等记录儿童当日自报或已审核活动完成；手动记录同日只计一次，同一活动同日只计一次；
- 活动完成请求额外包含 `targetMinutes`（1—120）和可选 `feeling`（`lighter`/`same`/`rest`）；011迁移在 `growth_attempts` 增加对应可空字段，012迁移以活动当前建议时长（无法读取时为5分钟）补齐本地旧合成记录后，显式要求活动记录必须有目标分钟；手动自报不得写入这两个字段；
- 008迁移新增`growth_attempts`，011迁移补充活动目标分钟和可选感觉；行为区不保存计时过程、暂停次数、退出失败、聊天正文、情绪正文、联系人或长期画像；
- 活动来源写入前复用阶段3可见内容条件，未知、未审核、过期、停用或年龄不匹配活动统一拒绝；监护角色不能读取或写入儿童成长计划；
- Web 计时状态仅存在当前 React 页面：提供 5/10/15 分钟和 1—120 分钟自定义目标，倒计时支持暂停/继续/提前完成；进入本次计时时从本地固定集合选一条激励语，暂停和继续不重新随机，退出不调用写接口；
- 当前周目标固定为 prototype 已确认的“睡前30分钟不刷短视频”，本批次不实现目标编辑、多目标或跨周长期画像。

产品原型对齐进入引导接口：

- `GET /api/v1/child/onboarding`：仅活跃儿童会话读取引导是否完成；未完成不返回草稿，完成后返回化名、年龄段、年级、受控兴趣、伙伴和完成时间；
- `POST /api/v1/child/onboarding/completion`：使用 UUID `requestId` 幂等完成引导；年级必须与儿童账号年龄段一致，儿童主动重新走完三步引导时更新一对一资料，同一 `requestId` 的不同载荷仍返回冲突；
- 009迁移新增一对一 `child_profiles`，只保存儿童ID、年级、1—4项受控兴趣、伙伴类型、完成请求摘要和UTC完成时间；化名、年龄段继续使用 `child_accounts`，不保存欢迎页浏览、边界页浏览或表单草稿；
- 监护角色不能读取或完成儿童引导；账号删除时资料随儿童账号级联删除；客户端只在当前标签页 `sessionStorage` 暂存尚未提交的年级和兴趣；
- `POST /api/v1/dev/test-account/session/resume` 仅在非生产回环开发环境注册，只供“直接进入”重新签发合成儿童会话且不覆盖既有资料；“开始认识小伴”不调用恢复入口，固定从边界说明开始。
- 儿童端“我的”基础资料页不新增接口或客户端副本：App 仅在 `GET /api/v1/child/onboarding` 返回 `completed` 后进入四导航，并把同一份已校验 profile 直接传给只读页面；页面不查询联系人、成人端或其他数据区。

产品原型对齐首页情绪签到接口：

- `GET /api/v1/child/mood-check-in`：仅活跃儿童读取 Asia/Shanghai 当日的一项结构化心情；没有签到或跨日时返回 `mood=null`；
- `PUT /api/v1/child/mood-check-in`：使用 UUID `requestId` 保存六种受控心情之一或 `null` 清除；同一请求同载荷可重复，异载荷返回幂等冲突；
- 010迁移新增一对一 `child_mood_checkins`，只保存儿童ID、结构化心情、本地日期、请求摘要和UTC更新时间；每名儿童最多一行，跨日读取删除旧行，不形成心情历史；
- 首页今日小计划不新增副本或统计口径，直接读取 `GET /api/v1/child/growth-plan`；四个快捷入口只编排现有聊天、活动筛选、独立知识中心和可信任大人页，不创建工单、不发送通知。

产品原型对齐可信任大人接口：

- `apps/api/src/trusted`提供只读服务与路由：`GET /api/v1/child/trusted-adults` 仅允许活跃儿童会话读取；
- 返回结果只包含监护流程已验证（`guardian_enrollment` 或 `pilot_site`）且状态为 `active` 的大人，按验证时间排序，最多 6 条；
- 每条只暴露 UUID、称呼、关系类别、联系方式类别和明确的「是否可联系」状态及儿童可读中文标签，不包含电话号码、真实姓名、地址或通讯录字段；
- 响应固定 `notificationStatus=not_sent`；13迁移新增 `child_trusted_adults`（儿童ID、可选监护账号、称呼、关系/联系方式/可联系类别、验证来源、验证时间、状态），称呼按儿童+称呼唯一，儿童账号级联删除，监护账号删除置空；
- `db:seed:dev` 幂等为本地合成账号「小树」补两名已验证大人（家人·可当面说·现在就可以找；老师·需约定时间·需要先约时间），不含任何真实联系方式；
- 儿童端 `ChildTrustedAdults` 为独立二级页面，可从首页「我需要帮助」和「我的」进入，返回路径与来源一致；联系按钮为禁用态，页面固定说明不会真实拨号、发短信或发消息。

阶段4A.1模型网关边界：

- `apps/api/src/ai`提供独立后端适配器，不在Fastify注册儿童或公开模型路由；
- 使用Node.js原生`fetch`调用官方`https://api.deepseek.com/chat/completions`，模型固定为`deepseek-v4-pro`；
- 请求关闭思考模式、关闭流式传输、要求JSON对象，最长12秒且不自动重试；
- 供应商响应先解析为JSON，再由`internalAiCandidateSchema`严格校验；失败只产生稳定内部错误，不返回供应商原文；
- 成功结果固定标记`unreviewed`，只包含候选、模型/提示词/结构版本、耗时和Token用量，不包含`reasoning_content`；
- 当前仅提供合成CLI冒烟入口，不落库、不检索、不执行工具、不向页面展示。

阶段4A.2.1输入去标识边界：

- `apps/api/src/safety/input-deidentifier.ts`在模型网关之前提供独立、无外部依赖的本地处理器，当前尚未接入模型调用链；
- 输入请求只包含UUID请求标识和最多2000字符的合成文本；结果严格区分`allow`与`block`；
- 确定格式的手机号、邮箱和中国居民身份证号替换为`[PHONE]`、`[EMAIL]`和`[ID_NUMBER]`，结果只记录去标识文本、替换类别和策略版本；
- 明确姓名、学校全称、详细地址、联系人、秘密或提示注入线索采用失败关闭，只返回稳定原因码，不返回或记录原文；
- 当前规则是内部合成验证用的确定性最小集合，不等同于完整个人信息识别器，不能据此接入真实儿童文本；
- 4A.2.1不新增API、数据库、日志正文、模型调用、知识检索、输出审核或页面。

阶段4A.2.2审核内容检索边界：

- `apps/api/src/content/visible-content.ts`集中阶段3儿童读取和AI检索共用的可见内容条件及公开详情映射，避免两套审核边界漂移；
- `apps/api/src/ai/reviewed-content-retrieval.ts`只接收4A.2.1的`allow`结果、年龄段、明确内容类型和1—3条限制；`block`结果在访问数据库前按非法请求拒绝；
- MySQL查询只读取当前活动版本，并同时限制`published`、`approved`、已生效、未过期和年龄匹配；活动与知识类型由调用方明确指定；
- 检索去除占位符后提取中文双字片段和至少2字符的英文/数字词；标题命中计3分、摘要命中计1分，0分不返回，同分按ASCII slug稳定排序；
- 结果最多3项，只包含匹配分数、阶段3儿童安全公开详情、`revision`、输入策略版本和`reviewed-content-retrieval-v1`；
- 结果不包含检索原文、内部内容/版本ID、作者、审核人、审核理由、来源URL或风险标签；数据库或内容解析失败统一为`RETRIEVAL_UNAVAILABLE`；
- 4A.2.2不新增API、迁移、向量数据库、Embedding、模型调用、输出审核、持久化模型记录或页面。

阶段4A.2.3输出审核边界：

- `apps/api/src/safety/output-auditor.ts`只接收严格校验的结构化未审核候选和本次审核内容检索结果，不读取供应商原始响应；
- 候选的所有`contentSlugs`必须属于本次检索结果；`activity_suggestion`和`knowledge_answer`还必须至少引用一项对应类型的审核内容；
- 确定性规则阻断外部联系方式或链接、危险指令、医疗/心理/法律专业越界、依赖排他话术和系统提示词泄露；
- 审核失败固定返回静态文案、最多3项本次检索slug、稳定原因码和`output-safety-2026-08-v1`，不返回被拒候选；
- 当前规则是阶段4内部验证的最小失败关闭层，不等同于完整风险分级或真实儿童输出安全评测；不新增API、数据库、日志正文或页面。

阶段4A.2.4内部编排边界：

- `apps/api/src/ai/internal-orchestrator.ts`依次执行请求校验、输入去标识、审核内容检索、固定提示词模型调用和输出审核，不注册Fastify路由或页面；
- 调用方只提供UUID、最多700字符合成文本、年龄段和内容类型，不能提供系统提示词；模型上下文只含去标识文本及最多3项审核内容的slug、类型、标题和截断摘要；
- 输入阻断、检索故障、无审核命中、模型不可用/结构无效和输出拒绝均返回严格静态结果；输入阻断和无审核命中不会调用模型；
- 结果只含审核通过回复或固定静态文案、审核slug、稳定阶段原因和输入/检索/提示词/输出/流水线版本；不含原始输入、被拒候选、供应商原文、系统提示或密钥；
- `ai:smoke:orchestrator`仅连接`xiaoban_test`，合成审核内容在MySQL事务中创建并强制回滚，终端只输出非敏感追踪元数据；
- 该内部闭环不是儿童接口、风险引擎或发布能力。阶段5完成前不得将其注册到面向儿童或公开路由。

阶段5A风险策略基础：

- `packages/contracts`固定`risk-policy-2026-08-v1`、L0—L3、九类风险类别、等级/类别合法组合、处置结果和合成评测样本结构；
- `apps/api/src/safety/risk-policy.ts`不识别文本，只把已确定等级/类别映射为处置；L0继续审核AI、L1进入有边界支持、L2/L3停止生成并返回固定步骤；
- 所有L2/L3处置固定`requiresHuman=true`、`eventRequired=true`和`notificationStatus=not_sent`，不能表达通知已发送、送达、查看或处理；
- 固定动作不包含未经站点核验的电话号码，不要求重复描述创伤细节，也不提供诊断、治疗或救援承诺；
- `risk-evaluation-seed.ts`提供60条显式合成种子，仅用于后续规则/模型评测基础，不接入数据库、模型、API或页面。

阶段5B确定性规则和评测：

- `apps/api/src/safety/risk-rule-engine.ts`只接受显式合成的1—3轮文本，在内存中规范化后按高风险优先级返回等级、类别、一个稳定规则ID和策略/规则版本；结果不回显文本；
- 规则顺序为当前人身危险、自伤/伤人即时性、诈骗隐私、侵害诱骗、霸凌、危险模仿、持续困扰和默认L0，较高风险先返回；
- 第三人称、引用和假设仍可能代表需要帮助的人，不作为降级条件；仅与即时词相邻的“没有/并没有/没说”等明确否定抑制L3即时性，相关自伤/伤人表达仍保持L2；
- `risk-evaluator.ts`计算等级召回、高风险路由和精确标签，报告只含版本、计数、百分比、失败ID和期望/实际标签，不含样本文本；
- `risk:evaluate:seed`为本地离线命令，不读取密钥、不连接模型或数据库；存在失败时非零退出。

阶段5C独立模型分类与融合：

- `apps/api/src/safety/deepseek-risk-classifier.ts`使用固定系统提示和官方DeepSeek适配器，只接受`synthetic: true`的1—3轮输入；调用方不能注入系统提示、模型或输出结构；
- 分类器关闭思考输出并严格解析`level`、`primaryCategory`和1—4个原因码；公开结果只含标签、分类器版本、耗时和Token用量，不含请求正文、供应商原文或推理；
- `apps/api/src/safety/risk-fusion.ts`按L0<L1<L2<L3选择规则与模型的更高等级；同级同类别标记`both`，同级类别冲突保留确定性规则并记录分歧；
- 分类器不可用或结构无效时，规则L2/L3继续固定安全流程；规则L0/L1不得继续自由生成，只返回`unknown`、`static_only`和空最终标签；
- 当前只提供独立合成CLI冒烟，不注册Fastify路由、不接入阶段4编排器、不落库、不创建事件、不通知、不向页面或儿童开放。

阶段5D独立风险事件数据区：

- 004—006迁移新增`safety_access_grants`、`safety_events`和`safety_event_overrides`，并扩展`safety_operator`审计主体；风险数据不写入普通会话表，也不关联真实儿童身份；
- `safety_events`只接受`synthetic=true`且融合结果为L2/L3的事件，保存合成用例引用、280字符以内必要摘录、原始融合快照、当前有效标签、事件责任人、显式到期时间和版本；
- 开发态到期时间必须晚于创建时间且不超过90天；该上限仅用于本地合成数据，不代表真实试点保留政策；
- `duty_safety_officer`可创建和读取事件，`event_owner`只能读取及覆盖`owner_actor_id`等于自己的事件；访问凭据位于独立`safety_access_grants`，当前无账号签发或公开API；
- 人工覆盖只能追加，记录原标签、新标签、理由码、合成复核说明、操作者及时间；原始融合快照保留，事件当前有效标签单独更新；数据库触发器拒绝直接修改或删除覆盖记录；
- 创建、读取、覆盖、幂等重放和到期清理写入通用审计区，审计元数据不含必要摘录或复核正文；
- 内部到期清理只选择已到期的合成事件，级联删除事件覆盖记录并保留`safety.event.retention_purged`审计；没有计划任务、生产身份映射、真实数据、通知、页面或儿童入口。

阶段5E全局生成控制与内部固定风险预览：

- 007迁移新增单例`generation_controls`和追加式`generation_control_changes`；全局初始状态固定为`stopped`，变更记录由数据库触发器禁止更新和删除；已有变更历史时007拒绝向下回滚，避免静默丢失控制证据；
- 只有未撤销的`duty_safety_officer`测试凭据可切换状态；`event_owner`无权切换。每次变更必须使用UUID请求、受控理由码和以“虚构演练：”开头的短说明；相同请求幂等重放，异载荷冲突；
- `GenerationControlStore.evaluateGate()`把记录缺失、数据库异常或契约异常统一映射为`unknown + fail_closed + stop`，不泄露底层错误；控制回复和审计不包含理由正文；
- `InternalAiOrchestrator`在去标识、审核内容检索和模型调用前先验证门禁；停止或门禁异常时三类下游均不执行，返回固定静态文案并记录控制来源、状态、版本和架构版本；
- `InternalSafetyPreview`仅在Vite开发模式且显式使用`?internalSafetyPreview=1`时动态加载；生产构建排除入口与界面文案，不注册公开导航、API或真实切换按钮。界面只展示合成L3固定步骤、`not_sent`通知状态、故障关闭规则和退出入口。

写接口使用`requestId`实现幂等；同一请求ID载荷不一致返回`IDEMPOTENCY_CONFLICT`。浏览器会话秘密只保存于客户端会话存储，服务端仅保存SHA-256摘要，不保存明文令牌。

## 8. 配置与秘密

- 秘密只存放在部署环境的秘密管理中；
- .env.example只列名称和说明，不放真实值；
- 前端构建变量不得包含模型、短信或数据库密钥；
- 测试、预发布和生产使用不同密钥与数据库；
- 密钥轮换后要验证旧密钥失效；
- 日志、截图、报错和开发日志不得出现秘密。

API当前使用以下非秘密启动配置：

- `NODE_ENV`；
- `XIAOBAN_API_HOST`；
- `XIAOBAN_API_PORT`。

数据库配置只注入API和迁移进程：

- `DATABASE_HOST`、`DATABASE_PORT`、`DATABASE_NAME`、`DATABASE_USER`；
- `DATABASE_PASSWORD`；
- `DATABASE_CONNECTION_LIMIT`、`DATABASE_CONNECT_TIMEOUT_MS`；
- 迁移和测试使用单独的用户、密码与数据库变量。

配置必须在监听端口和建立外部连接前校验。非法值导致进程非零退出，错误只列无效字段名，不回显字段值。数据库秘密只注入API。阶段4A.1新增`DEEPSEEK_API_KEY`、`DEEPSEEK_BASE_URL`、`DEEPSEEK_MODEL`、`DEEPSEEK_TIMEOUT_MS`和`DEEPSEEK_MAX_OUTPUT_TOKENS`；模型密钥只注入独立后端冒烟进程，任何模型或通知秘密都不得进入前端变量。

数据库接入后必须遵守ADR-002：服务器为MySQL 8.4.x LTS、表使用InnoDB、字符集使用utf8mb4、连接会话固定UTC，数据库密码只从后端秘密环境注入。项目专用本地基线为`127.0.0.1:3307`上的MySQL 8.4.11；现有MySQL 8.0.40不得作为项目运行基线。

阶段2业务表为`policy_versions`、`sites`、`pilot_invitations`、`guardian_accounts`、`enrollments`、`child_accounts`、`guardian_consents`、`guardian_child_links`、`access_sessions`和`audit_entries`。所有表来自Kysely评审迁移；儿童表强制`minor_mode=true`，邀请和会话秘密只存摘要。

阶段3A新增`content_items`、`content_versions`和`content_reviews`。内容身份和不可变版本分离；当前发布版本使用同内容复合外键，不能引用其他内容的版本；审核记录使用版本与作者复合外键，并在数据库层禁止作者自审。正文和风险标签使用JSON承载经共享Zod契约验证的活动或知识结构，状态、年龄、来源、有效期和审核关系仍由结构化列约束。

阶段3B新增`content_commands`保存内容写命令的请求摘要和已验证响应，实现精确幂等重放；`access_sessions`增加与儿童/监护登记隔离的合成`content_author`和`content_reviewer`角色。内部内容API落实草稿、提交、不同身份审核、发布、停用和历史回滚状态机，高权限变化写入`content_operator`审计。当前没有真实运营账号、MFA、固定开发令牌或运营页面。

## 9. 可观测与故障

必须记录：

- request_id和去标识session_id；
- 接口、模型和通知延迟；
- 模型、提示词、知识和安全策略版本；
- 审核结果和原因码；
- 风险工单与通知状态；
- 降级、错误、重试和回滚。

不得默认记录完整儿童输入输出。

关键健康检查：

- `/api/v1/health`只表示API进程存活；
- `/api/v1/readiness`验证MySQL 8.4、InnoDB、utf8mb4和UTC会话，失败返回不泄露连接详情的503；
- 模型网关；
- 安全分类器；
- 通知渠道；
- worker积压；
- 值守状态；
- 试点总开关。

## 10. 技术决策规则

以下变化需先写技术决策记录，再实现：

- 新增第三方服务；
- 更换数据库、模型或通知渠道；
- 引入长期记忆；
- 新增敏感数据字段；
- 拆分微服务；
- 新增语音、定位、摄像头或设备数据；
- 改变会话和风险数据保留策略。
