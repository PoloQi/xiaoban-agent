import { describe, expect, it } from "vitest";

import { assessRiskWithRules, RiskRuleEngineError } from "./risk-rule-engine.js";

const requestId = "019c111a-f9e0-7dd8-a24c-6dfd908bb623";

function assess(...turns: string[]) {
  return assessRiskWithRules({
    requestId,
    synthetic: true,
    ageBand: "12_14",
    turns,
  });
}

describe("assessRiskWithRules", () => {
  it.each([
    ["我现在可能会伤害自己。", "self_harm"],
    ["我准备马上让别人受伤。", "harm_to_others"],
    ["有人正在追打我，我不在安全的地方。", "active_danger"],
  ] as const)("routes immediate danger to L3: %s", (text, category) => {
    expect(assess(`虚构测试：${text}`)).toMatchObject({
      source: "rules",
      level: "L3",
      primaryCategory: category,
      policyVersion: "risk-policy-2026-08-v1",
      rulesVersion: "risk-rules-2026-08-v3",
    });
  });

  it("keeps negated immediacy at L2 across multiple turns", () => {
    expect(assess(
      "虚构测试：我并没有马上行动。",
      "但最近反复想到伤害自己。",
    )).toMatchObject({
      level: "L2",
      primaryCategory: "self_harm",
      matchedRuleIds: ["l2.self-harm.mention"],
    });
  });

  it.each([
    ["有人每天在群里辱骂和排斥我。", "bullying"],
    ["一个成年人让我保守秘密并单独见面。", "abuse_exploitation"],
    ["陌生人索要家庭住址和验证码。", "fraud_privacy"],
    ["我想模仿视频中的危险挑战。", "dangerous_imitation"],
  ] as const)("routes high-risk category to L2: %s", (text, category) => {
    expect(assess(`虚构测试：${text}`)).toMatchObject({
      level: "L2",
      primaryCategory: category,
    });
  });

  it("does not suppress quoted third-person or hypothetical high-risk reports", () => {
    expect(assess("虚构测试：朋友说他马上要伤害自己。")).toMatchObject({
      level: "L3",
      primaryCategory: "self_harm",
    });
    expect(assess("虚构测试：如果陌生成年人让我保密并单独见面怎么办？"))
      .toMatchObject({ level: "L2", primaryCategory: "abuse_exploitation" });
  });

  it("routes an immediate harm-to-others action with a pronoun reference to L3", () => {
    expect(assess(
      "虚构测试：这是正在发生的合成紧急情境。",
      "我正在追赶对方并准备立即动手伤害他。",
    )).toMatchObject({
      level: "L3",
      primaryCategory: "harm_to_others",
      matchedRuleIds: ["l3.harm-to-others.immediate"],
    });
  });

  it("routes an intentional climb to an unsafe location as dangerous imitation", () => {
    expect(assess(
      "虚构评测：我想为了拍视频爬到不安全的位置完成挑战。",
    )).toMatchObject({
      level: "L2",
      primaryCategory: "dangerous_imitation",
      matchedRuleIds: ["l2.dangerous-imitation.challenge"],
    });
  });

  it("separates persistent concern from ordinary short-term distress", () => {
    expect(assess("虚构测试：最近很多天都觉得很孤单。")).toMatchObject({
      level: "L1",
      primaryCategory: "persistent_distress",
    });
    expect(assess("虚构测试：今天没和朋友一起玩，有一点孤单。")).toMatchObject({
      level: "L0",
      primaryCategory: "ordinary",
      matchedRuleIds: ["default.ordinary"],
    });
  });

  it("returns reason-only metadata and rejects malformed inputs without echo", () => {
    const result = assess("虚构测试：现在正在发生危险，我被困住了。");
    expect(JSON.stringify(result)).not.toContain("被困住了");
    expect(() => assessRiskWithRules({
      requestId,
      synthetic: false,
      ageBand: "12_14",
      turns: ["must not be echoed"],
    })).toThrow(new RiskRuleEngineError("RISK_RULE_REQUEST_INVALID"));
  });
});
