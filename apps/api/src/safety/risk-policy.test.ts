import { describe, expect, it } from "vitest";

import { getRiskDisposition, RiskPolicyError } from "./risk-policy.js";

describe("getRiskDisposition", () => {
  it("keeps L0 on reviewed AI and L1 on bounded support", () => {
    expect(getRiskDisposition({ level: "L0", primaryCategory: "ordinary" }))
      .toEqual({
        mode: "reviewed_ai",
        level: "L0",
        primaryCategory: "ordinary",
        requiresHuman: false,
        eventRequired: false,
        fixedReply: null,
        policyVersion: "risk-policy-2026-08-v1",
      });
    expect(getRiskDisposition({
      level: "L1",
      primaryCategory: "persistent_distress",
    })).toMatchObject({
      mode: "support_and_offer_adult",
      requiresHuman: false,
      eventRequired: false,
      fixedReply: null,
    });
  });

  it.each([
    ["L2", "bullying"],
    ["L2", "abuse_exploitation"],
    ["L2", "fraud_privacy"],
    ["L2", "dangerous_imitation"],
    ["L2", "self_harm"],
    ["L2", "harm_to_others"],
    ["L3", "self_harm"],
    ["L3", "harm_to_others"],
    ["L3", "active_danger"],
  ] as const)("returns a fixed unsent safety action for %s %s", (level, category) => {
    const result = getRiskDisposition({ level, primaryCategory: category });
    const serialized = JSON.stringify(result);

    expect(result).toMatchObject({
      mode: "fixed_safety",
      level,
      primaryCategory: category,
      requiresHuman: true,
      eventRequired: true,
      notificationStatus: "not_sent",
      policyVersion: "risk-policy-2026-08-v1",
    });
    expect(result.mode === "fixed_safety" && result.steps.length).toBeGreaterThanOrEqual(2);
    expect(serialized).not.toMatch(/已通知|已送达|已看到|正在处理|拨打\s*\d/gu);
  });

  it("rejects invalid level-category combinations without echoing input", () => {
    expect(() => getRiskDisposition({ level: "L0", primaryCategory: "self_harm" }))
      .toThrow(new RiskPolicyError("RISK_DISPOSITION_INVALID"));
    try {
      getRiskDisposition({
        level: "L3",
        primaryCategory: "ordinary",
        rawText: "must not be echoed",
      });
    } catch (error) {
      expect(error).toBeInstanceOf(RiskPolicyError);
      expect((error as Error).message).not.toContain("must not be echoed");
    }
  });
});
