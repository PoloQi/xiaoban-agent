import { randomBytes, randomUUID } from "node:crypto";

import type { InternalAiOrchestrationResult } from "@xiaoban/contracts";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import { hashSecret } from "../identity/service.js";
import { GenerationControlStore } from "../safety/generation-control-store.js";
import { DeepSeekGateway } from "./deepseek-gateway.js";
import { InternalAiOrchestrator } from "./internal-orchestrator.js";
import { DeepSeekConfigError, loadDeepSeekConfig } from "./model-config.js";
import { ReviewedContentRetrievalService } from "./reviewed-content-retrieval.js";

const SYNTHETIC_SLUG = "synthetic-stage4-closed-loop";
const fixedNow = new Date("2026-08-20T04:00:00.000Z");

class RollbackSyntheticSmoke extends Error {}

async function main(): Promise<void> {
  const databaseConfig = loadDatabaseConfig(process.env, "test");
  if (databaseConfig.database !== "xiaoban_test") {
    throw new Error("SMOKE_DATABASE_NOT_TEST");
  }
  const modelConfig = loadDeepSeekConfig(process.env);
  const database = createDatabase(databaseConfig);
  let result: InternalAiOrchestrationResult | undefined;

  try {
    try {
      await database.transaction().execute(async (transaction) => {
        const itemId = randomUUID();
        const versionId = randomUUID();
        const authorId = randomUUID();
        await transaction.insertInto("content_items").values({
          id: itemId,
          content_type: "knowledge",
          slug: SYNTHETIC_SLUG,
          lifecycle_status: "draft",
          active_version_id: null,
          created_at: fixedNow,
          updated_at: fixedNow,
        }).execute();
        await transaction.insertInto("content_versions").values({
          id: versionId,
          item_id: itemId,
          version_number: 1,
          review_status: "approved",
          title: "屏幕休息方法",
          summary: "短暂离开屏幕看看远处，让眼睛休息一下。",
          content_body: JSON.stringify({
            topic: "general_growth",
            paragraphs: ["看看远处，也是一种休息。"],
          }),
          age_band: "both",
          source_kind: "synthetic_test",
          source_label: "阶段4合成闭环验证",
          source_url: null,
          valid_from: new Date("2026-08-01T00:00:00.000Z"),
          expires_at: new Date("2027-08-20T00:00:00.000Z"),
          risk_tags: JSON.stringify(["general_information"]),
          author_id: authorId,
          created_at: fixedNow,
        }).execute();
        await transaction.insertInto("content_reviews").values({
          id: randomUUID(),
          version_id: versionId,
          author_id: authorId,
          reviewer_id: randomUUID(),
          decision: "approved",
          reason: "仅用于阶段4A.2.4真实合成闭环验证。",
          created_at: fixedNow,
        }).execute();
        await transaction.updateTable("content_items").set({
          lifecycle_status: "published",
          active_version_id: versionId,
        }).where("id", "=", itemId).execute();

        const officerToken = randomBytes(32).toString("base64url");
        await transaction.insertInto("safety_access_grants").values({
          id: randomUUID(),
          actor_id: randomUUID(),
          role: "duty_safety_officer",
          token_hash: hashSecret(officerToken),
          created_at: fixedNow,
          revoked_at: null,
        }).execute();
        const generationControl = new GenerationControlStore(transaction, () => fixedNow);
        await generationControl.change(officerToken, {
          requestId: randomUUID(),
          targetState: "running",
          reasonCode: "manual_resume",
          reasonNote: "虚构演练：阶段五真实模型冒烟临时恢复。",
        });

        const retrieval = new ReviewedContentRetrievalService(transaction, () => fixedNow);
        const gateway = new DeepSeekGateway(modelConfig);
        const orchestrator = new InternalAiOrchestrator({
          gate: () => generationControl.evaluateGate(),
          retrieve: (input) => retrieval.retrieve(input),
          generate: (input) => gateway.generate(input),
        });
        result = await orchestrator.run({
          requestId: randomUUID(),
          text: "虚构测试人物想找一个屏幕休息方法。",
          ageBand: "9_11",
          contentType: "knowledge",
        });
        throw new RollbackSyntheticSmoke();
      });
    } catch (error) {
      if (!(error instanceof RollbackSyntheticSmoke)) throw error;
    }

    if (result === undefined || result.trace.model === null) {
      throw new Error("LIVE_MODEL_VALIDATION_FAILED");
    }
    const residual = await database.selectFrom("content_items")
      .select("id")
      .where("slug", "=", SYNTHETIC_SLUG)
      .execute();
    if (residual.length !== 0) throw new Error("SYNTHETIC_FIXTURE_NOT_ROLLED_BACK");

    console.log(JSON.stringify({
      status: "ok",
      pipelineStatus: result.status,
      fallbackReason: result.status === "static_fallback" ? result.reasonCode : null,
      contentReferenceCount: result.contentSlugs.length,
      pipelineVersion: result.trace.pipelineVersion,
      inputPolicyVersion: result.trace.inputPolicyVersion,
      retrievalPolicyVersion: result.trace.retrievalPolicyVersion,
      outputPolicyVersion: result.trace.outputPolicyVersion,
      promptVersion: result.trace.promptVersion,
      provider: result.trace.model.provider,
      model: result.trace.model.model,
      durationMs: result.trace.model.durationMs,
      usage: result.trace.model.usage,
      syntheticFixtureRolledBack: true,
    }));
  } finally {
    await database.destroy();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof DeepSeekConfigError) {
    console.error(`Internal orchestration smoke configuration error: ${error.fields.join(", ")}`);
  } else if (error instanceof Error && [
    "SMOKE_DATABASE_NOT_TEST",
    "LIVE_MODEL_VALIDATION_FAILED",
    "SYNTHETIC_FIXTURE_NOT_ROLLED_BACK",
  ].includes(error.message)) {
    console.error(`Internal orchestration smoke failed safely: ${error.message}`);
  } else {
    console.error("Internal orchestration smoke failed safely: INTERNAL_ERROR");
  }
  process.exitCode = 1;
}
