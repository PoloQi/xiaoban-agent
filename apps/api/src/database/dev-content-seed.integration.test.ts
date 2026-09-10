import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "./client.js";
import {
  DEV_CONTENT_SEEDS,
  DevContentSeedConflictError,
  seedDevContent,
} from "./dev-content-seed.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Dev content seed cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const seedSlugs = DEV_CONTENT_SEEDS.map((seed) => seed.item.slug);

async function clearDevContentSeeds(): Promise<void> {
  const items = await database
    .selectFrom("content_items")
    .select("id")
    .where("slug", "in", seedSlugs)
    .execute();
  const itemIds = items.map((item) => item.id);
  if (itemIds.length === 0) {
    return;
  }

  const versions = await database
    .selectFrom("content_versions")
    .select("id")
    .where("item_id", "in", itemIds)
    .execute();
  const versionIds = versions.map((version) => version.id);
  if (versionIds.length > 0) {
    await database.deleteFrom("content_reviews").where("version_id", "in", versionIds).execute();
  }
  await database
    .updateTable("content_items")
    .set({ lifecycle_status: "draft", active_version_id: null })
    .where("id", "in", itemIds)
    .execute();
  await database.deleteFrom("content_versions").where("item_id", "in", itemIds).execute();
  await database.deleteFrom("content_items").where("id", "in", itemIds).execute();
}

beforeAll(async () => {
  await assertDatabaseBaseline(database);
});

beforeEach(clearDevContentSeeds);

afterAll(async () => {
  await clearDevContentSeeds();
  await database.destroy();
});

describe("dev content seed", () => {
  it("creates the approved published development records once and treats an exact replay as a no-op", async () => {
    await expect(seedDevContent(database)).resolves.toEqual({
      created: DEV_CONTENT_SEEDS.length,
      existing: 0,
    });
    for (const seed of DEV_CONTENT_SEEDS) {
      const version = await database
        .selectFrom("content_versions")
        .select("content_body")
        .where("id", "=", seed.version.id)
        .executeTakeFirstOrThrow();
      expect(version.content_body).toEqual(seed.version.body);
    }
    await expect(seedDevContent(database)).resolves.toEqual({
      created: 0,
      existing: DEV_CONTENT_SEEDS.length,
    });

    const rows = await database
      .selectFrom("content_items as item")
      .innerJoin("content_versions as version", "version.id", "item.active_version_id")
      .innerJoin("content_reviews as review", "review.version_id", "version.id")
      .select([
        "item.slug",
        "item.lifecycle_status as lifecycleStatus",
        "version.review_status as reviewStatus",
        "version.age_band as ageBand",
        "version.source_kind as sourceKind",
        "version.author_id as authorId",
        "review.reviewer_id as reviewerId",
      ])
      .where("item.slug", "in", seedSlugs)
      .orderBy("item.slug")
      .execute();

    expect(rows).toHaveLength(DEV_CONTENT_SEEDS.length);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ slug: "demo-five-minute-indoor-observation" }),
      expect.objectContaining({ slug: "demo-screen-break-guide" }),
      expect.objectContaining({ slug: "demo-feelings-and-friendship" }),
      expect.objectContaining({ slug: "demo-online-safety-basics" }),
      expect.objectContaining({ slug: "demo-body-boundaries" }),
    ]));
    for (const row of rows) {
      expect(row).toMatchObject({
        lifecycleStatus: "published",
        reviewStatus: "approved",
        ageBand: "both",
        sourceKind: "synthetic_test",
      });
      expect(row.authorId).not.toBe(row.reviewerId);
    }
  });

  it("accepts previous public seed labels without rewriting the existing record", async () => {
    await seedDevContent(database);
    const legacy = DEV_CONTENT_SEEDS[0];
    await database
      .updateTable("content_versions")
      .set({ source_label: "小伴竞赛合成内容" })
      .where("id", "=", legacy.version.id)
      .execute();
    await database
      .updateTable("content_reviews")
      .set({ reason: "项目内部审核的竞赛合成内容，仅供成人演示，不代表儿童试点专业审核。" })
      .where("id", "=", legacy.reviewId)
      .execute();

    await expect(seedDevContent(database)).resolves.toEqual({
      created: 0,
      existing: DEV_CONTENT_SEEDS.length,
    });
    const version = await database
      .selectFrom("content_versions")
      .select("source_label")
      .where("id", "=", legacy.version.id)
      .executeTakeFirstOrThrow();
    expect(version.source_label).toBe("小伴竞赛合成内容");
    const review = await database
      .selectFrom("content_reviews")
      .select("reason")
      .where("id", "=", legacy.reviewId)
      .executeTakeFirstOrThrow();
    expect(review.reason).toBe("项目内部审核的竞赛合成内容，仅供成人演示，不代表儿童试点专业审核。");
  });

  it("fails safely instead of overwriting a conflicting slug", async () => {
    const conflict = DEV_CONTENT_SEEDS[0];
    await database.insertInto("content_items").values({
      id: randomUUID(),
      content_type: conflict.item.contentType,
      slug: conflict.item.slug,
      lifecycle_status: "draft",
      active_version_id: null,
      created_at: new Date(),
      updated_at: new Date(),
    }).execute();

    await expect(seedDevContent(database)).rejects.toBeInstanceOf(
      DevContentSeedConflictError,
    );
    const count = await database
      .selectFrom("content_items")
      .select(({ fn }) => fn.countAll<number>().as("count"))
      .where("slug", "in", seedSlugs)
      .executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(1);
  });
});
