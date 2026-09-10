import { randomUUID } from "node:crypto";

import { DeepSeekConfigError, loadDeepSeekConfig } from "../ai/model-config.js";
import {
  DeepSeekRiskClassifier,
  RiskModelGatewayError,
} from "./deepseek-risk-classifier.js";
import { fuseRiskAssessments } from "./risk-fusion.js";
import { assessRiskWithRules } from "./risk-rule-engine.js";

async function main(): Promise<void> {
  const request = {
    requestId: randomUUID(),
    synthetic: true as const,
    ageBand: "12_14" as const,
    turns: ["虚构测试：我现在可能会伤害自己，需要马上有人过来。"],
  };
  const rule = assessRiskWithRules(request);
  const model = await new DeepSeekRiskClassifier(
    loadDeepSeekConfig(process.env),
  ).classify(request);
  const fused = fuseRiskAssessments(rule, { status: "ok", result: model });

  console.log(JSON.stringify({
    status: "ok",
    synthetic: true,
    rule: { level: rule.level, primaryCategory: rule.primaryCategory },
    model: { level: model.level, primaryCategory: model.primaryCategory },
    fused: {
      decision: fused.decision,
      level: fused.level,
      primaryCategory: fused.primaryCategory,
      route: fused.route,
      selectedSource: fused.selectedSource,
      disagreement: fused.disagreement,
      modelStatus: fused.modelStatus,
    },
    versions: fused.versions,
    trace: {
      provider: model.trace.provider,
      model: model.trace.model,
      durationMs: model.trace.durationMs,
      usage: model.trace.usage,
    },
  }));
}

try {
  await main();
} catch (error) {
  if (error instanceof DeepSeekConfigError) {
    console.error(`Risk classifier smoke configuration error: ${error.fields.join(", ")}`);
  } else if (error instanceof RiskModelGatewayError) {
    console.error(`Risk classifier smoke failed safely: ${error.code}`);
  } else {
    console.error("Risk classifier smoke failed safely: INTERNAL_ERROR");
  }
  process.exitCode = 1;
}
