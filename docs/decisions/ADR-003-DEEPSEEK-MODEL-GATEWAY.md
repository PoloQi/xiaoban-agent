# ADR-003：阶段4A DeepSeek模型网关

- 状态：已接受
- 日期：2026-08-18
- 决策范围：阶段4A内部AI技术验证

## 1. 背景

阶段3已经完成静态内容闭环。阶段4只允许内部成人账号和合成数据，用于验证模型网关、去标识、结构化输出、安全审核、故障降级和版本追踪；未达到后续安全门槛前不得向儿童开放模型。

用户确认采用DeepSeek官方API和`deepseek-v4-pro`。先前在对话中暴露的密钥视为失效，不得写入或用于项目；真实冒烟测试必须等待用户在本地秘密目录注入轮换后的新密钥。

## 2. 决策

- 官方OpenAI兼容Base URL固定为`https://api.deepseek.com`；
- 模型允许列表在4A.1固定为`deepseek-v4-pro`；
- 使用Node.js 22原生`fetch`，不新增模型SDK依赖；
- 思考模式默认且固定为关闭，不保存、返回或展示`reasoning_content`；
- 请求强制JSON输出，响应先解析为JSON，再通过共享Zod结构校验；
- 所有模型结果标记为`unreviewed`，4A.1不提供儿童接口、聊天页面或自动展示路径；
- 超时上限为12秒，不自动重试，不在失败时展示供应商原文；
- 密钥仅从后端环境读取，本地文件放在已被Git忽略的`.local/model-secrets/deepseek.env`；
- 测试和默认门禁使用模拟传输，不产生外部费用；真实冒烟仅使用合成输入，且控制台不打印提示词、回复正文或密钥。

## 3. 供应商与数据边界

DeepSeek只是可替换的模型供应商，不是产品安全决策者。阶段4A不得发送真实儿童输入、化名、站点、联系人或其他个人信息。真实儿童接入前还必须完成数据留存、训练使用、地域、删除机制、监护授权、合同和伦理审查。

官方依据：

- https://api-docs.deepseek.com/quick_start/pricing
- https://api-docs.deepseek.com/api/create-chat-completion
- https://cdn.deepseek.com/policies/zh-CN/deepseek-open-platform-terms-of-service.html
- https://cdn.deepseek.com/policies/zh-CN/deepseek-privacy-policy.html

## 4. 4A.1非目标

- 不向儿童或监护人开放模型；
- 不新增会话表、长期记忆、检索、工具执行或流式页面；
- 不记录完整输入输出；
- 不把供应商输出视为审核通过内容；
- 不实现风险分类、通知或值守流程，这些属于后续阶段。

## 5. 复核条件

更换模型、Base URL、供应商、思考策略、数据用途或保留策略时必须复核本ADR。进入真实儿童试点前，本ADR不能代替隐私、合同、科技伦理和安全评测结论。
