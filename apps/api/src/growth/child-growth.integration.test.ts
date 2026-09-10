import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
  childGrowthPlanResponseSchema,
  errorResponseSchema,
} from "@xiaoban/contracts";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "../database/client.js";
import { EnrollmentService, hashSecret } from "../identity/service.js";
import { ChildGrowthService } from "./child-growth-service.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Child growth cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const enrollmentService = new EnrollmentService(database);
const fixedNow = new Date("2026-08-29T12:00:00.000Z");
const app = buildApp({
  childGrowthService: new ChildGrowthService(database, () => fixedNow),
  probeDatabase: () => assertDatabaseBaseline(database),
});

function token(): string {
  return randomBytes(32).toString("base64url");
}

function authorization(value: string) {
  return { authorization: `Bearer ${value}` };
}

async function clearSyntheticData(): Promise<void> {
  await database.deleteFrom("growth_attempts").execute();
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

async function createChild() {
  const invitationCode = `SYNTHETIC-${randomUUID()}`;
  const siteId = randomUUID();
  await database.insertInto("sites").values({
    id: siteId,
    display_name: "青禾成长计划测试站（虚构）",
    status: "active",
    created_at: fixedNow,
  }).execute();
  await database.insertInto("pilot_invitations").values({
    id: randomUUID(),
    site_id: siteId,
    batch_name: "合成成长计划测试批次",
    code_hash: hashSecret(invitationCode),
    status: "active",
    expires_at: new Date("2027-08-29T00:00:00.000Z"),
    created_at: fixedNow,
    updated_at: fixedNow,
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
    ageBand: "9_11",
    childNoticeVersion: CHILD_NOTICE_VERSION,
    noticeAccepted: true,
    childSessionToken: childToken,
  });
  return { childToken, guardianToken };
}

async function createPublishedActivity(slug: string): Promise<void> {
  const itemId = randomUUID();
  const versionId = randomUUID();
  const authorId = randomUUID();
  await database.insertInto("content_items").values({
    id: itemId,
    content_type: "activity",
    slug,
    lifecycle_status: "draft",
    active_version_id: null,
    created_at: fixedNow,
    updated_at: fixedNow,
  }).execute();
  await database.insertInto("content_versions").values({
    id: versionId,
    item_id: itemId,
    version_number: 1,
    review_status: "approved",
    title: "整理一小格",
    summary: "只整理桌面的一小格，完成就停。",
    content_body: JSON.stringify({
      durationMinutes: 10,
      location: "indoor",
      materials: [],
      adultSupervision: "none",
      steps: ["选一小格", "整理完成"],
    }),
    age_band: "both",
    source_kind: "synthetic_test",
    source_label: "本地合成验证内容",
    source_url: null,
    valid_from: new Date("2026-08-01T00:00:00.000Z"),
    expires_at: new Date("2027-08-29T00:00:00.000Z"),
    risk_tags: JSON.stringify(["general_information"]),
    author_id: authorId,
    created_at: fixedNow,
  }).execute();
  await database.insertInto("content_reviews").values({
    id: randomUUID(),
    version_id: versionId,
    author_id: authorId,
    reviewer_id: randomUUID(),
    decision: "approved",
    reason: "仅用于成长计划合成验证。",
    created_at: fixedNow,
  }).execute();
  await database.updateTable("content_items").set({
    lifecycle_status: "published",
    active_version_id: versionId,
  }).where("id", "=", itemId).execute();
}

beforeAll(async () => app.ready());
beforeEach(clearSyntheticData);

afterAll(async () => {
  await clearSyntheticData();
  await app.close();
  await database.destroy();
});

describe("child growth plan APIs", () => {
  it("returns an empty real week, records once per day, and keeps requests idempotent", async () => {
    const { childToken } = await createChild();
    const initial = await app.inject({
      method: "GET",
      url: "/api/v1/child/growth-plan",
      headers: authorization(childToken),
    });
    expect(initial.statusCode).toBe(200);
    expect(childGrowthPlanResponseSchema.parse(initial.json())).toMatchObject({
      week: { startDate: "2026-08-24", endDate: "2026-08-30" },
      goal: { attemptCount: 0, status: "not_started", todayRecorded: false },
      stats: { realWorldActivities: 0, goalAttempts: 0, activeDays: 0 },
    });

    const requestId = randomUUID();
    const first = await app.inject({
      method: "POST",
      url: "/api/v1/child/growth-attempts",
      headers: authorization(childToken),
      payload: { requestId, source: "manual" },
    });
    expect(first.statusCode).toBe(201);
    expect(childGrowthPlanResponseSchema.parse(first.json()).goal).toMatchObject({
      attemptCount: 1,
      status: "in_progress",
      todayRecorded: true,
    });

    for (const duplicateRequestId of [requestId, randomUUID()]) {
      const duplicate = await app.inject({
        method: "POST",
        url: "/api/v1/child/growth-attempts",
        headers: authorization(childToken),
        payload: { requestId: duplicateRequestId, source: "manual" },
      });
      expect(childGrowthPlanResponseSchema.parse(duplicate.json()).goal.attemptCount).toBe(1);
    }
  });

  it("counts a current approved activity and rejects an unknown activity", async () => {
    const { childToken } = await createChild();
    await createPublishedActivity("synthetic-tidy-space");
    const recorded = await app.inject({
      method: "POST",
      url: "/api/v1/child/growth-attempts",
      headers: authorization(childToken),
      payload: {
        requestId: randomUUID(),
        source: "activity",
        activitySlug: "synthetic-tidy-space",
        targetMinutes: 10,
        feeling: "lighter",
      },
    });
    const plan = childGrowthPlanResponseSchema.parse(recorded.json());
    expect(recorded.statusCode).toBe(201);
    expect(plan.stats).toMatchObject({ realWorldActivities: 1, goalAttempts: 1, activeDays: 1 });
    expect(plan.review.choices[0]?.kind).toBe("activity");
    await expect(database.selectFrom("growth_attempts")
      .select(["target_minutes as targetMinutes", "feeling"])
      .where("activity_slug", "=", "synthetic-tidy-space")
      .executeTakeFirstOrThrow()).resolves.toMatchObject({
      targetMinutes: 10,
      feeling: "lighter",
    });

    const missing = await app.inject({
      method: "POST",
      url: "/api/v1/child/growth-attempts",
      headers: authorization(childToken),
      payload: {
        requestId: randomUUID(),
        source: "activity",
        activitySlug: "missing-activity",
        targetMinutes: 5,
      },
    });
    expect(missing.statusCode).toBe(404);
    expect(errorResponseSchema.parse(missing.json()).error.code).toBe("CONTENT_NOT_FOUND");
  });

  it("rejects guardian access and conflicting idempotency payloads", async () => {
    const { childToken, guardianToken } = await createChild();
    await createPublishedActivity("synthetic-tidy-space");
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/child/growth-plan",
      headers: authorization(guardianToken),
    });
    expect(forbidden.statusCode).toBe(403);

    const requestId = randomUUID();
    await app.inject({
      method: "POST",
      url: "/api/v1/child/growth-attempts",
      headers: authorization(childToken),
      payload: { requestId, source: "manual" },
    });
    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/child/growth-attempts",
      headers: authorization(childToken),
      payload: { requestId, source: "activity", activitySlug: "synthetic-tidy-space", targetMinutes: 5 },
    });
    expect(conflict.statusCode).toBe(409);
    expect(errorResponseSchema.parse(conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });
});
