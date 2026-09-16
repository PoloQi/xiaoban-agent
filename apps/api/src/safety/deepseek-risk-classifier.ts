import { z } from "zod";

import {
  RISK_CATEGORY_LEVELS,
  RISK_CLASSIFIER_VERSION,
  riskModelCandidateSchema,
  riskModelClassificationRequestSchema,
  riskModelClassificationResultSchema,
  riskModelStructureTraceSchema,
  type RiskModelCandidate,
  type RiskModelClassificationRequest,
  type RiskModelClassificationResult,
  type RiskModelStructureFailure,
  type RiskModelStructureTrace,
  type RiskModelValidationIssue,
} from "@xiaoban/contracts";

import type { FetchTransport } from "../ai/deepseek-gateway.js";
import type { DeepSeekConfig } from "../ai/model-config.js";

export type RiskModelGatewayErrorCode =
  | "RISK_MODEL_REQUEST_INVALID"
  | "RISK_MODEL_RESPONSE_INVALID"
  | "RISK_MODEL_PROVIDER_JSON_INVALID"
  | "RISK_MODEL_PROVIDER_ENVELOPE_INVALID"
  | "RISK_MODEL_ID_MISMATCH"
  | "RISK_MODEL_CONTENT_JSON_INVALID"
  | "RISK_MODEL_CANDIDATE_INVALID"
  | "RISK_MODEL_UNAVAILABLE";

type Usage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

const ZERO_USAGE: Usage = { inputTokens: 0, outputTokens: 0, totalTokens: 0 };

export class RiskModelGatewayError extends Error {
  constructor(
    readonly code: RiskModelGatewayErrorCode,
    readonly usage: Usage = ZERO_USAGE,
    readonly validationIssues: readonly RiskModelValidationIssue[] = [],
    readonly structureTrace?: RiskModelStructureTrace,
  ) {
    super(code);
    this.name = "RiskModelGatewayError";
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

const CLASSIFIER_PROMPT = [
  `内部合成风险分类器版本：${RISK_CLASSIFIER_VERSION}。`,
  "只对输入中的合成情境分类，不回复用户，不提供诊断或处置建议。",
  "L0=普通短期困扰；L1=持续困扰但无危险意图；L2=霸凌、疑似侵害、诈骗隐私、危险模仿、含糊自伤或伤人；L3=明确即时自伤/伤人或正在发生的人身危险。",
  "第三人称、引用、假设可能仍是在代他人求助，不得自动降低风险。规则不确定时选择更高等级。",
  "只返回JSON对象，字段严格为level、primaryCategory、reasonCodes，不要解释或推理。",
  "primaryCategory只能是ordinary、persistent_distress、bullying、abuse_exploitation、fraud_privacy、dangerous_imitation、self_harm、harm_to_others、active_danger。",
  "reasonCodes使用1到4个小写英文下划线原因码。",
].join("\n");

const STRUCTURE_CORRECTION_CODES = new Set<RiskModelGatewayErrorCode>([
  "RISK_MODEL_CONTENT_JSON_INVALID",
  "RISK_MODEL_CANDIDATE_INVALID",
]);

function addUsage(left: Usage, right: Usage): Usage {
  return {
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    totalTokens: left.totalTokens + right.totalTokens,
  };
}

function safeIssuePath(issue: z.core.$ZodIssue): RiskModelValidationIssue["path"] {
  const root = issue.path?.[0];
  if (root === "level" || root === "primaryCategory") return root;
  if (root === "reasonCodes") return issue.path.length > 1 ? "reasonCodes[]" : "reasonCodes";
  return "$";
}

function safeIssueType(
  issue: z.core.$ZodIssue,
  path: RiskModelValidationIssue["path"],
): RiskModelValidationIssue["type"] {
  if (issue.code === "unrecognized_keys") return "unknown_field";
  if (issue.code === "invalid_type") {
    return "input" in issue && issue.input === undefined ? "missing_field" : "invalid_type";
  }
  if (issue.code === "invalid_value") {
    return path === "level" || path === "primaryCategory" ? "invalid_enum" : "invalid_format";
  }
  if (issue.code === "invalid_format") return "invalid_format";
  if (issue.code === "too_small" || issue.code === "too_big") return "invalid_size";
  if (issue.code === "custom" && path === "reasonCodes") return "duplicate_value";
  if (issue.code === "custom" && path === "primaryCategory") {
    return "level_category_conflict";
  }
  return "other";
}

function safeValidationIssues(error: z.ZodError): RiskModelValidationIssue[] {
  const issues = error.issues.map((issue) => {
    const path = safeIssuePath(issue);
    return { type: safeIssueType(issue, path), path };
  });
  return [...new Map(issues.map((issue) => [`${issue.type}:${issue.path}`, issue])).values()]
    .slice(0, 8);
}

function structureFailure(
  error: RiskModelGatewayError,
  attemptNumber: 1 | 2,
): RiskModelStructureFailure {
  return {
    attemptNumber,
    code: error.code as RiskModelStructureFailure["code"],
    issues: [...error.validationIssues],
  };
}

const CATEGORY_LEVEL_MAPPING = Object.entries(RISK_CATEGORY_LEVELS)
  .map(([category, levels]) => `${category}:${levels.join(",")}`)
  .join("；");

function correctionPrompt(failure: RiskModelStructureFailure): string {
  const issueSummary = failure.issues
    .map((issue) => `${issue.type}:${issue.path}`)
    .join(",");
  return [
    CLASSIFIER_PROMPT,
    `上一次输出未通过结构校验（${failure.code}；${issueSummary}）。`,
    `合法的primaryCategory与level组合只能是：${CATEGORY_LEVEL_MAPPING}；请据此选择与等级匹配的类别。`,
    "reasonCodes必须是一个数组，包含1到4个互不重复的小写英文下划线字符串（例如[\"repeated_threat\"]），不能是字符串、数字或对象。",
    "请基于同一合成情境重新独立分类，只返回符合指定字段和枚举的JSON对象，不要复述上一次输出。",
  ].join("\n");
}

type CandidateAttempt = {
  candidate: RiskModelCandidate;
  usage: Usage;
};

export class DeepSeekRiskClassifier {
  constructor(
    private readonly config: DeepSeekConfig,
    private readonly transport: FetchTransport = fetch,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async classify(
    input: RiskModelClassificationRequest,
  ): Promise<RiskModelClassificationResult> {
    const request = riskModelClassificationRequestSchema.safeParse(input);
    if (!request.success) {
      throw new RiskModelGatewayError("RISK_MODEL_REQUEST_INVALID");
    }
    const startedAt = this.now();
    let first: CandidateAttempt;
    try {
      first = await this.classifyOnce(request.data);
    } catch (error) {
      if (
        !(error instanceof RiskModelGatewayError)
        || !STRUCTURE_CORRECTION_CODES.has(error.code)
      ) throw error;
      const firstFailure = structureFailure(error, 1);
      try {
        const corrected = await this.classifyOnce(request.data, firstFailure);
        return this.buildResult(
          corrected.candidate,
          addUsage(error.usage, corrected.usage),
          riskModelStructureTraceSchema.parse({
            attemptCount: 2,
            firstAttemptStructureValid: false,
            finalStructureValid: true,
            correctionAttempted: true,
            failures: [firstFailure],
          }),
          startedAt,
        );
      } catch (correctionError) {
        if (!(correctionError instanceof RiskModelGatewayError)) throw correctionError;
        const failures = [firstFailure];
        if (STRUCTURE_CORRECTION_CODES.has(correctionError.code)) {
          failures.push(structureFailure(correctionError, 2));
        }
        const trace = riskModelStructureTraceSchema.parse({
          attemptCount: 2,
          firstAttemptStructureValid: false,
          finalStructureValid: false,
          correctionAttempted: true,
          failures,
        });
        throw new RiskModelGatewayError(
          correctionError.code,
          addUsage(error.usage, correctionError.usage),
          correctionError.validationIssues,
          trace,
        );
      }
    }
    return this.buildResult(
      first.candidate,
      first.usage,
      riskModelStructureTraceSchema.parse({
        attemptCount: 1,
        firstAttemptStructureValid: true,
        finalStructureValid: true,
        correctionAttempted: false,
        failures: [],
      }),
      startedAt,
    );
  }

  private async classifyOnce(
    request: RiskModelClassificationRequest,
    correctionFailure?: RiskModelStructureFailure,
  ): Promise<CandidateAttempt> {
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
              content: correctionFailure === undefined
                ? CLASSIFIER_PROMPT
                : correctionPrompt(correctionFailure),
            },
            {
              role: "user",
              content: JSON.stringify({
                synthetic: true,
                ageBand: request.ageBand,
                turns: request.turns,
              }),
            },
          ],
          stream: false,
          thinking: { type: "disabled" },
          response_format: { type: "json_object" },
          max_tokens: 256,
        }),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch {
      throw new RiskModelGatewayError("RISK_MODEL_UNAVAILABLE");
    }
    if (!response.ok) throw new RiskModelGatewayError("RISK_MODEL_UNAVAILABLE");

    let rawResponse: unknown;
    try {
      rawResponse = await response.json();
    } catch {
      throw new RiskModelGatewayError("RISK_MODEL_PROVIDER_JSON_INVALID");
    }
    const providerResponse = providerResponseSchema.safeParse(rawResponse);
    if (!providerResponse.success) {
      throw new RiskModelGatewayError("RISK_MODEL_PROVIDER_ENVELOPE_INVALID");
    }
    if (providerResponse.data.model !== this.config.model) {
      throw new RiskModelGatewayError(
        "RISK_MODEL_ID_MISMATCH",
        this.providerUsage(providerResponse.data.usage),
      );
    }

    const usage = this.providerUsage(providerResponse.data.usage);

    let rawCandidate: unknown;
    try {
      rawCandidate = JSON.parse(providerResponse.data.choices[0]!.message.content);
    } catch {
      throw new RiskModelGatewayError(
        "RISK_MODEL_CONTENT_JSON_INVALID",
        usage,
        [{ type: "invalid_json", path: "$" }],
      );
    }
    const candidate = riskModelCandidateSchema.safeParse(rawCandidate);
    if (!candidate.success) {
      throw new RiskModelGatewayError(
        "RISK_MODEL_CANDIDATE_INVALID",
        usage,
        safeValidationIssues(candidate.error),
      );
    }

    return { candidate: candidate.data, usage };
  }

  private providerUsage(usage: z.infer<typeof providerResponseSchema>["usage"]): Usage {
    return {
      inputTokens: usage.prompt_tokens,
      outputTokens: usage.completion_tokens,
      totalTokens: usage.total_tokens,
    };
  }

  private buildResult(
    candidate: RiskModelCandidate,
    usage: Usage,
    structure: RiskModelStructureTrace,
    startedAt: number,
  ): RiskModelClassificationResult {
    return riskModelClassificationResultSchema.parse({
      source: "model",
      level: candidate.level,
      primaryCategory: candidate.primaryCategory,
      reasonCodes: candidate.reasonCodes,
      trace: {
        provider: "deepseek",
        model: this.config.model,
        classifierVersion: RISK_CLASSIFIER_VERSION,
        durationMs: Math.max(0, Math.round(this.now() - startedAt)),
        usage,
        structure,
      },
    });
  }
}
