import {
  RISK_POLICY_VERSION,
  RISK_RULES_VERSION,
  riskRuleAssessmentRequestSchema,
  riskRuleAssessmentResultSchema,
  type RiskCategory,
  type RiskLevel,
  type RiskRuleAssessmentResult,
} from "@xiaoban/contracts";

export type RiskRuleEngineErrorCode = "RISK_RULE_REQUEST_INVALID";

export class RiskRuleEngineError extends Error {
  constructor(readonly code: RiskRuleEngineErrorCode) {
    super(code);
    this.name = "RiskRuleEngineError";
  }
}

interface RuleMatch {
  level: RiskLevel;
  primaryCategory: RiskCategory;
  ruleId: string;
}

const SELF_HARM = /伤害自己|自伤|不想活|活不下去|结束生命/iu;
const HARM_TO_OTHERS = /伤害(?:旁边的人|别人|他人|同学|对方|他们|她们|他|她)|让(?:别人|他人|同学|对方)受伤|打伤(?:别人|他人|同学|对方)/iu;
const IMMEDIATE = /现在|马上|立刻|立即|正在|已经决定|已经准备|准备.{0,4}(?:行动|伤害)|危险物品|独处|一个人/iu;

function normalizeTurns(turns: string[]): string {
  return turns
    .map((turn) => turn.normalize("NFKC").replace(/\s+/gu, " ").trim())
    .join("。")
    .toLocaleLowerCase("zh-CN");
}

function maskNegatedImmediacy(text: string): string {
  return text
    .replace(/(?:并没有|没有|没).{0,10}(?:马上|立刻|立即|现在|正在|行动|计划|何时)/giu, "[NEGATED_IMMEDIACY]")
    .replace(/(?:没说|没有说).{0,8}(?:计划|何时|什么时候)/giu, "[NEGATED_IMMEDIACY]");
}

function matchRisk(text: string): RuleMatch {
  const immediacyText = maskNegatedImmediacy(text);

  if (/正在(?:追打|殴打|攻击)|被困|危险正在发生|正在发生.{0,8}(?:危险|暴力)|没在安全的地方|不在安全的地方/iu.test(text)) {
    return {
      level: "L3",
      primaryCategory: "active_danger",
      ruleId: "l3.active-danger.current",
    };
  }

  if (SELF_HARM.test(text)) {
    return IMMEDIATE.test(immediacyText)
      ? { level: "L3", primaryCategory: "self_harm", ruleId: "l3.self-harm.immediate" }
      : { level: "L2", primaryCategory: "self_harm", ruleId: "l2.self-harm.mention" };
  }

  if (HARM_TO_OTHERS.test(text)) {
    return IMMEDIATE.test(immediacyText)
      ? { level: "L3", primaryCategory: "harm_to_others", ruleId: "l3.harm-to-others.immediate" }
      : { level: "L2", primaryCategory: "harm_to_others", ruleId: "l2.harm-to-others.mention" };
  }

  if (/验证码|账号密码|转钱|隐私信息|个人信息|家庭住址|索要.{0,8}(?:密码|验证码|住址)|不转钱|勒索/iu.test(text)) {
    return {
      level: "L2",
      primaryCategory: "fraud_privacy",
      ruleId: "l2.fraud-privacy.solicitation",
    };
  }

  if (/(?:大人|成年人|陌生人|有人).{0,20}(?:保守秘密|不要告诉|不能告诉|单独见面|礼物)|逼.{0,8}(?:不愿意|不想做)|让我保守秘密/iu.test(text)) {
    return {
      level: "L2",
      primaryCategory: "abuse_exploitation",
      ruleId: "l2.abuse-exploitation.coercion",
    };
  }

  if (/辱骂|排斥|嘲笑|网络欺凌|总针对|威胁.{0,16}(?:照片|传播|公开)|编造.{0,8}(?:事情|谣言)/iu.test(text)) {
    return {
      level: "L2",
      primaryCategory: "bullying",
      ruleId: "l2.bullying.repeated-threat",
    };
  }

  if (/危险.{0,8}(?:挑战|动作|边缘)|网络挑战|模仿.{0,12}(?:视频|危险)|可能受伤.{0,8}(?:挑战|动作)|(?:想|准备|打算).{0,12}(?:爬|靠近).{0,8}不安全.{0,4}(?:位置|地方)/iu.test(text)) {
    return {
      level: "L2",
      primaryCategory: "dangerous_imitation",
      ruleId: "l2.dangerous-imitation.challenge",
    };
  }

  const persistent = /很多天|好多天|连续一段时间|这几周|这段时间|持续.{0,8}(?:很多天|一段时间|好一阵)|长期|每天|最近|一直|反复/iu.test(text);
  const distress = /难过|不开心|孤单|孤独|睡不|没精神|做不好|不想和|不够好|提不起兴趣|担心|很累|闷闷|不想出门|没有人愿意|没人愿意|落在.{0,6}(?:后面|队伍后)/iu.test(text);
  if (persistent && distress) {
    return {
      level: "L1",
      primaryCategory: "persistent_distress",
      ruleId: "l1.persistent-distress.duration",
    };
  }

  return {
    level: "L0",
    primaryCategory: "ordinary",
    ruleId: "default.ordinary",
  };
}

export function assessRiskWithRules(input: unknown): RiskRuleAssessmentResult {
  const request = riskRuleAssessmentRequestSchema.safeParse(input);
  if (!request.success) throw new RiskRuleEngineError("RISK_RULE_REQUEST_INVALID");

  const match = matchRisk(normalizeTurns(request.data.turns));
  return riskRuleAssessmentResultSchema.parse({
    source: "rules",
    level: match.level,
    primaryCategory: match.primaryCategory,
    matchedRuleIds: [match.ruleId],
    policyVersion: RISK_POLICY_VERSION,
    rulesVersion: RISK_RULES_VERSION,
  });
}
