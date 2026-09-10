import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
  childMoodCheckInResponseSchema,
  errorResponseSchema,
} from "@xiaoban/contracts";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import { EnrollmentService, hashSecret } from "../identity/service.js";
import { ChildMoodService } from "./child-mood-service.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Child mood cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const enrollmentService = new EnrollmentService(database);
const fixedNow = new Date("2026-09-01T04:00:00.000Z");
let currentNow = fixedNow;
const app = buildApp({ childMoodService: new ChildMoodService(database, () => currentNow) });

function sessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function authorization(value: string) {
  return { authorization: `Bearer ${value}` };
}

async function clearSyntheticData(): Promise<void> {
  await database.deleteFrom("child_mood_checkins").execute();
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
    display_name: "青禾情绪签到测试站（虚构）",
    status: "active",
    created_at: fixedNow,
  }).execute();
  await database.insertInto("pilot_invitations").values({
    id: randomUUID(),
    site_id: siteId,
    batch_name: "合成情绪签到测试批次",
    code_hash: hashSecret(invitationCode),
    status: "active",
    expires_at: new Date("2027-09-01T00:00:00.000Z"),
    created_at: fixedNow,
    updated_at: fixedNow,
  }).execute();
  const guardianToken = sessionToken();
  const childToken = sessionToken();
  await enrollmentService.confirmGuardian({
    requestId: randomUUID(), invitationCode, guardianAlias: "青禾阿姨",
    policyVersion: GUARDIAN_CONSENT_VERSION, consentAccepted: true,
    guardianSessionToken: guardianToken,
  });
  await enrollmentService.activateChild(guardianToken, {
    requestId: randomUUID(), childAlias: "小山雀", ageBand: "9_11",
    childNoticeVersion: CHILD_NOTICE_VERSION, noticeAccepted: true,
    childSessionToken: childToken,
  });
  return { childToken, guardianToken };
}

beforeAll(async () => app.ready());
beforeEach(async () => {
  currentNow = fixedNow;
  await clearSyntheticData();
});
afterAll(async () => {
  await clearSyntheticData();
  await app.close();
  await database.destroy();
});

describe("child mood check-in APIs", () => {
  it("stores one current-day mood, supports clearing, and repeats the same request", async () => {
    const { childToken } = await createChild();
    const initial = await app.inject({
      method: "GET", url: "/api/v1/child/mood-check-in", headers: authorization(childToken),
    });
    expect(childMoodCheckInResponseSchema.parse(initial.json())).toMatchObject({
      date: "2026-09-01", mood: null, updatedAt: null,
    });

    const requestId = randomUUID();
    for (const repeat of [false, true]) {
      const saved = await app.inject({
        method: "PUT", url: "/api/v1/child/mood-check-in",
        headers: authorization(childToken), payload: { requestId, mood: "bored" },
      });
      expect(saved.statusCode).toBe(200);
      expect(childMoodCheckInResponseSchema.parse(saved.json()).mood).toBe("bored");
      if (!repeat) continue;
    }

    const cleared = await app.inject({
      method: "PUT", url: "/api/v1/child/mood-check-in",
      headers: authorization(childToken), payload: { requestId: randomUUID(), mood: null },
    });
    expect(childMoodCheckInResponseSchema.parse(cleared.json()).mood).toBeNull();
  });

  it("rejects guardian access and a conflicting repeated request", async () => {
    const { childToken, guardianToken } = await createChild();
    const forbidden = await app.inject({
      method: "GET", url: "/api/v1/child/mood-check-in", headers: authorization(guardianToken),
    });
    expect(forbidden.statusCode).toBe(403);

    const requestId = randomUUID();
    await app.inject({
      method: "PUT", url: "/api/v1/child/mood-check-in",
      headers: authorization(childToken), payload: { requestId, mood: "happy" },
    });
    const conflict = await app.inject({
      method: "PUT", url: "/api/v1/child/mood-check-in",
      headers: authorization(childToken), payload: { requestId, mood: "sad" },
    });
    expect(conflict.statusCode).toBe(409);
    expect(errorResponseSchema.parse(conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");

    const invalid = await app.inject({
      method: "PUT", url: "/api/v1/child/mood-check-in",
      headers: authorization(childToken), payload: { requestId: randomUUID(), mood: "excited" },
    });
    expect(invalid.statusCode).toBe(400);
    expect(errorResponseSchema.parse(invalid.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("removes yesterday's value instead of exposing mood history", async () => {
    const { childToken } = await createChild();
    await app.inject({
      method: "PUT", url: "/api/v1/child/mood-check-in",
      headers: authorization(childToken), payload: { requestId: randomUUID(), mood: "worried" },
    });
    currentNow = new Date("2026-09-02T04:00:00.000Z");
    const nextDay = await app.inject({
      method: "GET", url: "/api/v1/child/mood-check-in", headers: authorization(childToken),
    });
    expect(childMoodCheckInResponseSchema.parse(nextDay.json())).toMatchObject({
      date: "2026-09-02", mood: null, updatedAt: null,
    });
    expect(await database.selectFrom("child_mood_checkins").select("child_id").execute()).toHaveLength(0);
  });
});
