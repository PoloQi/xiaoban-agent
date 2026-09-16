import { describe, expect, it, vi } from "vitest";

import type { DeepSeekConfig } from "../ai/model-config.js";
import {
  DeepSeekRiskClassifier,
  RiskModelGatewayError,
} from "./deepseek-risk-classifier.js";

const config: DeepSeekConfig = {
  apiKey: ["sk", "synthetic-stage5c-unit-key"].join("-"),
  baseUrl: "https://api.deepseek.com",
  model: "deepseek-v4-pro",
  timeoutMs: 12_000,
  maxOutputTokens: 800,
};
const request = {
  requestId: "019c111a-f9e0-7dd8-a24c-6dfd908bb625",
  synthetic: true as const,
  ageBand: "12_14" as const,
  turns: ["虚构测试：有人持续威胁传播我的照片。"],
};

function providerResponse(content: string, status = 200): Response {
  return new Response(JSON.stringify({
    model: "deepseek-v4-pro",
    choices: [{
      message: {
        content,
        reasoning_content: "must not leave the adapter",
      },
    }],
    usage: { prompt_tokens: 30, completion_tokens: 12, total_tokens: 42 },
  }), { status, headers: { "content-type": "application/json" } });
}

describe("DeepSeekRiskClassifier", () => {
  it("sends a fixed non-thinking JSON classification request and returns reason-only metadata", async () => {
    let capturedInit: RequestInit | undefined;
    const classifier = new DeepSeekRiskClassifier(
      config,
      async (_url, init) => {
        capturedInit = init;
        return providerResponse(JSON.stringify({
          level: "L2",
          primaryCategory: "bullying",
          reasonCodes: ["repeated_threat"],
        }));
      },
      () => 125,
    );

    const result = await classifier.classify(request);
    const body = JSON.parse(String(capturedInit?.body)) as Record<string, unknown>;
    const headers = new Headers(capturedInit?.headers);

    expect(headers.get("authorization")).toBe(`Bearer ${config.apiKey}`);
    expect(body).toMatchObject({
      model: "deepseek-v4-pro",
      stream: false,
      thinking: { type: "disabled" },
      response_format: { type: "json_object" },
      max_tokens: 256,
    });
    expect(JSON.stringify(body)).toContain("risk-classifier-deepseek-v3");
    expect(result).toMatchObject({
      source: "model",
      level: "L2",
      primaryCategory: "bullying",
      trace: {
        durationMs: 0,
        classifierVersion: "risk-classifier-deepseek-v3",
        structure: {
          attemptCount: 1,
          firstAttemptStructureValid: true,
          finalStructureValid: true,
          correctionAttempted: false,
          failures: [],
        },
      },
    });
    expect(JSON.stringify(result)).not.toContain("must not leave");
    expect(JSON.stringify(result)).not.toContain(config.apiKey);
  });

  it("rejects non-synthetic requests before transport", async () => {
    const transport = vi.fn();
    const classifier = new DeepSeekRiskClassifier(config, transport);

    await expect(classifier.classify({ ...request, synthetic: false } as never))
      .rejects.toEqual(new RiskModelGatewayError("RISK_MODEL_REQUEST_INVALID"));
    expect(transport).not.toHaveBeenCalled();
  });

  it("distinguishes provider JSON, envelope, model ID, content JSON, and candidate failures", async () => {
    const raw = "private malformed classifier output";
    const providerJsonTransport = vi.fn(async () => new Response(raw, { status: 200 }));
    const providerJsonClassifier = new DeepSeekRiskClassifier(
      config,
      providerJsonTransport,
    );
    const providerEnvelopeTransport = vi.fn(async () =>
      new Response(JSON.stringify({ model: config.model }), { status: 200 })
    );
    const providerEnvelopeClassifier = new DeepSeekRiskClassifier(
      config,
      providerEnvelopeTransport,
    );
    const modelIdTransport = vi.fn(async () => new Response(JSON.stringify({
      model: "unexpected-model",
      choices: [{ message: { content: "{}" } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
    }), { status: 200 }));
    const modelIdClassifier = new DeepSeekRiskClassifier(
      config,
      modelIdTransport,
    );
    const contentJsonClassifier = new DeepSeekRiskClassifier(
      config,
      async () => providerResponse(raw),
    );
    const candidateClassifier = new DeepSeekRiskClassifier(
      config,
      async () => providerResponse(JSON.stringify({
        level: "L2",
        primaryCategory: "bullying",
        reasonCodes: ["repeated_threat"],
        raw,
      })),
    );

    await expect(providerJsonClassifier.classify(request)).rejects.toMatchObject({
      code: "RISK_MODEL_PROVIDER_JSON_INVALID",
    });
    await expect(providerEnvelopeClassifier.classify(request)).rejects.toMatchObject({
      code: "RISK_MODEL_PROVIDER_ENVELOPE_INVALID",
    });
    await expect(modelIdClassifier.classify(request)).rejects.toMatchObject({
      code: "RISK_MODEL_ID_MISMATCH",
    });
    expect(providerJsonTransport).toHaveBeenCalledTimes(1);
    expect(providerEnvelopeTransport).toHaveBeenCalledTimes(1);
    expect(modelIdTransport).toHaveBeenCalledTimes(1);
    await expect(contentJsonClassifier.classify(request)).rejects.toMatchObject({
      code: "RISK_MODEL_CONTENT_JSON_INVALID",
    });
    await expect(candidateClassifier.classify(request)).rejects.toMatchObject({
      code: "RISK_MODEL_CANDIDATE_INVALID",
    });
    try {
      await candidateClassifier.classify(request);
    } catch (error) {
      expect((error as Error).message).not.toContain(raw);
    }
  });

  it("maps provider and network failures to stable unavailable", async () => {
    const providerTransport = vi.fn(async () => providerResponse("{}", 429));
    const providerFailure = new DeepSeekRiskClassifier(
      config,
      providerTransport,
    );
    const networkTransport = vi.fn(async () => {
      throw new Error("synthetic network detail");
    });
    const networkFailure = new DeepSeekRiskClassifier(config, networkTransport);

    await expect(providerFailure.classify(request)).rejects.toMatchObject({
      code: "RISK_MODEL_UNAVAILABLE",
    });
    await expect(networkFailure.classify(request)).rejects.toMatchObject({
      code: "RISK_MODEL_UNAVAILABLE",
    });
    expect(providerTransport).toHaveBeenCalledTimes(1);
    expect(networkTransport).toHaveBeenCalledTimes(1);
  });

  it("uses one corrective call for invalid content JSON and aggregates usage", async () => {
    const transport = vi.fn(async () => transport.mock.calls.length === 1
      ? providerResponse("invalid-json")
      : providerResponse(JSON.stringify({
        level: "L2",
        primaryCategory: "bullying",
        reasonCodes: ["repeated_threat"],
      })));
    const classifier = new DeepSeekRiskClassifier(config, transport, () => 125);

    const result = await classifier.classify(request);

    expect(transport).toHaveBeenCalledTimes(2);
    expect(result.trace).toMatchObject({
      usage: { inputTokens: 60, outputTokens: 24, totalTokens: 84 },
      structure: {
        attemptCount: 2,
        firstAttemptStructureValid: false,
        finalStructureValid: true,
        correctionAttempted: true,
        failures: [{
          attemptNumber: 1,
          code: "RISK_MODEL_CONTENT_JSON_INVALID",
          issues: [{ type: "invalid_json", path: "$" }],
        }],
      },
    });
  });

  it("corrects a candidate contract failure without echoing its raw fields or values", async () => {
    const privateField = "private_unknown_field";
    const privateValue = "private malformed classifier output";
    const capturedBodies: string[] = [];
    const transport = vi.fn(async (_url, init) => {
      capturedBodies.push(String(init?.body));
      return transport.mock.calls.length === 1
        ? providerResponse(JSON.stringify({
          level: "L2",
          primaryCategory: "bullying",
          reasonCodes: ["repeated_threat"],
          [privateField]: privateValue,
        }))
        : providerResponse(JSON.stringify({
          level: "L2",
          primaryCategory: "bullying",
          reasonCodes: ["repeated_threat"],
        }));
    });
    const classifier = new DeepSeekRiskClassifier(config, transport);

    const result = await classifier.classify(request);

    expect(result.trace.structure).toMatchObject({
      attemptCount: 2,
      firstAttemptStructureValid: false,
      finalStructureValid: true,
      correctionAttempted: true,
      failures: [{
        attemptNumber: 1,
        code: "RISK_MODEL_CANDIDATE_INVALID",
        issues: [{ type: "unknown_field", path: "$" }],
      }],
    });
    expect(capturedBodies[1]).not.toContain(privateField);
    expect(capturedBodies[1]).not.toContain(privateValue);
    expect(JSON.stringify(result)).not.toContain(privateField);
    expect(JSON.stringify(result)).not.toContain(privateValue);
  });

  it("correction prompt carries the contract level-category mapping and reasonCodes shape (release-eval-risk-l2-049 regression)", async () => {
    const capturedBodies: string[] = [];
    const transport = vi.fn(async (_url, init) => {
      capturedBodies.push(String(init?.body));
      return transport.mock.calls.length === 1
        ? providerResponse(JSON.stringify({
          level: "L0",
          primaryCategory: "bullying",
          reasonCodes: ["repeated_threat"],
        }))
        : providerResponse(JSON.stringify({
          level: "L2",
          primaryCategory: "bullying",
          reasonCodes: ["repeated_threat"],
        }));
    });
    const classifier = new DeepSeekRiskClassifier(config, transport, () => 125);

    const result = await classifier.classify(request);

    expect(result).toMatchObject({ level: "L2", primaryCategory: "bullying" });
    const correctiveBody = JSON.parse(capturedBodies[1]!) as {
      messages: Array<{ role: string; content: string }>;
    };
    const correctiveSystem = correctiveBody.messages[0]!.content;
    expect(correctiveSystem).toContain("ordinary:L0");
    expect(correctiveSystem).toContain("bullying:L2");
    expect(correctiveSystem).toContain("active_danger:L3");
    expect(correctiveSystem).toContain("self_harm:L2,L3");
    expect(correctiveSystem).toContain("reasonCodes");
  });
  it("fails closed after one corrective call and preserves safe first-failure metadata", async () => {
    const privateValue = "private malformed classifier output";
    const transport = vi.fn(async () => providerResponse(JSON.stringify({
      level: "L2",
      primaryCategory: "bullying",
      reasonCodes: ["repeated_threat"],
      extra: privateValue,
    })));
    const classifier = new DeepSeekRiskClassifier(config, transport);

    let caught: unknown;
    try {
      await classifier.classify(request);
    } catch (error) {
      caught = error;
    }

    expect(transport).toHaveBeenCalledTimes(2);
    expect(caught).toMatchObject({
      code: "RISK_MODEL_CANDIDATE_INVALID",
      usage: { inputTokens: 60, outputTokens: 24, totalTokens: 84 },
      structureTrace: {
        attemptCount: 2,
        firstAttemptStructureValid: false,
        finalStructureValid: false,
        correctionAttempted: true,
        failures: [
          { attemptNumber: 1, code: "RISK_MODEL_CANDIDATE_INVALID" },
          { attemptNumber: 2, code: "RISK_MODEL_CANDIDATE_INVALID" },
        ],
      },
    });
    expect(JSON.stringify(caught)).not.toContain(privateValue);
  });
});
