import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import { internalAiOrchestrationResultSchema } from "@xiaoban/contracts";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import { hashSecret } from "../identity/service.js";
import { GenerationControlStore } from "../safety/generation-control-store.js";
import { InternalAiOrchestrator } from "./internal-orchestrator.js";
import { ReviewedContentRetrievalService } from "./reviewed-content-retrieval.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Internal orchestration integration is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const fixedNow = new Date("2026-08-20T04:00:00.000Z");

class RollbackSyntheticFixture extends Error {}

afterAll(async () => {
  await database.destroy();
});

describe("phase 4A.2.4 internal orchestration", () => {
  it("closes the MySQL retrieval-to-audit loop and rolls back synthetic data", async () => {
    const slug = `synthetic-orchestration-${randomUUID()}`;
    let result: unknown;

    try {
      await database.transaction().execute(async (transaction) => {
        const itemId = randomUUID();
        const versionId = randomUUID();
        const authorId = randomUUID();
        await transaction.insertInto("content_items").values({
          id: itemId,
          content_type: "knowledge",
          slug,
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
          summary: "短暂离开屏幕看看远处。",
          content_body: JSON.stringify({
            topic: "general_growth",
            paragraphs: ["看看远处，也是一种休息。"],
          }),
          age_band: "both",
          source_kind: "synthetic_test",
          source_label: "本地合成验证内容",
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
          reason: "仅用于阶段4A.2.4合成闭环验证。",
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
          reasonNote: "虚构演练：阶段五编排集成测试临时恢复。",
        });

        const retrievalService = new ReviewedContentRetrievalService(
          transaction,
          () => fixedNow,
        );
        const orchestrator = new InternalAiOrchestrator({
          gate: () => generationControl.evaluateGate(),
          retrieve: (input) => retrievalService.retrieve(input),
          generate: async (input) => ({
            status: "unreviewed",
            candidate: {
              intent: "knowledge_answer",
              reply: "可以短暂离开屏幕看看远处。",
              contentSlugs: [slug],
            },
            trace: {
              provider: "deepseek",
              model: "deepseek-v4-pro",
              promptVersion: input.promptVersion,
              outputSchemaVersion: "internal-ai-candidate-v1",
              durationMs: 1,
              usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
            },
          }),
        });
        result = await orchestrator.run({
          requestId: randomUUID(),
          text: "虚构人物想找屏幕休息方法。",
          ageBand: "9_11",
          contentType: "knowledge",
        });
        throw new RollbackSyntheticFixture();
      });
    } catch (error) {
      if (!(error instanceof RollbackSyntheticFixture)) throw error;
    }

    expect(internalAiOrchestrationResultSchema.parse(result)).toMatchObject({
      status: "approved",
      intent: "knowledge_answer",
      contentSlugs: [slug],
      trace: {
        pipelineVersion: "internal-ai-pipeline-v1",
        generationControl: { state: "running", source: "persisted" },
        retrievalPolicyVersion: "reviewed-content-retrieval-v1",
        outputPolicyVersion: "output-safety-2026-09-v3",
      },
    });
    const residual = await database.selectFrom("content_items")
      .select("id")
      .where("slug", "=", slug)
      .execute();
    expect(residual).toEqual([]);
  });
});
