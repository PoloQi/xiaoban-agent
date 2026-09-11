import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
  childOnboardingResponseSchema,
  errorResponseSchema,
} from "@xiaoban/contracts";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import { EnrollmentService, hashSecret } from "../identity/service.js";
import { ChildOnboardingService } from "./child-onboarding-service.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Child onboarding cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const enrollmentService = new EnrollmentService(database);
const fixedNow = new Date("2026-08-31T12:00:00.000Z");
const app = buildApp({
  childOnboardingService: new ChildOnboardingService(database, () => fixedNow),
});

function token(): string {
  return randomBytes(32).toString("base64url");
}

function authorization(value: string) {
  return { authorization: `Bearer ${value}` };
}

async function clearSyntheticData(): Promise<void> {
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

async function createChild(ageBand: "9_11" | "12_14" = "9_11") {
  const invitationCode = `SYNTHETIC-${randomUUID()}`;
  const now = fixedNow;
  const siteId = randomUUID();
  await database.insertInto("sites").values({
    id: siteId,
    display_name: "青禾引导测试站（虚构）",
    status: "active",
    created_at: now,
  }).execute();
  await database.insertInto("pilot_invitations").values({
    id: randomUUID(),
    site_id: siteId,
    batch_name: "合成引导测试批次",
    code_hash: hashSecret(invitationCode),
    status: "active",
    expires_at: new Date("2027-08-31T00:00:00.000Z"),
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
  return { childToken, guardianToken };
}

beforeAll(async () => app.ready());
beforeEach(clearSyntheticData);

afterAll(async () => {
  await clearSyntheticData();
  await app.close();
  await database.destroy();
});

describe("child onboarding APIs", () => {
  it("starts empty and persists one complete three-step profile", async () => {
    const { childToken } = await createChild();
    const initial = await app.inject({
      method: "GET",
      url: "/api/v1/child/onboarding",
      headers: authorization(childToken),
    });
    expect(initial.statusCode).toBe(200);
    expect(childOnboardingResponseSchema.parse(initial.json())).toEqual({
      schemaVersion: "child-onboarding-2026-08-v1",
      status: "not_started",
      profile: null,
    });

    const requestId = randomUUID();
    const completion = await app.inject({
      method: "POST",
      url: "/api/v1/child/onboarding/completion",
      headers: authorization(childToken),
      payload: {
        requestId,
        grade: "grade_5",
        interests: ["drawing", "reading"],
        companion: "cloud",
      },
    });
    expect(completion.statusCode).toBe(201);
    expect(childOnboardingResponseSchema.parse(completion.json())).toMatchObject({
      status: "completed",
      profile: {
        alias: "小山雀",
        ageBand: "9_11",
        grade: "grade_5",
        interests: ["drawing", "reading"],
        companion: "cloud",
        completedAt: fixedNow.toISOString(),
      },
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/child/onboarding/completion",
      headers: authorization(childToken),
      payload: {
        requestId,
        grade: "grade_5",
        interests: ["drawing", "reading"],
        companion: "cloud",
      },
    });
    expect(replay.statusCode).toBe(201);
  });

  it("rejects an age-incompatible grade and saves a deliberate onboarding rerun", async () => {
    const { childToken } = await createChild("12_14");
    const invalidGrade = await app.inject({
      method: "POST",
      url: "/api/v1/child/onboarding/completion",
      headers: authorization(childToken),
      payload: {
        requestId: randomUUID(),
        grade: "grade_4",
        interests: ["sports"],
        companion: "kite",
      },
    });
    expect(invalidGrade.statusCode).toBe(400);

    const requestId = randomUUID();
    await app.inject({
      method: "POST",
      url: "/api/v1/child/onboarding/completion",
      headers: authorization(childToken),
      payload: {
        requestId,
        grade: "grade_7",
        interests: ["sports"],
        companion: "kite",
      },
    });
    const replacementRequestId = randomUUID();
    const replacement = await app.inject({
      method: "POST",
      url: "/api/v1/child/onboarding/completion",
      headers: authorization(childToken),
      payload: {
        requestId: replacementRequestId,
        grade: "grade_8",
        interests: ["reading"],
        companion: "sprout",
      },
    });
    expect(replacement.statusCode).toBe(201);
    expect(childOnboardingResponseSchema.parse(replacement.json())).toMatchObject({
      status: "completed",
      profile: {
        grade: "grade_8",
        interests: ["reading"],
        companion: "sprout",
      },
    });

    const replay = await app.inject({
      method: "POST",
      url: "/api/v1/child/onboarding/completion",
      headers: authorization(childToken),
      payload: {
        requestId: replacementRequestId,
        grade: "grade_8",
        interests: ["reading"],
        companion: "sprout",
      },
    });
    expect(replay.statusCode).toBe(201);

    const conflict = await app.inject({
      method: "POST",
      url: "/api/v1/child/onboarding/completion",
      headers: authorization(childToken),
      payload: {
        requestId: replacementRequestId,
        grade: "grade_7",
        interests: ["sports"],
        companion: "kite",
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(errorResponseSchema.parse(conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("rejects guardian access", async () => {
    const { guardianToken } = await createChild();
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/child/onboarding",
      headers: authorization(guardianToken),
    });
    expect(forbidden.statusCode).toBe(403);
    expect(errorResponseSchema.parse(forbidden.json()).error.code).toBe("FORBIDDEN");
  });
});

describe("child profile update API", () => {
  async function createCompletedChild(ageBand: "9_11" | "12_14" = "9_11") {
    const { childToken } = await createChild(ageBand);
    const completion = await app.inject({
      method: "POST",
      url: "/api/v1/child/onboarding/completion",
      headers: authorization(childToken),
      payload: {
        requestId: randomUUID(),
        grade: ageBand === "9_11" ? "grade_5" : "grade_7",
        interests: ["drawing"],
        companion: "sprout",
      },
    });
    expect(completion.statusCode).toBe(201);
    return { childToken };
  }

  it("updates all four fields and records updated_at", async () => {
    const { childToken } = await createCompletedChild();
    const requestId = randomUUID();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/child/profile",
      headers: authorization(childToken),
      payload: {
        requestId,
        alias: "小青禾",
        grade: "grade_6",
        interests: ["sports", "reading"],
        companion: "kite",
      },
    });
    expect(response.statusCode).toBe(200);
    const body = childOnboardingResponseSchema.parse(response.json());
    expect(body).toMatchObject({
      status: "completed",
      profile: {
        alias: "小青禾",
        ageBand: "9_11",
        grade: "grade_6",
        interests: ["sports", "reading"],
        companion: "kite",
      },
    });
    expect(body.profile?.updatedAt).toBe(fixedNow.toISOString());
  });

  it("updates only the grade without rewriting updated_at when alias is unchanged", async () => {
    const { childToken } = await createCompletedChild();
    // 第一次 PATCH 改 grade 并写入 updated_at
    const first = await app.inject({
      method: "PATCH",
      url: "/api/v1/child/profile",
      headers: authorization(childToken),
      payload: {
        requestId: randomUUID(),
        alias: "小山雀",
        grade: "grade_6",
        interests: ["drawing"],
        companion: "sprout",
      },
    });
    expect(first.statusCode).toBe(200);
    expect(childOnboardingResponseSchema.parse(first.json()).profile?.updatedAt)
      .toBe(fixedNow.toISOString());
  });

  it("rejects a profile update with an age-incompatible grade", async () => {
    const { childToken } = await createCompletedChild("9_11");
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/child/profile",
      headers: authorization(childToken),
      payload: {
        requestId: randomUUID(),
        alias: "小山雀",
        grade: "grade_8",
        interests: ["drawing"],
        companion: "sprout",
      },
    });
    expect(response.statusCode).toBe(400);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe("INVALID_REQUEST");
  });

  it("rejects a profile update that is a replay with a different body", async () => {
    const { childToken } = await createCompletedChild();
    const requestId = randomUUID();
    const first = await app.inject({
      method: "PATCH",
      url: "/api/v1/child/profile",
      headers: authorization(childToken),
      payload: {
        requestId,
        alias: "小山雀",
        grade: "grade_6",
        interests: ["drawing"],
        companion: "sprout",
      },
    });
    expect(first.statusCode).toBe(200);

    const conflict = await app.inject({
      method: "PATCH",
      url: "/api/v1/child/profile",
      headers: authorization(childToken),
      payload: {
        requestId,
        alias: "小山雀",
        grade: "grade_6",
        interests: ["sports"],
        companion: "sprout",
      },
    });
    expect(conflict.statusCode).toBe(409);
    expect(errorResponseSchema.parse(conflict.json()).error.code).toBe("IDEMPOTENCY_CONFLICT");
  });

  it("rejects a profile update from a guardian session", async () => {
    const { childToken, guardianToken } = await createChild();
    // childToken 必须先完成 onboarding 才能 PATCH
    await app.inject({
      method: "POST",
      url: "/api/v1/child/onboarding/completion",
      headers: authorization(childToken),
      payload: {
        requestId: randomUUID(),
        grade: "grade_5",
        interests: ["drawing"],
        companion: "sprout",
      },
    });
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/child/profile",
      headers: authorization(guardianToken),
      payload: {
        requestId: randomUUID(),
        alias: "小山雀",
        grade: "grade_5",
        interests: ["drawing"],
        companion: "sprout",
      },
    });
    expect(response.statusCode).toBe(403);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe("FORBIDDEN");
  });

  it("rejects a profile update before the child has completed onboarding", async () => {
    const { childToken } = await createChild();
    const response = await app.inject({
      method: "PATCH",
      url: "/api/v1/child/profile",
      headers: authorization(childToken),
      payload: {
        requestId: randomUUID(),
        alias: "小山雀",
        grade: "grade_5",
        interests: ["drawing"],
        companion: "sprout",
      },
    });
    expect(response.statusCode).toBe(404);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe("NOT_FOUND");
  });
});
