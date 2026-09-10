import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { contentItemResponseSchema } from "@xiaoban/contracts";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "../database/client.js";
import { hashSecret } from "../identity/service.js";
import { ContentService } from "./service.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Content workflow cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const service = new ContentService(database);
const app = buildApp({
  contentService: service,
  probeDatabase: () => assertDatabaseBaseline(database),
});

const authorId = randomUUID();
const reviewerId = randomUUID();
const authorToken = randomBytes(32).toString("base64url");
const reviewerToken = randomBytes(32).toString("base64url");
const selfReviewerToken = randomBytes(32).toString("base64url");

function authorization(token: string) {
  return { authorization: `Bearer ${token}` };
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    type: "knowledge",
    title: "看看远处",
    summary: "短暂离开屏幕看看远处。",
    ageBand: "both",
    source: { kind: "synthetic_test", label: "本地合成验证内容" },
    validFrom: "2026-08-18T00:00:00.000Z",
    expiresAt: "2027-08-18T00:00:00.000Z",
    riskTags: ["general_information"],
    body: {
      topic: "general_growth",
      paragraphs: ["看看远处，也是一种休息。"],
    },
    ...overrides,
  };
}

async function clearContentData() {
  await database.deleteFrom("content_commands").execute();
  await database.deleteFrom("content_reviews").execute();
  await database.updateTable("content_items").set({
    lifecycle_status: "draft",
    active_version_id: null,
  }).execute();
  await database.deleteFrom("content_versions").execute();
  await database.deleteFrom("content_items").execute();
  await database.deleteFrom("audit_entries").where("actor_type", "=", "content_operator").execute();
  await database.deleteFrom("access_sessions").where("role", "in", [
    "content_author",
    "content_reviewer",
  ]).execute();
}

async function resetContentData() {
  await clearContentData();
  const now = new Date();
  await database.insertInto("access_sessions").values([
    {
      id: randomUUID(),
      enrollment_id: null,
      role: "content_author",
      subject_id: authorId,
      child_id: null,
      token_hash: hashSecret(authorToken),
      created_at: now,
      revoked_at: null,
    },
    {
      id: randomUUID(),
      enrollment_id: null,
      role: "content_reviewer",
      subject_id: reviewerId,
      child_id: null,
      token_hash: hashSecret(reviewerToken),
      created_at: now,
      revoked_at: null,
    },
    {
      id: randomUUID(),
      enrollment_id: null,
      role: "content_reviewer",
      subject_id: authorId,
      child_id: null,
      token_hash: hashSecret(selfReviewerToken),
      created_at: now,
      revoked_at: null,
    },
  ]).execute();
}

beforeAll(async () => {
  await app.ready();
});

beforeEach(resetContentData);

afterAll(async () => {
  await clearContentData();
  await app.close();
  await database.destroy();
});

describe("phase 3B content workflow", () => {
  it("enforces roles, two-person review, lifecycle, rollback, audit, and idempotency", async () => {
    const requestId = randomUUID();
    const createPayload = {
      requestId,
      slug: "synthetic-screen-break",
      draft: draft(),
    };

    const forbiddenCreate = await app.inject({
      method: "POST",
      url: "/api/v1/internal/content/items",
      headers: authorization(reviewerToken),
      payload: createPayload,
    });
    expect(forbiddenCreate.statusCode).toBe(403);

    const created = await app.inject({
      method: "POST",
      url: "/api/v1/internal/content/items",
      headers: authorization(authorToken),
      payload: createPayload,
    });
    expect(created.statusCode).toBe(201);
    expect(contentItemResponseSchema.safeParse(created.json()).success).toBe(true);
    const itemId = created.json().itemId as string;
    const firstVersionId = created.json().versions[0].versionId as string;

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/internal/content/items",
      headers: authorization(authorToken),
      payload: createPayload,
    });
    expect(replay.statusCode).toBe(201);
    expect(replay.json()).toEqual(created.json());

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/internal/content/items",
      headers: authorization(authorToken),
      payload: { ...createPayload, slug: "different-synthetic-slug" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(conflict.json().error.code).toBe("IDEMPOTENCY_CONFLICT");

    const submitted = await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/versions/${firstVersionId}/submission`,
      headers: authorization(authorToken),
      payload: { requestId: randomUUID() },
    });
    expect(submitted.statusCode).toBe(200);
    expect(submitted.json().versions[0].reviewStatus).toBe("in_review");

    const selfReview = await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/versions/${firstVersionId}/review`,
      headers: authorization(selfReviewerToken),
      payload: {
        requestId: randomUUID(),
        decision: "approved",
        reason: "作者不能审核自己的版本。",
      },
    });
    expect(selfReview.statusCode).toBe(422);
    expect(selfReview.json().error.code).toBe("CONTENT_SELF_REVIEW");

    const reviewed = await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/versions/${firstVersionId}/review`,
      headers: authorization(reviewerToken),
      payload: {
        requestId: randomUUID(),
        decision: "approved",
        reason: "来源、年龄范围和有效期均已检查。",
      },
    });
    expect(reviewed.statusCode).toBe(200);
    expect(reviewed.json().versions[0].reviewStatus).toBe("approved");

    const published = await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/publication`,
      headers: authorization(reviewerToken),
      payload: { requestId: randomUUID(), versionId: firstVersionId },
    });
    expect(published.statusCode).toBe(200);
    expect(published.json().lifecycleStatus).toBe("published");

    const secondVersion = await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/versions`,
      headers: authorization(authorToken),
      payload: {
        requestId: randomUUID(),
        draft: draft({ title: "看看远处（第二版）" }),
      },
    });
    expect(secondVersion.statusCode).toBe(201);
    const secondVersionId = secondVersion.json().versions[1].versionId as string;

    for (const [url, token, payload] of [
      [
        `/api/v1/internal/content/items/${itemId}/versions/${secondVersionId}/submission`,
        authorToken,
        { requestId: randomUUID() },
      ],
      [
        `/api/v1/internal/content/items/${itemId}/versions/${secondVersionId}/review`,
        reviewerToken,
        {
          requestId: randomUUID(),
          decision: "approved",
          reason: "第二版来源和范围已检查。",
        },
      ],
      [
        `/api/v1/internal/content/items/${itemId}/publication`,
        reviewerToken,
        { requestId: randomUUID(), versionId: secondVersionId },
      ],
    ] as const) {
      const response = await app.inject({
        method: "POST",
        url,
        headers: authorization(token),
        payload,
      });
      expect(response.statusCode).toBe(200);
    }

    const rolledBack = await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/rollback`,
      headers: authorization(reviewerToken),
      payload: { requestId: randomUUID(), versionId: firstVersionId },
    });
    expect(rolledBack.statusCode).toBe(200);
    expect(rolledBack.json().activeVersionId).toBe(firstVersionId);

    const disabled = await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/disable`,
      headers: authorization(reviewerToken),
      payload: { requestId: randomUUID(), reason: "本地合成流程验证结束。" },
    });
    expect(disabled.statusCode).toBe(200);
    expect(disabled.json().lifecycleStatus).toBe("disabled");

    const audits = await database.selectFrom("audit_entries").select([
      "action",
      "metadata",
    ])
      .where("actor_type", "=", "content_operator").execute();
    expect(audits.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "content.item.created",
      "content.version.submitted",
      "content.version.reviewed",
      "content.item.published",
      "content.item.rolled_back",
      "content.item.disabled",
    ]));
    expect(JSON.stringify(audits.map((entry) => entry.metadata))).not.toContain(
      "看看远处，也是一种休息。",
    );
  });

  it("rejects publication before approval and after rejection", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/internal/content/items",
      headers: authorization(authorToken),
      payload: {
        requestId: randomUUID(),
        slug: "synthetic-rejected-content",
        draft: draft(),
      },
    });
    const itemId = created.json().itemId as string;
    const versionId = created.json().versions[0].versionId as string;

    const earlyPublish = await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/publication`,
      headers: authorization(reviewerToken),
      payload: { requestId: randomUUID(), versionId },
    });
    expect(earlyPublish.statusCode).toBe(409);

    await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/versions/${versionId}/submission`,
      headers: authorization(authorToken),
      payload: { requestId: randomUUID() },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/versions/${versionId}/review`,
      headers: authorization(reviewerToken),
      payload: {
        requestId: randomUUID(),
        decision: "rejected",
        reason: "来源说明不足，需要创建新版本。",
      },
    });

    const rejectedPublish = await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/publication`,
      headers: authorization(reviewerToken),
      payload: { requestId: randomUUID(), versionId },
    });
    expect(rejectedPublish.statusCode).toBe(409);
    expect(rejectedPublish.json().error.code).toBe("CONTENT_INVALID_STATE");
  });

  it("rejects publication of an expired approved version", async () => {
    const created = await app.inject({
      method: "POST",
      url: "/api/v1/internal/content/items",
      headers: authorization(authorToken),
      payload: {
        requestId: randomUUID(),
        slug: "synthetic-expired-content",
        draft: draft({
          validFrom: "2025-08-18T00:00:00.000Z",
          expiresAt: "2026-01-18T00:00:00.000Z",
        }),
      },
    });
    const itemId = created.json().itemId as string;
    const versionId = created.json().versions[0].versionId as string;

    await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/versions/${versionId}/submission`,
      headers: authorization(authorToken),
      payload: { requestId: randomUUID() },
    });
    await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/versions/${versionId}/review`,
      headers: authorization(reviewerToken),
      payload: {
        requestId: randomUUID(),
        decision: "approved",
        reason: "仅用于验证过期版本发布阻断。",
      },
    });

    const expiredPublish = await app.inject({
      method: "POST",
      url: `/api/v1/internal/content/items/${itemId}/publication`,
      headers: authorization(reviewerToken),
      payload: { requestId: randomUUID(), versionId },
    });
    expect(expiredPublish.statusCode).toBe(410);
    expect(expiredPublish.json().error.code).toBe("CONTENT_EXPIRED");
  });
});
