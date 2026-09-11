import { randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import { reviewedContentRetrievalResultSchema } from "@xiaoban/contracts";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import { ReviewedContentRetrievalService } from "./reviewed-content-retrieval.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Reviewed content retrieval cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const fixedNow = new Date("2026-08-20T04:00:00.000Z");
const service = new ReviewedContentRetrievalService(database, () => fixedNow);

async function clearSyntheticContent(): Promise<void> {
  await database.deleteFrom("content_commands").execute();
  await database.deleteFrom("content_reviews").execute();
  await database.updateTable("content_items").set({
    lifecycle_status: "draft",
    active_version_id: null,
  }).execute();
  await database.deleteFrom("content_versions").execute();
  await database.deleteFrom("content_items").execute();
}

async function createContent(input: {
  slug: string;
  type?: "activity" | "knowledge";
  title: string;
  summary: string;
  ageBand?: "9_11" | "12_14" | "both";
  lifecycle?: "draft" | "published" | "disabled";
  reviewStatus?: "draft" | "approved" | "rejected";
  validFrom?: Date;
  expiresAt?: Date;
}): Promise<void> {
  const itemId = randomUUID();
  const versionId = randomUUID();
  const authorId = randomUUID();
  const type = input.type ?? "knowledge";
  const lifecycle = input.lifecycle ?? "published";
  const reviewStatus = input.reviewStatus ?? "approved";
  await database.insertInto("content_items").values({
    id: itemId,
    content_type: type,
    slug: input.slug,
    lifecycle_status: "draft",
    active_version_id: null,
    created_at: fixedNow,
    updated_at: fixedNow,
  }).execute();
  await database.insertInto("content_versions").values({
    id: versionId,
    item_id: itemId,
    version_number: 1,
    review_status: reviewStatus,
    title: input.title,
    summary: input.summary,
    content_body: JSON.stringify(type === "activity"
      ? {
          movement: "quiet",
          durationMinutes: 10,
          location: "indoor",
          materials: [],
          adultSupervision: "none",
          steps: ["离开屏幕看看远处"],
        }
      : {
          topic: "general_growth",
          paragraphs: ["短暂离开屏幕，也是一种休息。"],
        }),
    age_band: input.ageBand ?? "both",
    source_kind: "synthetic_test",
    source_label: "本地合成验证内容",
    source_url: "https://example.invalid/internal-only",
    valid_from: input.validFrom ?? new Date("2026-08-01T00:00:00.000Z"),
    expires_at: input.expiresAt ?? new Date("2027-08-20T00:00:00.000Z"),
    risk_tags: JSON.stringify(["general_information"]),
    author_id: authorId,
    created_at: fixedNow,
  }).execute();
  if (reviewStatus === "approved" || reviewStatus === "rejected") {
    await database.insertInto("content_reviews").values({
      id: randomUUID(),
      version_id: versionId,
      author_id: authorId,
      reviewer_id: randomUUID(),
      decision: reviewStatus,
      reason: "仅用于阶段4A.2.2合成检索验证。",
      created_at: fixedNow,
    }).execute();
  }
  if (lifecycle !== "draft") {
    await database.updateTable("content_items").set({
      lifecycle_status: lifecycle,
      active_version_id: versionId,
    }).where("id", "=", itemId).execute();
  }
}

beforeEach(clearSyntheticContent);

afterAll(async () => {
  await clearSyntheticContent();
  await database.destroy();
});

describe("phase 4A.2.2 reviewed content retrieval", () => {
  it("returns only matching current approved, valid, published, age-compatible content", async () => {
    await createContent({
      slug: "synthetic-title-match",
      title: "屏幕休息方法",
      summary: "短暂看看远处。",
      ageBand: "9_11",
    });
    await createContent({
      slug: "synthetic-summary-match",
      title: "看看远处",
      summary: "离开屏幕休息一下。",
      ageBand: "both",
    });
    await createContent({
      slug: "synthetic-zero-score",
      title: "观察天空",
      summary: "看看云朵形状。",
    });
    await createContent({
      slug: "synthetic-activity-match",
      type: "activity",
      title: "屏幕休息活动",
      summary: "离开屏幕做活动。",
    });
    await createContent({
      slug: "synthetic-older-age",
      title: "屏幕休息方法",
      summary: "适合较大年龄段。",
      ageBand: "12_14",
    });
    await createContent({
      slug: "synthetic-expired",
      title: "屏幕休息方法",
      summary: "已经过期。",
      expiresAt: new Date("2026-08-20T03:59:59.000Z"),
    });
    await createContent({
      slug: "synthetic-future",
      title: "屏幕休息方法",
      summary: "尚未生效。",
      validFrom: new Date("2026-08-20T04:00:01.000Z"),
    });
    await createContent({
      slug: "synthetic-disabled",
      title: "屏幕休息方法",
      summary: "已经停用。",
      lifecycle: "disabled",
    });
    await createContent({
      slug: "synthetic-rejected",
      title: "屏幕休息方法",
      summary: "审核驳回。",
      reviewStatus: "rejected",
    });
    await createContent({
      slug: "synthetic-draft",
      title: "屏幕休息方法",
      summary: "仍是草稿。",
      lifecycle: "draft",
      reviewStatus: "draft",
    });

    const input = {
      requestId: randomUUID(),
      safeInput: {
        decision: "allow" as const,
        policyVersion: "input-deidentification-2026-08-v1" as const,
        sanitizedText: "想找屏幕休息方法",
        redactedCategories: [],
      },
      ageBand: "9_11" as const,
      contentType: "knowledge" as const,
      limit: 3,
    };
    const first = reviewedContentRetrievalResultSchema.parse(
      await service.retrieve(input),
    );
    const second = reviewedContentRetrievalResultSchema.parse(
      await service.retrieve(input),
    );

    expect(first.items.map((item) => item.content.slug)).toEqual([
      "synthetic-title-match",
      "synthetic-summary-match",
    ]);
    expect(second.items).toEqual(first.items);
    expect(first.trace).toEqual({
      retrievalPolicyVersion: "reviewed-content-retrieval-v1",
      inputPolicyVersion: "input-deidentification-2026-08-v1",
      ageBand: "9_11",
      contentType: "knowledge",
    });
    expect(JSON.stringify(first)).not.toMatch(
      /authorId|reviewerId|sourceUrl|riskTags|versionId/u,
    );
  });

  it("returns an empty result when eligible content has no deterministic match", async () => {
    await createContent({
      slug: "synthetic-unrelated",
      title: "观察天空",
      summary: "看看云朵形状。",
    });

    const result = await service.retrieve({
      requestId: randomUUID(),
      safeInput: {
        decision: "allow",
        policyVersion: "input-deidentification-2026-08-v1",
        sanitizedText: "屏幕休息方法",
        redactedCategories: [],
      },
      ageBand: "9_11",
      contentType: "knowledge",
      limit: 3,
    });

    expect(result.items).toEqual([]);
  });
});
