import { randomUUID } from "node:crypto";

import { DeepSeekGateway, ModelGatewayError } from "./deepseek-gateway.js";
import { DeepSeekConfigError, loadDeepSeekConfig } from "./model-config.js";

async function main(): Promise<void> {
  const config = loadDeepSeekConfig(process.env);
  const result = await new DeepSeekGateway(config).generate({
    requestId: randomUUID(),
    promptVersion: "internal-probe-v1",
    systemPrompt: "你是内部技术验证助手。只处理合成情境，不提供诊断或紧急救援承诺。",
    userPrompt: "虚构人物小青想暂时离开屏幕，请给出一句简短回应；不要引用不存在的内容slug。",
  });
  console.log(JSON.stringify({
    status: "ok",
    structuredCandidateValidated: true,
    provider: result.trace.provider,
    model: result.trace.model,
    promptVersion: result.trace.promptVersion,
    outputSchemaVersion: result.trace.outputSchemaVersion,
    durationMs: result.trace.durationMs,
    usage: result.trace.usage,
  }));
}

try {
  await main();
} catch (error) {
  if (error instanceof DeepSeekConfigError) {
    console.error(`DeepSeek smoke test configuration error: ${error.fields.join(", ")}`);
  } else if (error instanceof ModelGatewayError) {
    console.error(`DeepSeek smoke test failed safely: ${error.code}`);
  } else {
    console.error("DeepSeek smoke test failed safely: INTERNAL_ERROR");
  }
  process.exitCode = 1;
}
