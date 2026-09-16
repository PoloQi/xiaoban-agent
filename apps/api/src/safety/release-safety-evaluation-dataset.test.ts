import { describe, expect, it } from "vitest";

import { riskEvaluationSeedCases } from "./risk-evaluation-seed.js";
import {
  releaseSafetyEvaluationCases,
  releaseSafetyEvaluationValidationReport,
} from "./release-safety-evaluation-dataset.js";

describe("phase 5F.2 release safety evaluation dataset", () => {
  it("contains the frozen total, age split, and six-track distribution", () => {
    expect(releaseSafetyEvaluationCases).toHaveLength(500);
    expect(releaseSafetyEvaluationValidationReport).toMatchObject({
      datasetVersion: "release-safety-evaluation-2026-09-v7",
      totalCases: 500,
      ageBands: { "9_11": 250, "12_14": 250 },
      tracks: {
        ordinary_and_real_action: 100,
        risk_l1: 50,
        risk_l2: 90,
        risk_l3: 60,
        response_safety: 100,
        adversarial_privacy: 100,
      },
      uniqueIds: true,
      uniqueTranscripts: true,
      developmentSeedOverlap: 0,
    });
  });

  it("balances risk categories and zero-tolerance subdimensions", () => {
    const riskL2 = releaseSafetyEvaluationCases.filter((item) => item.track === "risk_l2");
    const riskL3 = releaseSafetyEvaluationCases.filter((item) => item.track === "risk_l3");
    const response = releaseSafetyEvaluationCases
      .filter((item) => item.track === "response_safety");
    const adversarial = releaseSafetyEvaluationCases
      .filter((item) => item.track === "adversarial_privacy");

    expect(Object.fromEntries([
      "bullying",
      "abuse_exploitation",
      "fraud_privacy",
      "dangerous_imitation",
      "self_harm",
      "harm_to_others",
    ].map((category) => [
      category,
      riskL2.filter((item) => item.expected.primaryCategory === category).length,
    ]))).toEqual({
      bullying: 15,
      abuse_exploitation: 15,
      fraud_privacy: 15,
      dangerous_imitation: 15,
      self_harm: 15,
      harm_to_others: 15,
    });
    expect(Object.fromEntries(["self_harm", "harm_to_others", "active_danger"].map(
      (category) => [
        category,
        riskL3.filter((item) => item.expected.primaryCategory === category).length,
      ],
    ))).toEqual({ self_harm: 20, harm_to_others: 20, active_danger: 20 });
    expect(Object.fromEntries([
      "age_inappropriate",
      "factual_fabrication",
      "professional_overreach",
      "dependency_intimacy",
      "dangerous_external_action",
    ].map((outcome) => [
      outcome,
      response.filter((item) => item.expected.forbiddenOutcome === outcome).length,
    ]))).toEqual({
      age_inappropriate: 20,
      factual_fabrication: 20,
      professional_overreach: 20,
      dependency_intimacy: 20,
      dangerous_external_action: 20,
    });
    expect(Object.fromEntries([
      "prompt_injection",
      "system_extraction",
      "pii_contact",
      "combined_adversarial",
    ].map((threat) => [
      threat,
      adversarial.filter((item) => item.expected.threat === threat).length,
    ]))).toEqual({
      prompt_injection: 30,
      system_extraction: 15,
      pii_contact: 35,
      combined_adversarial: 20,
    });
  });

  it("has unique content, complete form coverage, and no development-seed reuse", () => {
    const ids = releaseSafetyEvaluationCases.map((item) => item.id);
    const transcripts = releaseSafetyEvaluationCases.map((item) => item.turns.join("\n"));
    const seedTranscripts = new Set(riskEvaluationSeedCases.map((item) => item.turns.join("\n")));
    expect(new Set(ids).size).toBe(500);
    expect(new Set(transcripts).size).toBe(500);
    expect(transcripts.some((text) => seedTranscripts.has(text))).toBe(false);
    expect(new Set(releaseSafetyEvaluationCases.flatMap((item) => item.formTags))).toEqual(
      new Set([
        "direct",
        "indirect",
        "negation",
        "quoted",
        "third_person",
        "hypothetical",
        "typo",
        "colloquial",
        "regional_expression",
        "multi_turn",
        "combined_adversarial",
      ]),
    );
    expect(releaseSafetyEvaluationCases
      .filter((item) => item.formTags.includes("multi_turn"))
      .every((item) => item.turns.length > 1)).toBe(true);
  });

  it("selects exactly ten in-dataset preflight cases across required tracks", () => {
    const preflight = releaseSafetyEvaluationCases.filter((item) => item.preflight);
    expect(preflight).toHaveLength(10);
    expect(Object.fromEntries([
      "ordinary_and_real_action",
      "risk_l2",
      "risk_l3",
      "response_safety",
      "adversarial_privacy",
    ].map((track) => [track, preflight.filter((item) => item.track === track).length])))
      .toEqual({
        ordinary_and_real_action: 2,
        risk_l2: 2,
        risk_l3: 2,
        response_safety: 2,
        adversarial_privacy: 2,
      });
  });

  it("keeps validation metadata free of case text and raw model output", () => {
    const report = JSON.stringify(releaseSafetyEvaluationValidationReport);
    expect(report).not.toContain("turns");
    expect(report).not.toContain("rawModelOutput");
    expect(report).not.toContain("虚构评测");
    expect(JSON.stringify(releaseSafetyEvaluationCases)).not.toMatch(/1[3-9]\d{9}/u);
  });
});
