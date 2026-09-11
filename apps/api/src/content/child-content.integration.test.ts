import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
  childContentDetailSchema,
  childContentListResponseSchema,
  errorResponseSchema,
} from "@xiaoban/contracts";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "../database/client.js";
import { EnrollmentService, hashSecret } from "../identity/service.js";
import { ChildContentService } from "./child-content-service.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Child content cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const enrollmentService = new EnrollmentService(database);
const childContentService = new ChildContentService(database);
const app = buildApp({
  childContentService,
  enrollmentService,
  probeDatabase: () => assertDatabaseBaseline(database),
});

function token(): string {
  return randomBytes(32).toString("base64url");
}

function authorization(value: string) {
  return { authorization: `Bearer ${value}` };
}

async function clearSyntheticData(): Promise<void> {
  await database.deleteFrom("content_commands").execute();
  await database.deleteFrom("content_reviews").execute();
  await database.updateTable("content_items").set({
    lifecycle_status: "draft",
    active_version_id: null,
  }).execute();
  await database.deleteFrom("content_versions").execute();
  await database.deleteFrom("content_items").execute();
  for (const table of [
    "audit_entries",
    "access_sessions",
    "guardian_child_links",
    "guardian_consents",
    "enrollments",
    "child_accounts",
    "guardian_accounts",
    "pilot_invitations",
    "sites",
  ] as const) {
    await database.deleteFrom(table).execute();
  }
}

async function createChild(ageBand: "9_11" | "12_14") {
  const invitationCode = `SYNTHETIC-${randomUUID()}`;
  const siteId = randomUUID();
  const now = new Date();
  await database.insertInto("sites").values({
    id: siteId,
    display_name: "青禾内容测试站（虚构）",
    status: "active",
    created_at: now,
  }).execute();
  await database.insertInto("pilot_invitations").values({
    id: randomUUID(),
    site_id: siteId,
    batch_name: "合成内容测试批次",
    code_hash: hashSecret(invitationCode),
    status: "active",
    expires_at: new Date("2027-08-18T00:00:00.000Z"),
    created_at: now,
    updated_at: now,
  }).execute();

  const guardianToken = token();
  const childToken = token();
  await enrollmentService.confirmGuardian({
    requestId: randomUUID(),
    invitationCode,
    guardianAlias: "青禾阿姨",
    policyVersion: GUARDIAN_CONSENT_VERSION,
    consentAccepted: true,
    guardianSessionToken: guardianToken,
  });
  await enrollmentService.activateChild(guardianToken, {
    requestId: randomUUID(),
    childAlias: "小山雀",
    ageBand,
    childNoticeVersion: CHILD_NOTICE_VERSION,
    noticeAccepted: true,
    childSessionToken: childToken,
  });
  const child = await database.selectFrom("child_accounts")
    .select("id")
    .executeTakeFirstOrThrow();
  return { childId: child.id, childToken, guardianToken };
}

async function createContent(input: {
  slug: string;
  type: "activity" | "knowledge";
  ageBand?: "9_11" | "12_14" | "both";
  lifecycle?: "draft" | "published" | "disabled";
  reviewStatus?: "draft" | "approved" | "rejected";
  validFrom?: Date;
  expiresAt?: Date;
}) {
  const itemId = randomUUID();
  const versionId = randomUUID();
  const authorId = randomUUID();
  const reviewerId = randomUUID();
  const now = new Date();
  const lifecycle = input.lifecycle ?? "published";
  const reviewStatus = input.reviewStatus ?? "approved";
  await database.insertInto("content_items").values({
    id: itemId,
    content_type: input.type,
    slug: input.slug,
    lifecycle_status: "draft",
    active_version_id: null,
    created_at: now,
    updated_at: now,
  }).execute();
  await database.insertInto("content_versions").values({
    id: versionId,
    item_id: itemId,
    version_number: 1,
    review_status: reviewStatus,
    title: input.type === "activity" ? "抬头找三种云" : "让眼睛看看远处",
    summary: input.type === "activity"
      ? "在安全位置观察天空并说出云朵形状。"
      : "短暂离开屏幕看看远处。",
    content_body: JSON.stringify(input.type === "activity"
      ? {
          movement: "quiet",
          durationMinutes: 10,
          location: "outdoor",
          materials: [],
          adultSupervision: "recommended",
          steps: ["先确认所在位置安全", "观察天空并描述三种形状"],
        }
      : {
          topic: "general_growth",
          paragraphs: ["看看远处，也是一种休息。"],
          quiz: {
            sceneId: "take-a-break",
            sceneLabel: "成长练习 · 01",
            scenario: "连续看完一个视频后，你还想继续刷下去，会怎么做？",
            options: [
              { id: "continue", text: "马上继续刷下一个视频" },
              { id: "pause", text: "先把屏幕放稳，看远处休息一下" },
              { id: "hide", text: "躲起来继续刷视频" },
            ],
            correctOptionId: "pause",
            correctTitle: "先停一下，是一个好选择。",
            incorrectTitle: "可以先给自己一个短暂停顿。",
            explanation: "短暂离开屏幕能让眼睛和注意力休息，再决定接下来做什么。",
            actionSteps: ["把设备放稳。", "看向远处并慢慢数二十秒。"],
          },
        }),
    age_band: input.ageBand ?? "both",
    source_kind: "synthetic_test",
    source_label: "本地合成验证内容",
    source_url: null,
    valid_from: input.validFrom ?? new Date("2026-08-01T00:00:00.000Z"),
    expires_at: input.expiresAt ?? new Date("2027-08-18T00:00:00.000Z"),
    risk_tags: JSON.stringify(["general_information"]),
    author_id: authorId,
    created_at: now,
  }).execute();
  if (reviewStatus === "approved" || reviewStatus === "rejected") {
    await database.insertInto("content_reviews").values({
      id: randomUUID(),
      version_id: versionId,
      author_id: authorId,
      reviewer_id: reviewerId,
      decision: reviewStatus,
      reason: "仅用于阶段3C合成筛选验证。",
      created_at: now,
    }).execute();
  }
  if (lifecycle !== "draft") {
    await database.updateTable("content_items").set({
      lifecycle_status: lifecycle,
      active_version_id: versionId,
    }).where("id", "=", itemId).execute();
  }
  return { slug: input.slug };
}

async function replacePublishedVersion(slug: string): Promise<void> {
  const current = await database
    .selectFrom("content_items as item")
    .innerJoin("content_versions as version", "version.id", "item.active_version_id")
    .select([
      "item.id as itemId",
      "version.content_body as contentBody",
      "version.age_band as ageBand",
      "version.source_kind as sourceKind",
      "version.source_label as sourceLabel",
      "version.source_url as sourceUrl",
      "version.valid_from as validFrom",
      "version.expires_at as expiresAt",
      "version.risk_tags as riskTags",
    ])
    .where("item.slug", "=", slug)
    .executeTakeFirstOrThrow();
  const versionId = randomUUID();
  const authorId = randomUUID();
  const now = new Date();
  await database.insertInto("content_versions").values({
    id: versionId,
    item_id: current.itemId,
    version_number: 2,
    review_status: "approved",
    title: "抬头找四种云",
    summary: "在安全位置观察天空并说出四种云朵形状。",
    content_body: typeof current.contentBody === "string"
      ? current.contentBody
      : JSON.stringify(current.contentBody),
    age_band: current.ageBand,
    source_kind: current.sourceKind,
    source_label: current.sourceLabel,
    source_url: current.sourceUrl,
    valid_from: current.validFrom,
    expires_at: current.expiresAt,
    risk_tags: typeof current.riskTags === "string"
      ? current.riskTags
      : JSON.stringify(current.riskTags),
    author_id: authorId,
    created_at: now,
  }).execute();
  await database.insertInto("content_reviews").values({
    id: randomUUID(),
    version_id: versionId,
    author_id: authorId,
    reviewer_id: randomUUID(),
    decision: "approved",
    reason: "仅用于阶段3D缓存失效验证。",
    created_at: now,
  }).execute();
  await database.updateTable("content_items").set({
    active_version_id: versionId,
    updated_at: now,
  }).where("id", "=", current.itemId).execute();
}

beforeAll(async () => {
  await app.ready();
});

beforeEach(clearSyntheticData);

afterAll(async () => {
  await clearSyntheticData();
  await app.close();
  await database.destroy();
});

describe("phase 3C/3D child content read APIs", () => {
  it("returns only current approved, valid, published, age-compatible content", async () => {
    const { childToken } = await createChild("9_11");
    const activity = await createContent({
      slug: "synthetic-cloud-walk",
      type: "activity",
      ageBand: "both",
    });
    const knowledge = await createContent({
      slug: "synthetic-screen-break",
      type: "knowledge",
      ageBand: "9_11",
    });
    await createContent({
      slug: "synthetic-older-child",
      type: "knowledge",
      ageBand: "12_14",
    });
    await createContent({
      slug: "synthetic-expired",
      type: "knowledge",
      validFrom: new Date("2025-08-18T00:00:00.000Z"),
      expiresAt: new Date("2026-01-18T00:00:00.000Z"),
    });
    await createContent({
      slug: "synthetic-future",
      type: "knowledge",
      validFrom: new Date("2027-01-18T00:00:00.000Z"),
    });
    await createContent({
      slug: "synthetic-disabled",
      type: "knowledge",
      lifecycle: "disabled",
    });
    await createContent({
      slug: "synthetic-unapproved",
      type: "knowledge",
      reviewStatus: "rejected",
    });

    const list = await app.inject({
      method: "GET",
      url: "/api/v1/child/content?type=all&limit=20&offset=0",
      headers: authorization(childToken),
    });
    expect(list.statusCode).toBe(200);
    const parsedList = childContentListResponseSchema.parse(list.json());
    expect(parsedList.pagination.total).toBe(2);
    expect(parsedList.items.map((item) => item.slug).sort()).toEqual([
      "synthetic-cloud-walk",
      "synthetic-screen-break",
    ]);
    expect(parsedList.catalogRevision).toMatch(/^[a-f0-9]{16}$/u);
    expect(parsedList.items.every((item) => /^[a-f0-9]{16}$/u.test(item.revision)))
      .toBe(true);
    expect(parsedList.items.find((item) => item.slug === knowledge.slug)).toMatchObject({
      type: "knowledge",
      hasQuiz: true,
    });
    expect(JSON.stringify(parsedList)).not.toMatch(/authorId|reviewerId|riskTags/u);

    const detail = await app.inject({
      method: "GET",
      url: `/api/v1/child/content/${activity.slug}`,
      headers: authorization(childToken),
    });
    expect(detail.statusCode).toBe(200);
    expect(childContentDetailSchema.parse(detail.json())).toMatchObject({
      type: "activity",
      slug: activity.slug,
      durationMinutes: 10,
      reviewLabel: "小伴内容审核组",
    });

    const knowledgeDetail = await app.inject({
      method: "GET",
      url: `/api/v1/child/content/${knowledge.slug}`,
      headers: authorization(childToken),
    });
    expect(childContentDetailSchema.parse(knowledgeDetail.json())).toMatchObject({
      type: "knowledge",
      slug: knowledge.slug,
      hasQuiz: true,
      quiz: { correctOptionId: "pause", actionSteps: ["把设备放稳。", "看向远处并慢慢数二十秒。"] },
    });

    const hiddenDetail = await app.inject({
      method: "GET",
      url: "/api/v1/child/content/synthetic-older-child",
      headers: authorization(childToken),
    });
    expect(hiddenDetail.statusCode).toBe(404);
    expect(errorResponseSchema.parse(hiddenDetail.json()).error.code).toBe(
      "CONTENT_NOT_FOUND",
    );
  });

  it("changes public item and catalog revisions when the approved version changes", async () => {
    const { childToken } = await createChild("9_11");
    await createContent({
      slug: "synthetic-cache-invalidation",
      type: "activity",
    });

    const firstResponse = await app.inject({
      method: "GET",
      url: "/api/v1/child/content?type=all&limit=20&offset=0",
      headers: authorization(childToken),
    });
    const first = childContentListResponseSchema.parse(firstResponse.json());
    await replacePublishedVersion("synthetic-cache-invalidation");

    const secondResponse = await app.inject({
      method: "GET",
      url: "/api/v1/child/content?type=all&limit=20&offset=0",
      headers: authorization(childToken),
    });
    const second = childContentListResponseSchema.parse(secondResponse.json());

    expect(first.items[0]?.revision).not.toBe(second.items[0]?.revision);
    expect(first.catalogRevision).not.toBe(second.catalogRevision);
    expect(second.items[0]?.title).toBe("抬头找四种云");
  });

  it("rejects invalid pagination, guardian access, and deactivated child access", async () => {
    const { childId, childToken, guardianToken } = await createChild("9_11");
    await createContent({ slug: "synthetic-safe-item", type: "knowledge" });

    const invalid = await app.inject({
      method: "GET",
      url: "/api/v1/child/content?limit=0",
      headers: authorization(childToken),
    });
    expect(invalid.statusCode).toBe(400);

    const guardian = await app.inject({
      method: "GET",
      url: "/api/v1/child/content",
      headers: authorization(guardianToken),
    });
    expect(guardian.statusCode).toBe(403);

    await database.updateTable("child_accounts").set({ status: "deactivated" })
      .where("id", "=", childId).execute();
    const deactivated = await app.inject({
      method: "GET",
      url: "/api/v1/child/content",
      headers: authorization(childToken),
    });
    expect(deactivated.statusCode).toBe(403);
    expect(errorResponseSchema.parse(deactivated.json()).error.code).toBe(
      "ACCOUNT_DEACTIVATED",
    );
  });
});
