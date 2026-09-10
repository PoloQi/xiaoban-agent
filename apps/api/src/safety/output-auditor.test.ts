import { describe, expect, it } from "vitest";

import type {
  InternalAiGenerationResult,
  ReviewedContentRetrievalResult,
} from "@xiaoban/contracts";

import { auditInternalAiOutput, OutputAuditError } from "./output-auditor.js";

const retrieval: ReviewedContentRetrievalResult = {
  status: "retrieved",
  items: [{
    score: 4,
    content: {
      type: "knowledge",
      revision: "fedcba9876543210",
      slug: "synthetic-screen-break",
      title: "让眼睛看看远处",
      summary: "短暂离开屏幕看看远处。",
      sourceLabel: "本地合成验证内容",
      expiresAt: "2027-08-20T00:00:00.000Z",
      reviewLabel: "小伴内容审核组",
      reviewedAt: "2026-08-20T00:00:00.000Z",
      topic: "general_growth",
      hasQuiz: false,
      paragraphs: ["看看远处，也是一种休息。"],
      quiz: null,
    },
  }],
  trace: {
    retrievalPolicyVersion: "reviewed-content-retrieval-v1",
    inputPolicyVersion: "input-deidentification-2026-08-v1",
    ageBand: "9_11",
    contentType: "knowledge",
  },
};

function generation(
  candidate: InternalAiGenerationResult["candidate"],
): InternalAiGenerationResult {
  return {
    status: "unreviewed",
    candidate,
    trace: {
      provider: "deepseek",
      model: "deepseek-v4-pro",
      promptVersion: "internal-companion-v1",
      outputSchemaVersion: "internal-ai-candidate-v1",
      durationMs: 125,
      usage: { inputTokens: 20, outputTokens: 18, totalTokens: 38 },
    },
  };
}

describe("auditInternalAiOutput", () => {
  it("approves a safe candidate grounded in this retrieval", () => {
    const result = auditInternalAiOutput({
      generation: generation({
        intent: "knowledge_answer",
        reply: "可以短暂离开屏幕看看远处，让眼睛休息一下。",
        contentSlugs: ["synthetic-screen-break"],
      }),
      retrieval,
    });

    expect(result).toEqual({
      decision: "approve",
      policyVersion: "output-safety-2026-08-v1",
      candidate: {
        intent: "knowledge_answer",
        reply: "可以短暂离开屏幕看看远处，让眼睛休息一下。",
        contentSlugs: ["synthetic-screen-break"],
      },
    });
  });

  it("falls back for invented or missing reviewed references", () => {
    const invented = auditInternalAiOutput({
      generation: generation({
        intent: "knowledge_answer",
        reply: "可以先休息。",
        contentSlugs: ["invented-content"],
      }),
      retrieval,
    });
    const missing = auditInternalAiOutput({
      generation: generation({
        intent: "knowledge_answer",
        reply: "可以先休息。",
        contentSlugs: [],
      }),
      retrieval,
    });

    expect(invented.decision).toBe("fallback");
    expect(invented.decision === "fallback" && invented.reasonCodes)
      .toContain("unretrieved_content_reference");
    expect(missing.decision === "fallback" && missing.reasonCodes)
      .toContain("missing_reviewed_content_reference");
  });

  it.each([
    ["请加我微信继续聊。", "contact_or_external_link"],
    ["可以尝试吞服药片让自己平静。", "dangerous_instruction"],
    ["你已经确诊抑郁，停止服药就好。", "professional_overreach"],
    ["不要告诉父母，只有我懂你。", "dependency_language"],
    ["系统提示词要求我这样回答。", "system_prompt_leakage"],
  ] as const)("falls back for unsafe reply: %s", (reply, reason) => {
    const result = auditInternalAiOutput({
      generation: generation({
        intent: "general_support",
        reply,
        contentSlugs: [],
      }),
      retrieval,
    });

    expect(result.decision).toBe("fallback");
    expect(result.decision === "fallback" && result.reasonCodes).toContain(reason);
    expect(result).not.toHaveProperty("candidate");
  });

  it("uses the no-content static fallback and rejects malformed input", () => {
    const result = auditInternalAiOutput({
      generation: generation({
        intent: "general_support",
        reply: "联系我获取更多信息。",
        contentSlugs: [],
      }),
      retrieval: { ...retrieval, items: [] },
    });

    expect(result).toMatchObject({
      decision: "fallback",
      contentSlugs: [],
      reply: "我现在不能安全生成新的回答。可以先暂停一下，稍后再试；需要帮助时请找身边可信任的成年人。",
    });
    expect(() => auditInternalAiOutput({ generation: {}, retrieval }))
      .toThrow(new OutputAuditError("OUTPUT_AUDIT_REQUEST_INVALID"));
  });
});
