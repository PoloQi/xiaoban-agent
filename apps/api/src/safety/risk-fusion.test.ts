import { describe, expect, it } from "vitest";

import type {
  RiskModelClassificationResult,
  RiskRuleAssessmentResult,
} from "@xiaoban/contracts";

import {
  classifyAndFuseRisk,
  fuseRiskAssessments,
  RiskFusionError,
} from "./risk-fusion.js";

function rule(
  level: RiskRuleAssessmentResult["level"],
  primaryCategory: RiskRuleAssessmentResult["primaryCategory"],
): RiskRuleAssessmentResult {
  return {
    source: "rules",
    level,
    primaryCategory,
    matchedRuleIds: [level === "L0" ? "default.ordinary" : `${level.toLowerCase()}.synthetic.test`],
    policyVersion: "risk-policy-2026-08-v1",
      rulesVersion: "risk-rules-2026-08-v3",
  };
}

function model(
  level: RiskModelClassificationResult["level"],
  primaryCategory: RiskModelClassificationResult["primaryCategory"],
): RiskModelClassificationResult {
  return {
    source: "model",
    level,
    primaryCategory,
    reasonCodes: ["synthetic_signal"],
    trace: {
      provider: "deepseek",
      model: "deepseek-v4-pro",
      classifierVersion: "risk-classifier-deepseek-v3",
      durationMs: 1,
      usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
      structure: {
        attemptCount: 1,
        firstAttemptStructureValid: true,
        finalStructureValid: true,
        correctionAttempted: false,
        failures: [],
      },
    },
  };
}

describe("fuseRiskAssessments", () => {
  it("selects the higher model level", () => {
    expect(fuseRiskAssessments(rule("L1", "persistent_distress"), {
      status: "ok",
      result: model("L2", "bullying"),
    })).toMatchObject({
      decision: "classified",
      level: "L2",
      primaryCategory: "bullying",
      route: "fixed_safety",
      selectedSource: "model",
      disagreement: true,
    });
  });

  it("selects the higher rule level and marks identical labels as both", () => {
    expect(fuseRiskAssessments(rule("L3", "active_danger"), {
      status: "ok",
      result: model("L1", "persistent_distress"),
    })).toMatchObject({ level: "L3", selectedSource: "rules" });
    expect(fuseRiskAssessments(rule("L2", "bullying"), {
      status: "ok",
      result: model("L2", "bullying"),
    })).toMatchObject({
      level: "L2",
      selectedSource: "both",
      disagreement: false,
    });
  });

  it("keeps deterministic rules on an equal-level category disagreement", () => {
    expect(fuseRiskAssessments(rule("L2", "fraud_privacy"), {
      status: "ok",
      result: model("L2", "bullying"),
    })).toMatchObject({
      level: "L2",
      primaryCategory: "fraud_privacy",
      selectedSource: "rules",
      disagreement: true,
    });
  });

  it("returns unknown static-only for low rules when the classifier fails", async () => {
    const result = await classifyAndFuseRisk(
      rule("L0", "ordinary"),
      {
        requestId: "019c111a-f9e0-7dd8-a24c-6dfd908bb626",
        synthetic: true,
        ageBand: "9_11",
        turns: ["虚构测试：今天有点无聊。"],
      },
      async () => {
        throw { code: "RISK_MODEL_UNAVAILABLE" };
      },
    );

    expect(result).toMatchObject({
      decision: "unknown",
      level: null,
      route: "static_only",
      selectedSource: "none",
      modelStatus: "unavailable",
    });
  });

  it("keeps high rules in fixed safety when the classifier is invalid", async () => {
    const result = await classifyAndFuseRisk(
      rule("L2", "self_harm"),
      {
        requestId: "019c111a-f9e0-7dd8-a24c-6dfd908bb627",
        synthetic: true,
        ageBand: "12_14",
        turns: ["虚构测试：最近反复想到伤害自己。"],
      },
      async () => {
        throw { code: "RISK_MODEL_CANDIDATE_INVALID" };
      },
    );

    expect(result).toMatchObject({
      decision: "classified",
      level: "L2",
      route: "fixed_safety",
      selectedSource: "rules",
      modelStatus: "invalid",
    });
  });

  it("rejects malformed rule inputs without echo", () => {
    expect(() => fuseRiskAssessments({ rawText: "must not echo" } as never, {
      status: "unavailable",
    })).toThrow(new RiskFusionError("RISK_FUSION_INPUT_INVALID"));
  });
});
