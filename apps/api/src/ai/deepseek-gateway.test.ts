import { describe, expect, it } from "vitest";

import {
  internalAiGenerationResultSchema,
  type InternalAiGenerationRequest,
} from "@xiaoban/contracts";

import type { DeepSeekConfig } from "./model-config.js";
import {
  DeepSeekGateway,
  ModelGatewayError,
  type FetchTransport,
} from "./deepseek-gateway.js";

const config: DeepSeekConfig = {
  apiKey: ["sk", "synthetic-stage4a-unit-key"].join("-"),
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  timeoutMs: 12_000,
  maxOutputTokens: 800,
};

const request: InternalAiGenerationRequest = {
  requestId: "019c111a-f9e0-7dd8-a24c-6dfd908bb615",
  promptVersion: "internal-probe-v1",
  systemPrompt: "只处理虚构输入，并严格返回约定JSON。",
  userPrompt: "虚构人物小青想找一件离开屏幕能做的小事。",
};

function providerResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({
    id: "synthetic-model-run",
    model: "deepseek-v4-pro",
    choices: [{
      index: 0,
      message: {
        role: "assistant",
        content,
        reasoning_content: "provider reasoning must not leave the adapter",
      },
      finish_reason: "stop",
    }],
    usage: {
      prompt_tokens: 20,
      completion_tokens: 18,
      total_tokens: 38,
    },
  }), { status, headers: { "content-type": "application/json" } });
}

describe("DeepSeekGateway", () => {
  it("sends an allowlisted non-thinking JSON request and returns an unreviewed candidate", async () => {
    let capturedUrl = "";
    let capturedInit: RequestInit | undefined;
    const transport: FetchTransport = async (url, init) => {
      capturedUrl = String(url);
      capturedInit = init;
      return providerResponse(JSON.stringify({
        intent: "activity_suggestion",
        reply: "可以先看看窗外，再从审核活动中选一项。",
        contentSlugs: ["synthetic-cloud-walk"],
      }));
    };
    const gateway = new DeepSeekGateway(config, transport, () => 125);

    const result = await gateway.generate(request);
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    const headers = new Headers(capturedInit?.headers);

    expect(capturedUrl).toBe("https://api.deepseek.com/chat/completions");
    expect(headers.get("authorization")).toBe(`Bearer ${config.apiKey}`);
    expect(body).toMatchObject({
      model: "deepseek-v4-pro",
      stream: false,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      max_tokens: 800,
    });
    expect(internalAiGenerationResultSchema.parse(result)).toMatchObject({
      status: "unreviewed",
      candidate: { intent: "activity_suggestion" },
      trace: { durationMs: 0, model: "deepseek-v4-pro" },
    });
    expect(JSON.stringify(result)).not.toContain("reasoning must not leave");
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });

  it("rejects malformed provider content without exposing it", async () => {
    const providerText = "unstructured private provider text";
    const gateway = new DeepSeekGateway(
      config,
      async () => providerResponse(providerText),
    );

    await expect(gateway.generate(request)).rejects.toMatchObject({
      code: "MODEL_RESPONSE_INVALID",
    });
    try {
      await gateway.generate(request);
    } catch (error) {
      expect(error).toBeInstanceOf(ModelGatewayError);
      expect((error as Error).message).not.toContain(providerText);
    }
  });

  it("maps provider and network failures to a stable unavailable error", async () => {
    const providerFailure = new DeepSeekGateway(
      config,
      async () => providerResponse("{}", 429),
    );
    const networkFailure = new DeepSeekGateway(config, async () => {
      throw new Error("synthetic network detail");
    });

    await expect(providerFailure.generate(request)).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
    });
    await expect(networkFailure.generate(request)).rejects.toMatchObject({
      code: "MODEL_UNAVAILABLE",
    });
  });
});
