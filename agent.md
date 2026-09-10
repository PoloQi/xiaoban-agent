# 小伴项目Agent工作说明

## 1. 适用范围

本文件是D:\code\agent工作区的项目级Agent指引。

任何Agent在本项目中规划、编码、测试、修改文档或执行自动任务前，都必须完整阅读本文件和对应标准。

## 2. 标准文件路径

项目根目录：D:\code\agent

| 类型 | 路径 |
|---|---|
| 当前产品PRD | AI陪伴智能体_PRD_V0.4_产品版.md |
| 产品目标基线PRD | AI陪伴智能体_PRD_V0.2.md |
| 历史PRD | AI陪伴智能体_PRD_V0.1.md |
| 高保真原型 | prototype |
| 标准索引 | docs/00_INDEX.md |
| 开发需求 | docs/01_DEVELOPMENT_REQUIREMENTS.md |
| 技术架构 | docs/02_TECHNICAL_ARCHITECTURE.md |
| 安全与隐私 | docs/03_SAFETY_PRIVACY_STANDARD.md |
| 设计规范 | docs/04_DESIGN_STANDARD.md |
| 开发流程 | docs/05_DEVELOPMENT_WORKFLOW.md |
| 测试与发布 | docs/06_TEST_RELEASE_STANDARD.md |
| 分阶段路线 | docs/07_EXECUTION_ROADMAP.md |
| 本地MySQL开发 | docs/08_LOCAL_MYSQL_DEVELOPMENT.md |
| 阶段2身份与同意 | docs/09_PHASE2_IDENTITY_CONSENT.md |
| 阶段3内容目录 | docs/10_PHASE3_CONTENT_CATALOG.md |
| 阶段4内部AI验证 | docs/11_PHASE4_AI_TECH_VALIDATION.md |
| 阶段5风险引擎与安全评测 | docs/12_PHASE5_RISK_SAFETY_EVALUATION.md |
| 阶段5F发布阻断评测 | docs/13_PHASE5F_RELEASE_EVALUATION.md |
| 技术决策记录 | docs/decisions/*.md |
| 每日开发日志 | 开发日志/YYYY-MM-DD.md |
| 日志说明 | 开发日志/README.md |
| 日志模板 | 开发日志/TEMPLATE.md |
| 日志脚本 | scripts/update-dev-log.ps1 |
| 原型阶段执行日志 | docx/执行日志.md |

相对路径均以D:\code\agent为起点。

## 3. 开始工作前

必须依次执行：

1. 阅读docs/00_INDEX.md；
2. 阅读docs/07_EXECUTION_ROADMAP.md，确认当前阶段；
3. 阅读当前产品PRD（AI陪伴智能体_PRD_V0.4_产品版.md）；
4. 阅读最新一份开发日志的待办与阻塞；
5. 根据任务读取需求、技术、安全、设计或测试标准；
6. 用一句话写清目标；
7. 明确非目标和验证方法；
8. 检查现有文件，保护用户未完成的工作。

没有确认当前阶段时，不开始编码。

## 4. 工作规模

遵循小步稳定原则：

- 每次只推进一个可验证目标；
- 一次最多3个紧密相关交付物；
- 不跨越当前轨道的路线图阶段；
- 不同时进行新功能、架构重构和大范围视觉改版；
- 发现额外问题先写入待办，不顺手扩展；
- 未达到同轨退出门槛时，继续修复当前阶段，不提前开发该轨道下一阶段。

## 5. 当前工作边界

- 不真实发送监护通知；
- 不采集身份证、人脸、语音、定位、相册和通讯录；
- 不因原型已有页面而跳过后端安全和权限设计。

## 6. 实现规则

- 最少修改，只触及当前目标；
- 优先写可验证的失败用例或验收检查；
- 不增加未批准的第三方依赖；
- 不创建当前任务不需要的抽象；
- API、数据和权限遵守docs/02_TECHNICAL_ARCHITECTURE.md；
- MySQL安装、启停、凭据和验证遵守docs/08_LOCAL_MYSQL_DEVELOPMENT.md；
- 涉及用户、模型、通知和数据时必须遵守docs/03_SAFETY_PRIVACY_STANDARD.md；
- 页面遵守docs/04_DESIGN_STANDARD.md；
- 测试和发布遵守docs/06_TEST_RELEASE_STANDARD.md；
- 秘密、真实账号和真实儿童信息不得进入代码、日志、截图或测试。

## 7. 必须暂停并请求确认的情况

- 需求会改变P0/P1/P2范围；
- 需要在受控儿童试点范围内切换轨道或进入真实儿童试点；
- 需要新外部服务、费用或网络权限；
- 需要真实个人信息或真实通知；
- 需要向客户端、日志或演示材料返回供应商原文、内部异常、危险候选、秘密、提示词或推理；
- 需要改变风险等级、成人可见范围或数据保留；
- 需要语音、定位、摄像头、设备数据或长期记忆；
- 当前轨道阶段退出门槛未达到；
- 发现安全要求和产品体验冲突；
- 现有用户改动与任务目标冲突。

## 8. 验证规则

完成前根据风险执行：

1. 静态和格式检查；
2. 单元测试；
3. 集成或契约测试；
4. 核心流程；
5. 手机和平板视觉检查；
6. 权限、安全与隐私回归；
7. 故障和降级；
8. 回滚检查。

不能执行的验证必须在最终说明和日志中明确，不得写成已通过。

## 9. 每日开发日志

每次开发结束必须更新当天的开发日志。

推荐命令：

powershell -ExecutionPolicy Bypass -File .\scripts\update-dev-log.ps1

日志必须区分：

- 已完成事实；
- 修改文件；
- 验证结果；
- 待办；
- 阻塞和风险。

每日自动任务只负责复核和补充，不自动推进业务代码，不得编造完成事项。

## 10. 文档同步

改变以下内容时，在同一任务更新相应标准：

- 功能范围和验收；
- 技术栈、目录和接口；
- 数据字段、用途、权限和保留；
- 风险、通知、值守和SLA；
- 组件、文案和无障碍；
- 测试、发布和回滚；
- 路线图当前阶段。

## 11. 交付说明

向用户汇报时先说结果，再简要列出：

- 完成内容；
- 验证结果；
- 未完成或风险；
- 下一步最小建议；
- 相关文件绝对路径链接。

不得用“全部完成”描述尚未达到退出门槛的阶段。
