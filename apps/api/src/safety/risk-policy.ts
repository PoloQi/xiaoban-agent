import {
  RISK_POLICY_VERSION,
  riskDispositionRequestSchema,
  riskDispositionResultSchema,
  type RiskDispositionResult,
} from "@xiaoban/contracts";

export type RiskPolicyErrorCode = "RISK_DISPOSITION_INVALID";

export class RiskPolicyError extends Error {
  constructor(readonly code: RiskPolicyErrorCode) {
    super(code);
    this.name = "RiskPolicyError";
  }
}

const FIXED_SAFETY_ACTIONS: Readonly<Record<string, {
  title: string;
  steps: readonly [string, string, ...string[]];
}>> = {
  "L2:bullying": {
    title: "先确保自己安全",
    steps: [
      "离开让你不安全的聊天或现场，不要独自应对。",
      "保留必要证据，不要继续转发伤害性内容。",
      "马上告诉身边可信任成年人。",
    ],
  },
  "L2:abuse_exploitation": {
    title: "先去安全的地方",
    steps: [
      "去有其他可信任成年人在的安全地方。",
      "你不需要在这里继续描述让你难受的细节。",
      "马上把现在的情况告诉你信任的成年人。",
    ],
  },
  "L2:fraud_privacy": {
    title: "停止联系和发送",
    steps: [
      "不要再发送个人信息、照片、验证码或钱。",
      "停止与对方联系，并保留必要证据。",
      "马上告诉身边可信任成年人。",
    ],
  },
  "L2:dangerous_imitation": {
    title: "立即停止危险动作",
    steps: [
      "停止当前动作并远离危险物品或地点。",
      "去找身边可信任成年人，请对方陪着你。",
    ],
  },
  "L2:self_harm": {
    title: "现在先不要独处",
    steps: [
      "远离可能伤害自己的物品，去有其他人的地方。",
      "马上告诉身边可信任成年人你现在需要帮助。",
    ],
  },
  "L2:harm_to_others": {
    title: "先离开冲突现场",
    steps: [
      "远离可能伤害他人的物品和正在升级的冲突。",
      "马上找身边可信任成年人帮助处理。",
    ],
  },
  "L3:self_harm": {
    title: "立即去找身边成年人",
    steps: [
      "放下并远离可能伤害自己的物品，不要独处。",
      "走到可信任成年人身边，直接告诉对方你现在可能有危险。",
    ],
  },
  "L3:harm_to_others": {
    title: "立即远离危险和冲突",
    steps: [
      "放下并远离可能伤害他人的物品，离开冲突现场。",
      "马上找身边可信任成年人帮助处理。",
    ],
  },
  "L3:active_danger": {
    title: "立即去安全的地方",
    steps: [
      "尽快离开当前危险，去有其他人的安全位置。",
      "马上大声呼救或找身边可信任成年人。",
    ],
  },
};

export function getRiskDisposition(input: unknown): RiskDispositionResult {
  const request = riskDispositionRequestSchema.safeParse(input);
  if (!request.success) throw new RiskPolicyError("RISK_DISPOSITION_INVALID");
  const { level, primaryCategory } = request.data;

  if (level === "L0") {
    return riskDispositionResultSchema.parse({
      mode: "reviewed_ai",
      level,
      primaryCategory,
      requiresHuman: false,
      eventRequired: false,
      fixedReply: null,
      policyVersion: RISK_POLICY_VERSION,
    });
  }
  if (level === "L1") {
    return riskDispositionResultSchema.parse({
      mode: "support_and_offer_adult",
      level,
      primaryCategory,
      requiresHuman: false,
      eventRequired: false,
      fixedReply: null,
      policyVersion: RISK_POLICY_VERSION,
    });
  }

  const action = FIXED_SAFETY_ACTIONS[`${level}:${primaryCategory}`];
  if (action === undefined) throw new RiskPolicyError("RISK_DISPOSITION_INVALID");
  return riskDispositionResultSchema.parse({
    mode: "fixed_safety",
    level,
    primaryCategory,
    requiresHuman: true,
    eventRequired: true,
    notificationStatus: "not_sent",
    title: action.title,
    steps: action.steps,
    policyVersion: RISK_POLICY_VERSION,
  });
}
