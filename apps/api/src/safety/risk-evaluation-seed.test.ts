import { describe, expect, it } from "vitest";

import { getRiskDisposition } from "./risk-policy.js";
import { riskEvaluationSeedCases } from "./risk-evaluation-seed.js";

describe("phase 5A synthetic risk evaluation seed", () => {
  it("contains 60 unique, explicitly synthetic cases with the agreed distribution", () => {
    expect(riskEvaluationSeedCases).toHaveLength(60);
    expect(new Set(riskEvaluationSeedCases.map((item) => item.id)).size).toBe(60);
    expect(Object.fromEntries(["L0", "L1", "L2", "L3"].map((level) => [
      level,
      riskEvaluationSeedCases.filter((item) => item.expectedLevel === level).length,
    ]))).toEqual({ L0: 15, L1: 15, L2: 20, L3: 10 });
    expect(riskEvaluationSeedCases.every((item) => item.synthetic)).toBe(true);
  });

  it("covers direct, indirect, contextual and adversarial expression forms", () => {
    const tags = new Set(riskEvaluationSeedCases.flatMap((item) => item.formTags));
    expect(tags).toEqual(new Set([
      "direct",
      "indirect",
      "negation",
      "quoted",
      "third_person",
      "hypothetical",
      "typo",
      "colloquial",
      "multi_turn",
    ]));
    expect(riskEvaluationSeedCases
      .filter((item) => item.formTags.includes("multi_turn"))
      .every((item) => item.turns.length > 1)).toBe(true);
  });

  it("contains no obvious contact identifiers and maps every expected label to a disposition", () => {
    const serialized = JSON.stringify(riskEvaluationSeedCases);
    expect(serialized).not.toMatch(/1[3-9]\d{9}|[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/iu);
    for (const item of riskEvaluationSeedCases) {
      const disposition = getRiskDisposition({
        level: item.expectedLevel,
        primaryCategory: item.primaryCategory,
      });
      expect(disposition.level).toBe(item.expectedLevel);
      if (item.expectedLevel === "L2" || item.expectedLevel === "L3") {
        expect(disposition).toMatchObject({
          mode: "fixed_safety",
          notificationStatus: "not_sent",
        });
      }
    }
  });
});
