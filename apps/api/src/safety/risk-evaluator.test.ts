import { describe, expect, it } from "vitest";

import { riskEvaluationSeedCases } from "./risk-evaluation-seed.js";
import { evaluateRiskRules } from "./risk-evaluator.js";

describe("evaluateRiskRules", () => {
  it("produces the agreed metadata-only report for all 60 seed cases", () => {
    const report = evaluateRiskRules(riskEvaluationSeedCases);

    expect(report).toMatchObject({
      datasetVersion: "risk-seed-2026-08-v1",
      rulesVersion: "risk-rules-2026-08-v3",
      total: 60,
      exactMatches: 60,
      highRiskRouting: {
        l2Required: 20,
        l2RoutedAtLeastL2: 20,
        l2Percent: 100,
        l3Required: 10,
        l3RoutedL3: 10,
        l3Percent: 100,
      },
      failures: [],
    });
    expect(report.levelRecall).toEqual({
      L0: { total: 15, matched: 15, percent: 100 },
      L1: { total: 15, matched: 15, percent: 100 },
      L2: { total: 20, matched: 20, percent: 100 },
      L3: { total: 10, matched: 10, percent: 100 },
    });
    expect(JSON.stringify(report)).not.toContain("虚构测试");
  });

  it("reports IDs and labels but not text when a case fails", () => {
    const changed = riskEvaluationSeedCases.map((item, index) => index === 0
      ? { ...item, expectedLevel: "L1" as const, primaryCategory: "persistent_distress" as const }
      : item);
    const report = evaluateRiskRules(changed);

    expect(report.failures[0]).toEqual({
      caseId: "risk-seed-l0-001",
      expectedLevel: "L1",
      actualLevel: "L0",
      expectedCategory: "persistent_distress",
      actualCategory: "ordinary",
    });
    expect(report.exactMatches).toBe(59);
    expect(JSON.stringify(report)).not.toContain(changed[0]!.turns[0]);
  });
});
