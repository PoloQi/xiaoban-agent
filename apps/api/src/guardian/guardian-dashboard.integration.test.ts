import { randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { errorResponseSchema, guardianDashboardResponseSchema } from "@xiaoban/contracts";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "../database/client.js";
import {
  LOCAL_TEST_ACCOUNT,
  LocalTestAccountService,
  seedLocalTestAccount,
} from "../identity/local-test-account.js";
import { GuardianDashboardService } from "./guardian-dashboard-service.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Guardian dashboard cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const fixedNow = new Date("2026-09-01T12:00:00.000Z");
const localAccount = new LocalTestAccountService(database);
const app = buildApp({
  guardianDashboardService: new GuardianDashboardService(database, {
    now: () => fixedNow,
    syntheticPreviewGuardianId: LOCAL_TEST_ACCOUNT.guardianId,
  }),
  probeDatabase: () => assertDatabaseBaseline(database),
});

function authorization(value: string) {
  return { authorization: `Bearer ${value}` };
}

async function clearSyntheticData(): Promise<void> {
  await database.deleteFrom("growth_attempts").execute();
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

beforeAll(async () => app.ready());
beforeEach(async () => {
  await clearSyntheticData();
  await seedLocalTestAccount(database);
});

afterAll(async () => {
  await clearSyntheticData();
  await app.close();
  await database.destroy();
});

describe("guardian dashboard API", () => {
  it("returns a verified read-only weekly aggregate and an explicit synthetic alert", async () => {
    await database.insertInto("growth_attempts").values([
      {
        id: randomUUID(), request_id: randomUUID(), request_hash: "a".repeat(64),
        child_id: LOCAL_TEST_ACCOUNT.childId, goal_key: "screen-free-bedtime-30m",
        source: "manual", activity_slug: null, local_date: "2026-09-01", created_at: fixedNow,
      },
      {
        id: randomUUID(), request_id: randomUUID(), request_hash: "b".repeat(64),
        child_id: LOCAL_TEST_ACCOUNT.childId, goal_key: "screen-free-bedtime-30m",
        source: "activity", activity_slug: "synthetic-tidy-space", target_minutes: 5,
        local_date: "2026-09-01", created_at: fixedNow,
      },
    ]).execute();
    const session = await localAccount.createGuardianSession();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/guardian/dashboard",
      headers: authorization(session.guardianSessionToken),
    });
    const dashboard = guardianDashboardResponseSchema.parse(response.json());

    expect(response.statusCode).toBe(200);
    expect(dashboard.stats).toEqual({
      realWorldActivities: 1,
      goalAttempts: 2,
      activeDays: 1,
      usageTracking: "not_collected",
    });
    expect(dashboard.alerts[0]).toMatchObject({
      source: "synthetic_preview",
      notificationStatus: "not_sent",
      acknowledgementStatus: "unavailable",
    });
    expect(JSON.stringify(dashboard)).not.toContain("conversation");

    const withoutPreview = await new GuardianDashboardService(database, { now: () => fixedNow })
      .get(session.guardianSessionToken);
    expect(withoutPreview.alerts).toEqual([]);
  });

  it("rejects a child role and a withdrawn guardian consent", async () => {
    const childSession = await localAccount.resumeSession();
    const forbidden = await app.inject({
      method: "GET",
      url: "/api/v1/guardian/dashboard",
      headers: authorization(childSession.childSessionToken),
    });
    expect(forbidden.statusCode).toBe(403);

    const guardianSession = await localAccount.createGuardianSession();
    await database.updateTable("guardian_consents")
      .set({ status: "withdrawn", withdrawn_at: fixedNow, withdraw_reason_code: "guardian_choice" })
      .where("id", "=", LOCAL_TEST_ACCOUNT.consentId)
      .execute();
    const withdrawn = await app.inject({
      method: "GET",
      url: "/api/v1/guardian/dashboard",
      headers: authorization(guardianSession.guardianSessionToken),
    });
    expect(withdrawn.statusCode).toBe(403);
    expect(errorResponseSchema.parse(withdrawn.json()).error.code).toBe("ACCOUNT_DEACTIVATED");
  });
});
