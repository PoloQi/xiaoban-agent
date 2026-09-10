import { z } from "zod";

type ConfigSource = Readonly<Record<string, string | undefined>>;

const deepSeekConfigSchema = z.object({
  apiKey: z.string().min(20).max(256).regex(/^sk-[A-Za-z0-9_-]+$/u),
  baseUrl: z.literal("https://api.deepseek.com"),
  model: z.literal("deepseek-v4-pro"),
  timeoutMs: z.coerce.number().int().min(1_000).max(12_000),
  maxOutputTokens: z.coerce.number().int().min(64).max(2_000),
}).strict();

export interface DeepSeekConfig {
  apiKey: string;
  baseUrl: "https://api.deepseek.com";
  model: "deepseek-v4-pro";
  timeoutMs: number;
  maxOutputTokens: number;
}

export class DeepSeekConfigError extends Error {
  readonly fields: readonly string[];

  constructor(fields: readonly string[]) {
    super(`Invalid DeepSeek configuration fields: ${fields.join(", ")}`);
    this.name = "DeepSeekConfigError";
    this.fields = fields;
  }
}

export function loadDeepSeekConfig(source: ConfigSource): DeepSeekConfig {
  const result = deepSeekConfigSchema.safeParse({
    apiKey: source.DEEPSEEK_API_KEY,
    baseUrl: source.DEEPSEEK_BASE_URL ?? "https://api.deepseek.com",
    model: source.DEEPSEEK_MODEL ?? "deepseek-v4-pro",
    timeoutMs: source.DEEPSEEK_TIMEOUT_MS ?? "12000",
    maxOutputTokens: source.DEEPSEEK_MAX_OUTPUT_TOKENS ?? "800",
  });
  if (!result.success) {
    const fieldMap: Record<string, string> = {
      apiKey: "DEEPSEEK_API_KEY",
      baseUrl: "DEEPSEEK_BASE_URL",
      model: "DEEPSEEK_MODEL",
      timeoutMs: "DEEPSEEK_TIMEOUT_MS",
      maxOutputTokens: "DEEPSEEK_MAX_OUTPUT_TOKENS",
    };
    const fields = [
      ...new Set(result.error.issues.map((issue) =>
        typeof issue.path[0] === "string"
          ? (fieldMap[issue.path[0]] ?? "DEEPSEEK_CONFIGURATION")
          : "DEEPSEEK_CONFIGURATION")),
    ].sort();
    throw new DeepSeekConfigError(fields);
  }
  return result.data;
}
