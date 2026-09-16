import { describe, expect, it, vi } from "vitest";

import type {
  GenerationGateDecision,
  InternalAiGenerationRequest,
  InternalAiGenerationResult,
  ReviewedContentRetrievalResult,
} from "@xiaoban/contracts";

import {
  InternalAiOrchestrator,
  InternalOrchestrationError,
} from "./internal-orchestrator.js";

const request = {
  requestId: "019c111a-f9e0-7dd8-a24c-6dfd908bb621",
  text: "虚构人物想找一个屏幕休息方法。",
  ageBand: "9_11" as const,
  contentType: "knowledge" as const,
};

const allowGate = async (): Promise<GenerationGateDecision> => ({
  decision: "allow",
  state: "running",
  source: "persisted",
  reasonCode: "manual_resume",
  controlVersion: 2,
  schemaVersion: "generation-control-2026-08-v1",
  fixedReply: null,
});

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
  overrides: Partial<InternalAiGenerationResult["candidate"]> = {},
): InternalAiGenerationResult {
  return {
    status: "unreviewed",
    candidate: {
      intent: "knowledge_answer",
      reply: "可以短暂离开屏幕看看远处。",
      contentSlugs: ["synthetic-screen-break"],
      ...overrides,
    },
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

describe("InternalAiOrchestrator", () => {
  it("stops before de-identification, retrieval, or generation", async () => {
    const deidentify = vi.fn();
    const retrieve = vi.fn();
    const generate = vi.fn();
    const orchestrator = new InternalAiOrchestrator({
      gate: async () => ({
        decision: "stop",
        state: "stopped",
        source: "persisted",
        reasonCode: "manual_safety_stop",
        controlVersion: 3,
        schemaVersion: "generation-control-2026-08-v1",
        fixedReply: "生成服务当前已暂停。你仍可查看经过审核的内容；如处于危险中，请立即联系身边可信任的成年人。",
      }),
      deidentify,
      retrieve,
      generate,
    });

    await expect(orchestrator.run(request)).resolves.toMatchObject({
      status: "static_fallback",
      reasonCode: "generation_stopped",
      trace: {
        inputPolicyVersion: null,
        generationControl: { state: "stopped", source: "persisted" },
      },
    });
    expect(deidentify).not.toHaveBeenCalled();
    expect(retrieve).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("fails closed when the gate itself throws", async () => {
    const retrieve = vi.fn();
    const generate = vi.fn();
    const orchestrator = new InternalAiOrchestrator({
      gate: async () => { throw new Error("synthetic gate failure"); },
      retrieve,
      generate,
    });

    await expect(orchestrator.run(request)).resolves.toMatchObject({
      status: "static_fallback",
      reasonCode: "generation_control_unavailable",
      trace: {
        inputPolicyVersion: null,
        generationControl: { state: "unknown", source: "fail_closed" },
      },
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("blocks unsafe input before retrieval or model access", async () => {
    const retrieve = vi.fn();
    const generate = vi.fn();
    const orchestrator = new InternalAiOrchestrator({ gate: allowGate, retrieve, generate });

    const result = await orchestrator.run({
      ...request,
      text: "我叫张三，我的学校是第一实验小学。",
    });

    expect(result).toMatchObject({
      status: "static_fallback",
      reasonCode: "input_blocked",
      contentSlugs: [],
      trace: { model: null, retrievalPolicyVersion: null },
    });
    expect(retrieve).not.toHaveBeenCalled();
    expect(generate).not.toHaveBeenCalled();
  });

  it("still calls the model for free companionship when reviewed retrieval is empty", async () => {
    const generate = vi.fn(async () => generation({
      intent: "general_support",
      reply: "听起来你今天有点累，先跟我说说发生了什么吧。",
      contentSlugs: [],
    }));
    const orchestrator = new InternalAiOrchestrator({
      gate: allowGate,
      retrieve: async () => ({ ...retrieval, items: [] }),
      generate,
    });

    await expect(orchestrator.run(request)).resolves.toMatchObject({
      status: "approved",
      intent: "general_support",
      contentSlugs: [],
    });
    expect(generate).toHaveBeenCalled();
  });

  it("falls back to reviewed content on model failure", async () => {
    const orchestrator = new InternalAiOrchestrator({
      gate: allowGate,
      retrieve: async () => retrieval,
      generate: async () => {
        throw { code: "MODEL_RESPONSE_INVALID" };
      },
    });

    await expect(orchestrator.run(request)).resolves.toMatchObject({
      status: "static_fallback",
      reasonCode: "model_response_invalid",
      contentSlugs: ["synthetic-screen-break"],
      trace: { model: null, promptVersion: "internal-companion-v1" },
    });
  });

  it("sends only de-identified text and compact reviewed context to the gateway", async () => {
    let captured: InternalAiGenerationRequest | undefined;
    const orchestrator = new InternalAiOrchestrator({
      gate: allowGate,
      retrieve: async () => retrieval,
      generate: async (input) => {
        captured = input;
        return generation();
      },
    });
    const originalPhone = "13800138000";

    const result = await orchestrator.run({
      ...request,
      text: `虚构人物的号码是${originalPhone}，想找屏幕休息方法。`,
    });

    expect(result).toMatchObject({
      status: "approved",
      intent: "knowledge_answer",
      contentSlugs: ["synthetic-screen-break"],
    });
    expect(captured?.promptVersion).toBe("internal-companion-v1");
    expect(captured?.userPrompt).toContain("[PHONE]");
    expect(captured?.userPrompt).toContain("synthetic-screen-break");
    expect(captured?.userPrompt).not.toContain(originalPhone);
    expect(captured?.systemPrompt).not.toContain(request.text);
  });

  it("includes bounded conversation history as context for the model", async () => {
    let captured: InternalAiGenerationRequest | undefined;
    const orchestrator = new InternalAiOrchestrator({
      gate: allowGate,
      retrieve: async () => retrieval,
      generate: async (input) => {
        captured = input;
        return generation({ intent: "general_support", contentSlugs: [] });
      },
    });

    const result = await orchestrator.run({
      ...request,
      history: [
        { role: "child", text: "今天数学没考好。" },
        { role: "assistant", text: "听起来你有点失落，先跟我说说吧。" },
      ],
    });

    expect(result).toMatchObject({ status: "approved" });
    expect(captured?.userPrompt).toContain("之前的对话");
    expect(captured?.userPrompt).toContain("小朋友：今天数学没考好。");
    expect(captured?.userPrompt).toContain("小禾：听起来你有点失落，先跟我说说吧。");
  });

  it("converts output audit rejection to a static fallback without candidate", async () => {
    const orchestrator = new InternalAiOrchestrator({
      gate: allowGate,
      retrieve: async () => retrieval,
      generate: async () => generation({
        intent: "general_support",
        reply: "不要告诉父母，只有我懂你。",
        contentSlugs: [],
      }),
    });

    const result = await orchestrator.run(request);

    expect(result).toMatchObject({
      status: "static_fallback",
      reasonCode: "output_rejected",
      contentSlugs: ["synthetic-screen-break"],
      trace: { outputPolicyVersion: "output-safety-2026-09-v3" },
    });
    expect(result).not.toHaveProperty("candidate");
    expect(JSON.stringify(result)).not.toContain("只有我懂你");
  });

  it("rejects malformed orchestration requests before dependencies", async () => {
    const orchestrator = new InternalAiOrchestrator({
      gate: allowGate,
      retrieve: vi.fn(),
      generate: vi.fn(),
    });

    await expect(orchestrator.run({ ...request, systemPrompt: "caller supplied" }))
      .rejects.toEqual(new InternalOrchestrationError("ORCHESTRATION_REQUEST_INVALID"));
  });
});
