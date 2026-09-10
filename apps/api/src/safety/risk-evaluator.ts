import {
  RISK_RULES_VERSION,
  RISK_SEED_DATASET_VERSION,
  riskEvaluationReportSchema,
  type RiskEvaluationCase,
  type RiskEvaluationReport,
  type RiskLevel,
} from "@xiaoban/contracts";

import { assessRiskWithRules } from "./risk-rule-engine.js";

const LEVEL_RANK: Record<RiskLevel, number> = {
  L0: 0,
  L1: 1,
  L2: 2,
  L3: 3,
};
const EVALUATION_REQUEST_ID = "019c111a-f9e0-7dd8-a24c-6dfd908bb624";

function percent(matched: number, total: number): number {
  return total === 0 ? 100 : Math.round((matched / total) * 10_000) / 100;
}

export function evaluateRiskRules(
  cases: ReadonlyArray<RiskEvaluationCase>,
): RiskEvaluationReport {
  const assessments = cases.map((item) => ({
    item,
    result: assessRiskWithRules({
      requestId: EVALUATION_REQUEST_ID,
      synthetic: true,
      ageBand: item.ageBand,
      turns: item.turns,
    }),
  }));
  const failures = assessments
    .filter(({ item, result }) => item.expectedLevel !== result.level
      || item.primaryCategory !== result.primaryCategory)
    .map(({ item, result }) => ({
      caseId: item.id,
      expectedLevel: item.expectedLevel,
      actualLevel: result.level,
      expectedCategory: item.primaryCategory,
      actualCategory: result.primaryCategory,
    }));

  const levelRecall = Object.fromEntries(
    (["L0", "L1", "L2", "L3"] as const).map((level) => {
      const expected = assessments.filter(({ item }) => item.expectedLevel === level);
      const matched = expected.filter(({ result }) => result.level === level).length;
      return [level, {
        total: expected.length,
        matched,
        percent: percent(matched, expected.length),
      }];
    }),
  );
  const l2Cases = assessments.filter(({ item }) => item.expectedLevel === "L2");
  const l2RoutedAtLeastL2 = l2Cases.filter(({ result }) =>
    LEVEL_RANK[result.level] >= LEVEL_RANK.L2).length;
  const l3Cases = assessments.filter(({ item }) => item.expectedLevel === "L3");
  const l3RoutedL3 = l3Cases.filter(({ result }) => result.level === "L3").length;

  return riskEvaluationReportSchema.parse({
    datasetVersion: RISK_SEED_DATASET_VERSION,
    rulesVersion: RISK_RULES_VERSION,
    total: cases.length,
    exactMatches: cases.length - failures.length,
    levelRecall,
    highRiskRouting: {
      l2Required: l2Cases.length,
      l2RoutedAtLeastL2,
      l2Percent: percent(l2RoutedAtLeastL2, l2Cases.length),
      l3Required: l3Cases.length,
      l3RoutedL3,
      l3Percent: percent(l3RoutedL3, l3Cases.length),
    },
    failures,
  });
}
