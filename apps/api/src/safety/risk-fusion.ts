import {
  RISK_CLASSIFIER_VERSION,
  RISK_FUSION_VERSION,
  RISK_POLICY_VERSION,
  RISK_RULES_VERSION,
  riskFusionResultSchema,
  riskModelClassificationRequestSchema,
  riskModelClassificationResultSchema,
  riskRuleAssessmentResultSchema,
  type RiskFusionResult,
  type RiskModelClassificationRequest,
  type RiskModelClassificationResult,
  type RiskModelStatus,
  type RiskRuleAssessmentResult,
} from "@xiaoban/contracts";

export class RiskFusionError extends Error {
  constructor(readonly code: "RISK_FUSION_INPUT_INVALID") {
    super(code);
    this.name = "RiskFusionError";
  }
}

export type RiskModelOutcome =
  | { status: "ok"; result: RiskModelClassificationResult }
  | { status: Exclude<RiskModelStatus, "ok"> };

export type RiskClassifier = (
  request: RiskModelClassificationRequest,
) => Promise<RiskModelClassificationResult>;

const LEVEL_RANK = { L0: 0, L1: 1, L2: 2, L3: 3 } as const;

function routeFor(level: RiskRuleAssessmentResult["level"]): RiskFusionResult["route"] {
  if (level === "L0") return "reviewed_ai";
  if (level === "L1") return "support_and_offer_adult";
  return "fixed_safety";
}

function fusionError(): never {
  throw new RiskFusionError("RISK_FUSION_INPUT_INVALID");
}

export function fuseRiskAssessments(
  rawRule: unknown,
  rawOutcome: RiskModelOutcome,
): RiskFusionResult {
  const parsedRule = riskRuleAssessmentResultSchema.safeParse(rawRule);
  if (!parsedRule.success || rawOutcome === null || typeof rawOutcome !== "object") {
    return fusionError();
  }
  const rule = parsedRule.data;
  const versions = {
    policyVersion: RISK_POLICY_VERSION,
    rulesVersion: RISK_RULES_VERSION,
    classifierVersion: RISK_CLASSIFIER_VERSION,
    fusionVersion: RISK_FUSION_VERSION,
  };

  if (rawOutcome.status !== "ok") {
    if (rawOutcome.status !== "unavailable" && rawOutcome.status !== "invalid") {
      return fusionError();
    }
    if (LEVEL_RANK[rule.level] < LEVEL_RANK.L2) {
      return riskFusionResultSchema.parse({
        decision: "unknown",
        level: null,
        primaryCategory: null,
        route: "static_only",
        selectedSource: "none",
        disagreement: false,
        modelStatus: rawOutcome.status,
        rule: { level: rule.level, primaryCategory: rule.primaryCategory },
        model: null,
        versions,
      });
    }
    return riskFusionResultSchema.parse({
      decision: "classified",
      level: rule.level,
      primaryCategory: rule.primaryCategory,
      route: routeFor(rule.level),
      selectedSource: "rules",
      disagreement: false,
      modelStatus: rawOutcome.status,
      rule: { level: rule.level, primaryCategory: rule.primaryCategory },
      model: null,
      versions,
    });
  }

  const parsedModel = riskModelClassificationResultSchema.safeParse(rawOutcome.result);
  if (!parsedModel.success) return fusionError();
  const model = parsedModel.data;
  const ruleRank = LEVEL_RANK[rule.level];
  const modelRank = LEVEL_RANK[model.level];
  const sameCategory = rule.primaryCategory === model.primaryCategory;
  const selected = modelRank > ruleRank
    ? { level: model.level, primaryCategory: model.primaryCategory, source: "model" as const }
    : ruleRank > modelRank
      ? { level: rule.level, primaryCategory: rule.primaryCategory, source: "rules" as const }
      : sameCategory
        ? { level: rule.level, primaryCategory: rule.primaryCategory, source: "both" as const }
        : { level: rule.level, primaryCategory: rule.primaryCategory, source: "rules" as const };

  return riskFusionResultSchema.parse({
    decision: "classified",
    level: selected.level,
    primaryCategory: selected.primaryCategory,
    route: routeFor(selected.level),
    selectedSource: selected.source,
    disagreement: rule.level !== model.level || !sameCategory,
    modelStatus: "ok",
    rule: { level: rule.level, primaryCategory: rule.primaryCategory },
    model: { level: model.level, primaryCategory: model.primaryCategory },
    versions,
  });
}

function modelFailureStatus(error: unknown): Exclude<RiskModelStatus, "ok"> {
  const invalidCodes = new Set([
    "RISK_MODEL_RESPONSE_INVALID",
    "RISK_MODEL_PROVIDER_JSON_INVALID",
    "RISK_MODEL_PROVIDER_ENVELOPE_INVALID",
    "RISK_MODEL_ID_MISMATCH",
    "RISK_MODEL_CONTENT_JSON_INVALID",
    "RISK_MODEL_CANDIDATE_INVALID",
  ]);
  if (
    error !== null
    && typeof error === "object"
    && "code" in error
    && typeof error.code === "string"
    && invalidCodes.has(error.code)
  ) {
    return "invalid";
  }
  return "unavailable";
}

export async function classifyAndFuseRisk(
  rawRule: unknown,
  rawRequest: unknown,
  classify: RiskClassifier,
): Promise<RiskFusionResult> {
  const rule = riskRuleAssessmentResultSchema.safeParse(rawRule);
  const request = riskModelClassificationRequestSchema.safeParse(rawRequest);
  if (!rule.success || !request.success || typeof classify !== "function") {
    return fusionError();
  }

  try {
    const result = await classify(request.data);
    return fuseRiskAssessments(rule.data, { status: "ok", result });
  } catch (error) {
    return fuseRiskAssessments(rule.data, { status: modelFailureStatus(error) });
  }
}
