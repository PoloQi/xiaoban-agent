import { randomUUID } from "node:crypto";

import { afterAll, afterEach, describe, expect, it } from "vitest";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Content integration cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const itemIds: string[] = [];

async function createDraftItem(type: "activity" | "knowledge" = "knowledge") {
  const id = randomUUID();
  const now = new Date();
  itemIds.push(id);
  await database.insertInto("content_items").values({
    id,
    content_type: type,
    slug: `synthetic-${randomUUID()}`,
    lifecycle_status: "draft",
    active_version_id: null,
    created_at: now,
    updated_at: now,
  }).execute();
  return id;
}

async function createVersion(itemId: string, authorId: string) {
  const id = randomUUID();
  const now = new Date();
  await database.insertInto("content_versions").values({
    id,
    item_id: itemId,
    version_number: 1,
    review_status: "in_review",
    title: "合成知识条目",
    summary: "只用于测试内容审核约束。",
    content_body: JSON.stringify({
      topic: "general_growth",
      paragraphs: ["这是一条虚构测试内容。"],
    }),
    age_band: "both",
    source_kind: "synthetic_test",
    source_label: "本地合成验证内容",
    source_url: null,
    valid_from: now,
    expires_at: new Date(now.getTime() + 86_400_000),
    risk_tags: JSON.stringify(["general_information"]),
    author_id: authorId,
    created_at: now,
  }).execute();
  return id;
}

afterEach(async () => {
  if (itemIds.length === 0) return;
  await database.updateTable("content_items").set({
    lifecycle_status: "draft",
    active_version_id: null,
  }).where("id", "in", itemIds).execute();
  await database.deleteFrom("content_reviews").execute();
  await database.deleteFrom("content_versions").where("item_id", "in", itemIds).execute();
  await database.deleteFrom("content_items").where("id", "in", itemIds).execute();
  itemIds.length = 0;
});

afterAll(async () => {
  await database.destroy();
});

describe("phase 3A content schema", () => {
  it("stores a review only when the reviewer differs from the author", async () => {
    const authorId = randomUUID();
    const itemId = await createDraftItem();
    const versionId = await createVersion(itemId, authorId);

    await expect(
      database.insertInto("content_reviews").values({
        id: randomUUID(),
        version_id: versionId,
        author_id: authorId,
        reviewer_id: authorId,
        decision: "approved",
        reason: "不应允许作者审核自己的内容。",
        created_at: new Date(),
      }).execute(),
    ).rejects.toBeDefined();

    await database.insertInto("content_reviews").values({
      id: randomUUID(),
      version_id: versionId,
      author_id: authorId,
      reviewer_id: randomUUID(),
      decision: "approved",
      reason: "已检查来源、年龄范围和有效期。",
      created_at: new Date(),
    }).execute();

    const reviews = await database.selectFrom("content_reviews").select("decision").execute();
    expect(reviews).toEqual([{ decision: "approved" }]);
  });

  it("prevents an item from publishing another item's version", async () => {
    const firstItemId = await createDraftItem();
    const secondItemId = await createDraftItem();
    const secondVersionId = await createVersion(secondItemId, randomUUID());

    await expect(
      database.updateTable("content_items").set({
        lifecycle_status: "published",
        active_version_id: secondVersionId,
      }).where("id", "=", firstItemId).execute(),
    ).rejects.toBeDefined();
  });
});
