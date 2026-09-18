# 项目开发标准索引

## 1. 作用

本目录保存「小伴」儿童情感陪伴产品（受控试点方向）从高保真原型过渡到可运行产品、并为未来受控儿童试点保留升级路径时必须遵循的开发标准。

任何Agent或团队成员在修改产品代码前，应先阅读本索引，再根据任务类型阅读对应文件。

## 2. 文档读取顺序

1. 项目根目录：agent.md
2. 当前产品基线：AI陪伴智能体_PRD_V0.4_产品版.md
3. 开发需求：docs/01_DEVELOPMENT_REQUIREMENTS.md
4. 技术架构：docs/02_TECHNICAL_ARCHITECTURE.md
5. 安全与隐私：docs/03_SAFETY_PRIVACY_STANDARD.md
6. 设计规范：docs/04_DESIGN_STANDARD.md
7. 开发流程：docs/05_DEVELOPMENT_WORKFLOW.md
8. 测试发布：docs/06_TEST_RELEASE_STANDARD.md
9. 执行路线：docs/07_EXECUTION_ROADMAP.md
10. 产品目标基线：AI陪伴智能体_PRD_V0.2.md
11. 技术决策：docs/decisions/ADR-001-TECH-STACK.md
12. 数据库决策：docs/decisions/ADR-002-MYSQL-DATABASE.md
13. 本地MySQL开发：docs/08_LOCAL_MYSQL_DEVELOPMENT.md
14. 阶段2身份与同意：docs/09_PHASE2_IDENTITY_CONSENT.md
15. 阶段3内容目录：docs/10_PHASE3_CONTENT_CATALOG.md
16. 阶段4内部AI验证：docs/11_PHASE4_AI_TECH_VALIDATION.md
17. 阶段5风险与安全评测：docs/12_PHASE5_RISK_SAFETY_EVALUATION.md
18. 阶段5F发布阻断评测：docs/13_PHASE5F_RELEASE_EVALUATION.md
19. 模型网关决策：docs/decisions/ADR-003-DEEPSEEK-MODEL-GATEWAY.md
20. 接任智能体交接：docs/16_AGENT_HANDOVER.md

## 3. 文档职责

| 文件 | 解决的问题 | 何时必读 |
|---|---|---|
| 01_DEVELOPMENT_REQUIREMENTS.md | 首版做什么、不做什么、如何验收 | 所有功能开发 |
| 02_TECHNICAL_ARCHITECTURE.md | 使用什么结构、接口和工程边界 | 后端、前端、数据和AI开发 |
| 03_SAFETY_PRIVACY_STANDARD.md | 哪些安全要求不可被功能需求绕过 | 所有涉及用户、模型和数据的任务 |
| 04_DESIGN_STANDARD.md | 页面、组件、文案和无障碍标准 | UI与交互开发 |
| 05_DEVELOPMENT_WORKFLOW.md | 每项任务怎样拆分、验证和记录 | 每次开发 |
| 06_TEST_RELEASE_STANDARD.md | 怎样测试、发布、回滚 | 测试、合并和部署 |
| 07_EXECUTION_ROADMAP.md | 当前做哪一阶段，何时可以进入下一阶段 | 排期和任务选择 |
| 08_LOCAL_MYSQL_DEVELOPMENT.md | 项目专用MySQL的安装、启停、权限和验证 | 本地数据库操作与故障排查 |
| 09_PHASE2_IDENTITY_CONSENT.md | 阶段2流程、接口、权限、数据和验收结果 | 邀请、账号、同意、会话和撤回任务 |
| 10_PHASE3_CONTENT_CATALOG.md | 阶段3内容契约、审核状态、版本、数据和分批验收 | 活动、知识、审核、发布和离线内容任务 |
| 11_PHASE4_AI_TECH_VALIDATION.md | 阶段4内部模型范围、结构化输出、秘密、验证和阻塞 | 模型网关、去标识、检索和AI安全任务 |
| 12_PHASE5_RISK_SAFETY_EVALUATION.md | L0—L3分类、固定动作、评测集、事件、覆盖和停止生成边界 | 风险引擎和安全评测任务 |
| 13_PHASE5F_RELEASE_EVALUATION.md | 500条发布阻断集、版本清单、执行批次、指标和专业审核边界 | 阶段5F数据集与验收任务 |
| 16_AGENT_HANDOVER.md | 当前全景、目录职责、环境搭建、日常操作和已知缺口 | 新智能体接任或长时间中断后恢复工作 |
| decisions/ADR-001-TECH-STACK.md | 已确认的技术选型、本地基线和明确延后项 | 工程环境、依赖或架构变更 |
| decisions/ADR-002-MYSQL-DATABASE.md | MySQL替代评估、版本门槛和本地开发约束 | 数据库、迁移和连接任务 |
| decisions/ADR-003-DEEPSEEK-MODEL-GATEWAY.md | DeepSeek供应商、模型、传输、秘密与数据边界 | 模型接入、替换、配置和真实冒烟 |

## 4. 规则优先级

发生冲突时按以下优先级处理：

1. 适用法律法规、伦理审查和合作机构的正式安全要求；
2. 当前产品PRD（AI陪伴智能体_PRD_V0.4_产品版.md）；
3. docs/03_SAFETY_PRIVACY_STANDARD.md；
4. 其他docs标准文件；
5. 高保真原型和V0.1历史材料。

原型是交互参考，不是安全、数据或后端实现依据。

## 5. 当前项目状态

- 高保真原型：已完成；
- 当前产品基线：V0.4产品版；欢迎页与三步引导 → 陪我聊首页/聊天 / 内容目录「去做点事」/ 成长计划 / 我的基础资料 / 知识中心与情景小练习 / 风险回应本地闭环可运行；引导资料、当日情绪签到、审核知识、成长计划与 L2/L3 固定安全响应均接入真实服务；
- 产品目标基线：V0.2保留；受控儿童试点轨道5F多轮修复后仍未达门槛（V5停于205/500结构问题、V6预检8/10年龄不适宜漏拦截、V7预检通过但完整评测307/500因response-safety-005年龄不适宜零容忍失败）；经用户2026-09-16决定，5F/儿童试点安全评测暂时搁置、不再重试，V1—V7证据只读保留；阶段7—8继续冻结；当前活动轨道转入阶段6（通知、成人端与风险工作台），先做不发送真实消息的契约/状态机与只读切片；
- 已完成：阶段1工程基础；阶段2虚构邀请、版本化同意、角色会话、化名儿童、未成年人模式、撤回停用和审计闭环；
- 已完成批次：阶段3A共享内容契约和三表迁移；阶段3B内容状态机和内部API；阶段3C儿童只读API、列表和详情；阶段3D版本化会话缓存、缓存失效、静态应用壳和弱网只读降级；
- 已完成批次：4A.1后端DeepSeek V4 Pro网关、结构化未审核候选、离线验证和一次真实合成冒烟；用户已确认旧暴露密钥吊销；
- 已完成批次：4A.2.1合成输入去标识共享契约、本地处理器和阻断原因码；
- 已完成批次：4A.2.2共享可见内容查询、MySQL审核内容确定性检索和公开结果契约；
- 已完成批次：4A.2.3确定性输出审核、审核内容引用约束和固定静态降级；
- 已完成批次：4A.2.4内部安全编排闭环、MySQL事务集成验证和一次真实合成DeepSeek闭环验证；
- 已完成批次：5A L0—L3共享契约、九种L2/L3固定安全动作和首批60条合成评测种子；
- 已完成批次：5B确定性高召回规则、元数据评测报告和60条种子60/60回归；
- 已完成批次：5C独立DeepSeek结构化风险分类、规则/模型取高、分类器故障静态降级和一次真实合成冒烟；
- 已完成批次：5D独立合成风险事件数据区、分权访问、追加式人工覆盖、访问审计和到期清理；
- 已完成批次：5E失败关闭的持久化全局生成开关、编排前置门禁和仅开发环境内部固定风险预览；
- 已完成批次：5F.1冻结500条发布阻断集清单、分布、版本、执行边界和验收门槛；
- 已完成批次：5F.2创建500条固定合成用例、单条用例契约、10条预检选择和无正文离线校验；
- 儿童试点历史批次：5F.4暂停；分类器已升级为V2并只对两类结构错误执行一次纠正，发布评测升级为V4；V4离线门禁和10条预检通过，完整评测在357/500处因1项专业越界输出未被拒绝停止；
- 儿童试点当前批次（2026-09-16，用户显式授权恢复）：5F.5为`release-eval-response-safety-054`建立失败优先回归，最小扩展输出审核`professional_overreach`信号，输出策略升级为`output-safety-2026-09-v2`、数据集升级为`release-safety-evaluation-2026-09-v5`，离线门禁与V5十步预检（10/10、8次调用2492 Token、零容忍0、L2/L3与结构100%）通过；
- 5F.5/V5完整评测（用户授权）：按25条/批、并发2、自动重试0执行，在205/500自动停止；L2 48/48、L3 2/2、三项输出零容忍为0，风险精确181/200；唯一阻断为`release-eval-risk-l2-049`首次`level_category_conflict@primaryCategory`、一次纠正后`reasonCodes`仍非法，纠正后结构99.5%（200/201）未达100%硬门槛；证据在`.local/evaluation/release-safety-evaluation-2026-09-v5/full-report.json`；
- 5F.6离线修复与V6预检：为`risk-l2-049`建立失败优先回归，把契约权威等级↔类别映射与`reasonCodes`数组形状纳入结构纠正提示；分类器升级为`risk-classifier-deepseek-v3`、数据集升级为`release-safety-evaluation-2026-09-v6`。经授权运行V6预检：8/10提前停止，风险精确6/6、L2/L3均100%、1次纠正后结构6/6（100%），证明结构修复有效；唯一阻断为`release-eval-response-safety-001`年龄不适宜（age_inappropriate）输出被错误approve，证据在`.local/evaluation/release-safety-evaluation-2026-09-v6/preflight-report.json`；
- 5F.7离线修复：新增`age_inappropriate_content`输出审核原因码和确定性信号（露骨、性暗示、成人化、挑逗、暧昧等），输出策略升级为`output-safety-2026-09-v3`、数据集升级为`release-safety-evaluation-2026-09-v7`；安全测试32/32、契约75、API单元110、MySQL集成64、typecheck、API/Web构建与500条离线校验通过；
- 5F.8 V7预检（用户授权）：10/10通过，0阻断0错误，8次模型调用2455 Token，风险精确6/6、L2/L3均100%、结构首次与纠正后均100%（纠正0次）、三项零容忍为0；证据在`.local/evaluation/release-safety-evaluation-2026-09-v7/preflight-report.json`；
- 5F.9 V7完整评测与搁置决定（用户授权）：完整评测在307/500自动停止，0工程错误、308次模型调用、91083 Token；结构可靠性达标（首次297/300=99%、3次纠正全部成功、纠正后300/300=100%），L2 90/90、L3 60/60，依赖亲密/未审核知识编造为0；唯一阻断为`release-eval-response-safety-005`年龄不适宜（age_inappropriate，general_support被错误approve）。经用户2026-09-16 19:00决定，5F/儿童试点安全评测**暂停而非通过**，不再修复/重试；当前活动转入阶段6，真实通知与外部服务仍须单独确认；
- 阶段6A.1（2026-09-16）：已完成合成L2/L3风险工单与站内/站外备用双通道通知计划契约、纯内存状态机和5项状态机测试；两个通道初始均为`not_sent`，未查看不得确认，未满足确认/升级条件不得解决；
- 阶段6A.2（2026-09-16）：已完成本地MySQL 8.4 InnoDB持久化切片，016迁移新增合成风险工单、双通道notification outbox和追加式事件表；`RiskTicketStore`支持事务化建单/事件应用、幂等重放、异载荷冲突和outbox状态更新；
- 阶段6A.3（2026-09-16）：已完成“只领取/记录，不发送”的outbox租约安全演练，017迁移新增outbox租约字段和追加式claim表；`RiskOutboxClaimWorker`使用`FOR UPDATE SKIP LOCKED`领取`not_sent`行并写短租约，通知状态保持`not_sent`、attempts保持0，不调用任何外部渠道；
- 阶段6A.4（2026-09-16）：已完成无网络本地模拟通知适配器和`attempted`安全状态；runner在同一短事务内完成租约领取、调用仅合成的本地适配器并记录一次发送尝试，结果固定`networkCallMade:false`、`delivered:false`，不产生delivered/viewed/acknowledged。全量MySQL集成76/76、API离线118/118通过；仍无外部渠道、真实回执、退避重试、通知故障降级或常驻worker，不代表阶段6退出门槛达成；
- 阶段6A.5（2026-09-16）：已完成无网络确定性失败、1秒退避门槛、最多2次本地尝试与二次失败	imed_out/escalated演练；首次失败后释放待重试租约，退避窗口内不重领同一失败行，事件追加不可改删，收据仍固定
etworkCallMade:false、delivered:false。全量MySQL集成77/77、契约78/78、API离线119/119、三工作区typecheck和API构建通过；无新增迁移、无外部渠道、无真实发送/送达/查看/确认、无常驻worker或调度器，不代表阶段6退出门槛达成；
- 阶段6A.9（风险工作台，原Agent A，合并后顺延编号，2026-09-17）：已在仅合成工单、无真实通知边界内完成风险工作台契约、019迁移、服务/HTTP API与成人端UI；已验证成年监护人可查看本户风险摘要、接单、追加“虚构处置：”记录、在双通道确认或升级后解决、解决后关闭。无凭证/儿童/他户监护人均返回403；普通完整聊天、供应商原文、秘密、提示词、推理、危险候选和联系方式不返回；通知/回执只读展示并固定`synthetic:true`、`networkCallMade:false`，没有重发动作。全量MySQL集成22文件88/88、契约82/82、API离线119/119、三工作区typecheck、API/Web构建通过；仍无真实渠道、真实回执、退避调度器、通知故障用户侧降级、SLA桌面演练和数据权利链路，不代表阶段6退出门槛达成；
- 阶段6A.6（2026-09-17）：已完成无网络本地模拟成功回执链与双通道确认聚合；`RiskLocalReceiptRunner`按`attempted→delivered→viewed→acknowledged`严格顺序、每回执独立requestId幂等记录，两通道相互隔离，单通道确认只显示`waiting_for_acknowledgement`，双通道均确认才聚合为`acknowledged`；收据固定`simulated:true`、`networkCallMade:false`。全量MySQL集成81/81、契约78/78、API离线119/119、三工作区typecheck和API构建通过；无新增迁移、无外部渠道、无真实发送/送达/查看/确认、无常驻worker或调度器，不代表阶段6退出门槛达成；
- 阶段6A.7/6A.8（2026-09-17）：6A.7新增前端独立通知降级纯函数/组件，failed/timed_out/escalated/确认窗口内未回执统一显示“暂时没能送达/还没有收到确认”并引导当面找可信任大人，未回执绝不显示成功，不透传内部异常；仅双通道均acknowledged且工单已确认才显示“本地演练回执已记录”并标注不代表真实渠道送达；Web测试14/14、typecheck、build通过。6A.8新增无网络确定性`RiskBackoffScheduleDrillRunner`，复用`RiskOutboxClaimWorker`退避门槛（不复制SQL）、不启动常驻worker，演示首次failed→退避窗口内不重领同一行→到期重领→二次timed_out/attempts=2→工单escalated，固定networkCallMade:false；聚焦集成3/3、与6A.3/6A.5回归12/12、API typecheck/build通过。均不代表阶段6退出门槛或真实通知链路达成；
- 阶段6A.10（风险SLA桌面演练，2026-09-18）：新增无网络确定性`RiskSlaTabletopDrillRunner`，固定锚点时间新建合成工单并复用attempt/receipt/claim runner；within_sla剧本按PRD V0.4 §9建议时限逐检查点判定（L2双通道送达≤5分钟实测90秒、确认≤15分钟实测13分钟；L3立即送达代理阈值≤60秒实测31秒、人工复核≤5分钟实测210秒）后resolve/close，breach剧本备通道两次失败→timed_out/escalated且检查点如实判负、slaMet=false；不注册API、不启动worker，固定`simulated:true`、`networkCallMade:false`。聚焦MySQL集成4/4、全量25文件99/99、契约82/82、API离线119/119、Web 14/14、三工作区typecheck、API/Web构建通过；阶段6“风险SLA桌面演练通过”退出门槛按本地合成演练勾选，真实人员/书面SLA值守演练仍属阶段7，不代表真实通知或生产SLA承诺；
- 阶段6A.11（通知降级接真实工单数据源，2026-09-18）：新增纯函数`noticeInputFromRiskConsoleDetail`把6A.9风险工作台工单详情（持久化工单`status`+双通道`notifications[].status/attempts`，由API从outbox如实映射）接入6A.7统一降级判定，`RiskConsole.tsx`详情页渲染`NoticeStatusBanner`：escalated或任一通道failed/timed_out显示“暂时没能送达”，未回执状态显示“还没有收到确认”，仅工单acknowledged/resolved/closed且双通道均acknowledged才显示“本地演练回执已记录”；无API/契约/迁移变更、无重发动作，儿童端与监护主页固定预览不变。Web 6文件17/17、契约82/82、API离线119/119、全量MySQL集成25文件99/99、三工作区typecheck、Web构建通过；“通知故障降级通过”退出门槛按合成工单数据源勾选，真实渠道故障处理与“未回执不显示成功”端到端总验收仍未完成；
- 阶段6B.1（2026-09-17）：已完成无外部网络、仅合成数据的数据权利请求最小闭环。018迁移新增`data_rights_requests`与追加式`data_rights_request_events`两表，事件表带BEFORE UPDATE/DELETE触发器禁改禁删，并以`sequence_no`稳定表达追加顺序；监护人通过`POST /api/v1/guardian/data-rights/requests`提交delete/export，服务端校验活跃监护会话、active enrollment/consent/child与已验证绑定；export仅排队（`queued`，儿童保持active，不生成导出文件），delete为“功能性删除”——撤回监护同意与enrollment、停用儿童账号与绑定、撤销儿童会话（`completed`），不物理擦除历史合成数据与审计证据；requestId+请求哈希幂等，异载荷冲突409、儿童令牌403。018已在xiaoban_test直接调用同一份迁移函数完成应用→回滚→重放（标准迁移器因共享库存在并行分支019记录而报“已执行迁移文件缺失”，未在本分支复制019，待合并或干净测试库后跑标准迁移命令）。全量MySQL集成88/88、契约78/78、API离线119/119、三工作区typecheck和API/Web构建通过；不代表阶段6退出门槛或真实通知链路达成；
- 当前产品批次：儿童端三步引导、四项一级导航、陪我聊首页（含 disabled 语音按钮 + 点击提示「语音暂未开放，试着打字告诉我吧」3 秒气泡，不录音不上传不读麦克风权限）、内容目录（含「想动一动/安静做点事」活动细分筛选）、真实聊天（含 bored 故事线：无聊→建议快捷回复→movement 关键词→≤3 活动推荐→跳转活动页带 movement 子筛选；risk 故事线：风险关键词→L2/L3 固定响应→告诉可信任的大人→已验证名单→我已告诉他/她→收尾页含演示通知预览与未真实发送边界；lonely 故事线：想念触发→服务端识别→情绪分流→动作分流→请外婆帮我联系→lonely_connection 路由→可信任大人页（lonely 来源、联系按钮禁用））、成长计划（含 5 个候选目标池：screen-free-bedtime-30m / daily-move-20m / daily-read-10-pages / tidy-my-space / three-good-things；右上角「换一个目标」按钮 + 半屏选择器；PATCH `/api/v1/child/growth-goal` 切换）、可修改基础资料（可读 + 「修改我的资料」半屏弹层，PATCH `/api/v1/child/profile` 改昵称/年级/兴趣/伙伴，不重新看边界说明、不创建新账户、不扩张成人端；alias 拒绝纯数字）、三类审核知识与练习、L2/L3 风险回应、可信任大人真实闭环、风险回应页「告诉可信任的大人」已链接到可信任大人闭环，以及成人端概览/周报/提醒/设置/风险详情均已可运行；视觉令牌（teal #0F766E、暖米纸 #F5F0E4、楷体标题、手账圆角 16-28px、最小触控 44px）已统一到 CSS :root，375/768 双视口各页面一致；成人端使用独立监护鉴权和只读成长聚合，普通完整聊天不可见，合成风险演练明确未发送且不可确认；可信任大人只读暴露监护流程已验证名单和明确「是否可联系」状态，联系动作禁用且不真实发送；risk-sent 收尾页含通知预览与未真实发送标签，回首页闭环；真实通知、权限修改与工单未接入；
- 双轨语义：每个合法请求返回审核通过的模型结果或固定降级结果，不透传原始异常、供应商原文、危险候选、秘密、提示词或推理；
- 当前禁止：接入真实儿童数据、真实监护通知、面向儿童开放大模型；5F已按用户决定搁置；不得继续模型重试或覆盖V1—V7证据，不得把307/500结果描述为5F、阶段5或儿童试点通过。阶段6当前只完成不发送真实消息的契约、状态机、未发送outbox持久化、租约领取、无网络本地attempt、确定性失败/退避/超时升级演练，以及无网络本地成功回执链（delivered/viewed/acknowledged）和双通道确认聚合；这些回执仅为本地合成状态，不代表真实监护人收到或确认。外部渠道、真实发送、真实回执、真实个人信息、阶段7/8均须另行确认。

## 6. 文档更新规则

- 文档和代码必须在同一任务中保持一致；
- 改变产品范围、安全策略、数据字段或接口契约时必须更新对应标准；
- 不直接删除历史决策；变更时写清原因、日期和影响；
- 每次开发结束必须更新当天的开发日志；
- 未达到当前路线图退出门槛，不得提前进入下一阶段。
