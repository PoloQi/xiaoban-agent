import { z } from "zod";

import {
  internalAiCandidateSchema,
  internalAiGenerationRequestSchema,
  internalAiGenerationResultSchema,
  type InternalAiGenerationRequest,
  type InternalAiGenerationResult,
} from "@xiaoban/contracts";

import type { DeepSeekConfig } from "./model-config.js";

export type FetchTransport = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

export type ModelGatewayErrorCode =
  | "MODEL_REQUEST_INVALID"
  | "MODEL_RESPONSE_INVALID"
  | "MODEL_UNAVAILABLE";

export class ModelGatewayError extends Error {
  constructor(readonly code: ModelGatewayErrorCode) {
    super(code);
    this.name = "ModelGatewayError";
  }
}

const providerResponseSchema = z.object({
  model: z.string().min(1),
  choices: z.array(z.object({
    message: z.object({ content: z.string() }),
  })).min(1),
  usage: z.object({
    prompt_tokens: z.number().int().min(0),
    completion_tokens: z.number().int().min(0),
    total_tokens: z.number().int().min(0),
  }),
});

const OUTPUT_FORMAT_INSTRUCTION = [
  "只返回一个JSON对象，不要Markdown、解释或推理过程。",
  "JSON字段必须严格为：",
  '{"intent":"general_support|activity_suggestion|knowledge_answer|decline","reply":"不超过800字符","contentSlugs":["最多3个已审核内容slug"]}',
  "没有可验证的审核内容slug时，contentSlugs必须为空数组。",
].join("\n");

export class DeepSeekGateway {
  constructor(
    private readonly config: DeepSeekConfig,
    private readonly transport: FetchTransport = fetch,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async generate(input: InternalAiGenerationRequest): Promise<InternalAiGenerationResult> {
    const request = internalAiGenerationRequestSchema.safeParse(input);
    if (!request.success) throw new ModelGatewayError("MODEL_REQUEST_INVALID");
    const startedAt = this.now();
    let response: Response;
    try {
      response = await this.transport(`${this.config.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.config.apiKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          model: this.config.model,
          messages: [
            {
              role: "system",
              content: `${request.data.systemPrompt}\n\n${OUTPUT_FORMAT_INSTRUCTION}`,
            },
            { role: "user", content: request.data.userPrompt },
          ],
          stream: false,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          max_tokens: this.config.maxOutputTokens,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new ModelGatewayError("MODEL_UNAVAILABLE");
    }
    if (!response.ok) throw new ModelGatewayError("MODEL_UNAVAILABLE");

    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch {
      throw new ModelGatewayError("MODEL_RESPONSE_INVALID");
    }
    const providerResponse = providerResponseSchema.safeParse(rawResponse);
    if (!providerResponse.success || providerResponse.data.model !== this.config.model) {
      throw new ModelGatewayError("MODEL_RESPONSE_INVALID");
    }

    let rawCandidate: unknown;
    try {
      rawCandidate = JSON.parse(providerResponse.data.choices[0]!.message.content);
    } catch {
      throw new ModelGatewayError("MODEL_RESPONSE_INVALID");
    }
    const candidate = internalAiCandidateSchema.safeParse(rawCandidate);
    if (!candidate.success) throw new ModelGatewayError("MODEL_RESPONSE_INVALID");

    const usage = providerResponse.data.usage;
    return internalAiGenerationResultSchema.parse({
      status: "unreviewed",
      candidate: candidate.data,
      trace: {
        provider: "deepseek",
        model: this.config.model,
        promptVersion: request.data.promptVersion,
        outputSchemaVersion: "internal-ai-candidate-v1",
        durationMs: Math.max(0, Math.round(this.now() - startedAt)),
        usage: {
          inputTokens: usage.prompt_tokens,
          outputTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
        },
      },
    });
  }
}
