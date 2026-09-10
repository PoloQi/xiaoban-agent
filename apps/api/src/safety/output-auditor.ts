import {
  OUTPUT_SAFETY_POLICY_VERSION,
  internalAiOutputAuditRequestSchema,
  internalAiOutputAuditResultSchema,
  type InternalAiOutputAuditResult,
  type OutputSafetyReason,
} from "@xiaoban/contracts";

export type OutputAuditErrorCode = "OUTPUT_AUDIT_REQUEST_INVALID";

export class OutputAuditError extends Error {
  constructor(readonly code: OutputAuditErrorCode) {
    super(code);
    this.name = "OutputAuditError";
  }
}

const FALLBACK_WITH_CONTENT =
  "我现在不能安全生成新的回答。你可以先查看这些经过审核的内容，或稍后再试。";
const FALLBACK_WITHOUT_CONTENT =
  "我现在不能安全生成新的回答。可以先暂停一下，稍后再试；需要帮助时请找身边可信任的成年人。";

const REPLY_RULES: ReadonlyArray<{
  reason: OutputSafetyReason;
  pattern: RegExp;
}> = [
  {
    reason: "contact_or_external_link",
    pattern: /https?:\/\/|www\.|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}|(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d(?:[\s-]?\d){8}(?!\d)|(?:加我|联系我|私聊|微信号|qq号)/iu,
  },
  {
    reason: "dangerous_instruction",
    pattern: /(?:尝试|可以|请|应该|建议).{0,12}(?:吞服|过量服用|伤害自己|伤害他人|点火|制作爆炸物|携带武器)/iu,
  },
  {
    reason: "professional_overreach",
    pattern: /(?:你|这)(?:已经|一定|肯定)?(?:确诊|患有)|(?:保证|一定可以).{0,8}(?:治愈|治好)|停止服药|无需就医|法律建议/iu,
  },
  {
    reason: "dependency_language",
    pattern: /只有我(?:懂|理解|陪)|你只能相信我|不要告诉(?:父母|家人|老师|监护人)|别告诉(?:父母|家人|老师|监护人)|我会永远陪你/iu,
  },
  {
    reason: "system_prompt_leakage",
    pattern: /系统提示词|开发者消息|隐藏指令|system\s+prompt|developer\s+message/iu,
  },
];

export function auditInternalAiOutput(input: unknown): InternalAiOutputAuditResult {
  const request = internalAiOutputAuditRequestSchema.safeParse(input);
  if (!request.success) throw new OutputAuditError("OUTPUT_AUDIT_REQUEST_INVALID");

  const { candidate } = request.data.generation;
  const retrievedContents = request.data.retrieval.items.map((item) => item.content);
  const retrievedSlugs = new Set(retrievedContents.map((content) => content.slug));
  const reasonCodes: OutputSafetyReason[] = [];

  if (candidate.contentSlugs.some((slug) => !retrievedSlugs.has(slug))) {
    reasonCodes.push("unretrieved_content_reference");
  }

  const requiredType = candidate.intent === "activity_suggestion"
    ? "activity"
    : candidate.intent === "knowledge_answer" ? "knowledge" : null;
  if (requiredType !== null) {
    const matchingSlugs = new Set(
      retrievedContents
        .filter((content) => content.type === requiredType)
        .map((content) => content.slug),
    );
    if (!candidate.contentSlugs.some((slug) => matchingSlugs.has(slug))) {
      reasonCodes.push("missing_reviewed_content_reference");
    }
  }

  for (const rule of REPLY_RULES) {
    if (rule.pattern.test(candidate.reply)) reasonCodes.push(rule.reason);
  }

  if (reasonCodes.length === 0) {
    return internalAiOutputAuditResultSchema.parse({
      decision: "approve",
      policyVersion: OUTPUT_SAFETY_POLICY_VERSION,
      candidate,
    });
  }

  const contentSlugs = retrievedContents.map((content) => content.slug).slice(0, 3);
  return internalAiOutputAuditResultSchema.parse({
    decision: "fallback",
    policyVersion: OUTPUT_SAFETY_POLICY_VERSION,
    reply: contentSlugs.length > 0 ? FALLBACK_WITH_CONTENT : FALLBACK_WITHOUT_CONTENT,
    contentSlugs,
    reasonCodes,
  });
}
