import {
  INPUT_DEIDENTIFICATION_POLICY_VERSION,
  internalAiInputRequestSchema,
  internalAiInputSafetyResultSchema,
  type InputBlockReason,
  type InputIdentifierCategory,
  type InternalAiInputSafetyResult,
} from "@xiaoban/contracts";

export type InputDeidentificationErrorCode = "INPUT_INVALID";

export class InputDeidentificationError extends Error {
  constructor(readonly code: InputDeidentificationErrorCode) {
    super(code);
    this.name = "InputDeidentificationError";
  }
}

const BLOCK_RULES: ReadonlyArray<{
  reason: InputBlockReason;
  pattern: RegExp;
}> = [
  {
    reason: "prompt_injection",
    pattern: /忽略.{0,12}(?:指令|提示词|规则)|(?:显示|透露|输出).{0,12}(?:系统提示词|开发者消息|隐藏指令)|(?:system|developer)\s+(?:prompt|message)/iu,
  },
  {
    reason: "secret",
    pattern: /\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|bearer|password)\b|(?:密钥|口令|密码|访问令牌)\s*(?:是|为|:|：|=)/iu,
  },
  {
    reason: "contact_person",
    pattern: /(?:联系人|监护人|爸爸|妈妈|老师).{0,8}(?:电话|手机号|微信号|qq号)|(?:微信号|qq号)\s*(?:是|为|:|：)/iu,
  },
  {
    reason: "school_name",
    pattern: /(?:学校全称|就读于|我的学校(?:是|叫)|学校叫)\s*[\p{L}\p{N}·]{2,30}|(?:实验|第一|第二|中心|外国语|民族|职业|师范|附属|育才|希望)[\p{L}\p{N}·]{0,16}(?:小学|中学|学校|学院)/iu,
  },
  {
    reason: "precise_address",
    pattern: /家庭住址|详细地址|门牌号|住在.{0,30}(?:省|自治区|市|区|县|镇|乡|村|街道|小区|社区|路|街|巷|弄|号)/iu,
  },
  {
    reason: "possible_name",
    pattern: /(?:我叫|我的名字(?:是|叫)|姓名(?:是|为|:|：)|真实姓名(?:是|为|:|：))\s*[\p{L}·]{2,20}/iu,
  },
];

const REDACTION_RULES: ReadonlyArray<{
  category: InputIdentifierCategory;
  pattern: RegExp;
  placeholder: string;
}> = [
  {
    category: "national_id_number",
    pattern: /(?<!\d)\d{6}(?:19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dX](?!\d)/giu,
    placeholder: "[ID_NUMBER]",
  },
  {
    category: "email_address",
    pattern: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}/giu,
    placeholder: "[EMAIL]",
  },
  {
    category: "phone_number",
    pattern: /(?<!\d)(?:\+?86[\s-]?)?1[3-9]\d(?:[\s-]?\d){8}(?!\d)/gu,
    placeholder: "[PHONE]",
  },
];

function normalizeText(text: string): string {
  return text.normalize("NFKC").replace(/\s+/gu, " ").trim();
}

export function deidentifyInternalAiInput(input: unknown): InternalAiInputSafetyResult {
  const request = internalAiInputRequestSchema.safeParse(input);
  if (!request.success) throw new InputDeidentificationError("INPUT_INVALID");

  const normalizedText = normalizeText(request.data.text);
  if (normalizedText.length === 0 || normalizedText.length > 2_000) {
    throw new InputDeidentificationError("INPUT_INVALID");
  }

  const reasonCodes = BLOCK_RULES
    .filter((rule) => rule.pattern.test(normalizedText))
    .map((rule) => rule.reason);
  if (reasonCodes.length > 0) {
    return internalAiInputSafetyResultSchema.parse({
      decision: "block",
      policyVersion: INPUT_DEIDENTIFICATION_POLICY_VERSION,
      reasonCodes,
    });
  }

  let sanitizedText = normalizedText;
  const redactedCategories: InputIdentifierCategory[] = [];
  for (const rule of REDACTION_RULES) {
    let matched = false;
    sanitizedText = sanitizedText.replace(rule.pattern, () => {
      matched = true;
      return rule.placeholder;
    });
    if (matched) redactedCategories.push(rule.category);
  }

  return internalAiInputSafetyResultSchema.parse({
    decision: "allow",
    policyVersion: INPUT_DEIDENTIFICATION_POLICY_VERSION,
    sanitizedText,
    redactedCategories,
  });
}
