import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { sql } from "kysely";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
  childActivationResponseSchema,
  childModeResponseSchema,
  consentWithdrawalResponseSchema,
  errorResponseSchema,
  guardianConfirmationResponseSchema,
  guardianEnrollmentResponseSchema,
  invitationPreviewResponseSchema,
} from "@xiaoban/contracts";
import { localTestAccountSessionResponseSchema } from "@xiaoban/contracts/local-test-account";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "../database/client.js";
import { EnrollmentService, hashSecret } from "./service.js";
import {
  LocalTestAccountService,
  seedLocalTestAccount,
} from "./local-test-account.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Integration cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const service = new EnrollmentService(database);
const app = buildApp({
  enrollmentService: service,
  localTestAccountService: new LocalTestAccountService(database),
  probeDatabase: () => assertDatabaseBaseline(database),
});

function token(): string {
  return randomBytes(32).toString("base64url");
}

async function resetSyntheticData(): Promise<void> {
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

async function createInvitation(expiresAt = new Date("2027-08-17T00:00:00.000Z")) {
  const invitationCode = `SYNTHETIC-${randomUUID()}`;
  const siteId = randomUUID();
  const now = new Date();
  await database.insertInto("sites").values({
    id: siteId,
    display_name: "青禾测试站（虚构）",
    status: "active",
    created_at: now,
  }).execute();
  await database.insertInto("pilot_invitations").values({
    id: randomUUID(),
    site_id: siteId,
    batch_name: "合成测试批次",
    code_hash: hashSecret(invitationCode),
    status: "active",
    expires_at: expiresAt,
    created_at: now,
    updated_at: now,
  }).execute();
  return invitationCode;
}

beforeAll(async () => {
  await app.ready();
});

beforeEach(async () => {
  await resetSyntheticData();
});

afterAll(async () => {
  await app.close();
  await database.destroy();
});

describe("phase 2 invitation, consent, roles, and withdrawal", () => {
  it("rejects unknown and expired invitations", async () => {
    const unknown = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/preview",
      payload: { invitationCode: "UNKNOWN-SYNTHETIC" },
    });
    expect(unknown.statusCode).toBe(404);
    expect(errorResponseSchema.parse(unknown.json()).error.code).toBe("INVITATION_INVALID");

    const expiredCode = await createInvitation(new Date("2026-01-01T00:00:00.000Z"));
    const expired = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/preview",
      payload: { invitationCode: expiredCode },
    });
    expect(expired.statusCode).toBe(410);
    expect(errorResponseSchema.parse(expired.json()).error.code).toBe("INVITATION_EXPIRED");
  });

  it("requires explicit guardian and child confirmations", async () => {
    const invitationCode = await createInvitation();
    const guardian = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/guardian-confirmation",
      payload: {
        requestId: randomUUID(),
        invitationCode,
        guardianAlias: "青禾阿姨",
        policyVersion: GUARDIAN_CONSENT_VERSION,
        consentAccepted: false,
        guardianSessionToken: token(),
      },
    });
    expect(guardian.statusCode).toBe(422);
    expect(errorResponseSchema.parse(guardian.json()).error.code).toBe("CONSENT_REQUIRED");
  });

  it("completes the synthetic enrollment, enforces roles, and deactivates on withdrawal", async () => {
    const invitationCode = await createInvitation();
    const guardianToken = token();
    const childToken = token();
    const guardianRequestId = randomUUID();
    const childRequestId = randomUUID();
    const withdrawalRequestId = randomUUID();

    const preview = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/preview",
      payload: { invitationCode },
    });
    expect(preview.statusCode).toBe(200);
    expect(invitationPreviewResponseSchema.safeParse(preview.json()).success).toBe(true);

    const guardianPayload = {
      requestId: guardianRequestId,
      invitationCode,
      guardianAlias: "青禾阿姨",
      policyVersion: GUARDIAN_CONSENT_VERSION,
      consentAccepted: true,
      guardianSessionToken: guardianToken,
    };
    const guardian = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/guardian-confirmation",
      payload: guardianPayload,
    });
    expect(guardian.statusCode).toBe(201);
    expect(guardianConfirmationResponseSchema.safeParse(guardian.json()).success).toBe(true);

    const guardianReplay = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/guardian-confirmation",
      payload: guardianPayload,
    });
    expect(guardianReplay.statusCode).toBe(201);
    expect(guardianReplay.json()).toEqual(guardian.json());

    const childPayload = {
      requestId: childRequestId,
      childAlias: "小山雀",
      ageBand: "9_11",
      childNoticeVersion: CHILD_NOTICE_VERSION,
      noticeAccepted: true,
      childSessionToken: childToken,
    };
    const child = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/child-activation",
      headers: { authorization: `Bearer ${guardianToken}` },
      payload: childPayload,
    });
    expect(child.statusCode).toBe(201);
    expect(childActivationResponseSchema.safeParse(child.json()).success).toBe(true);
    expect(child.json().child.minorMode).toBe(true);

    const childReplay = await app.inject({
      method: "POST",
      url: "/api/v1/enrollments/child-activation",
      headers: { authorization: `Bearer ${guardianToken}` },
      payload: childPayload,
    });
    expect(childReplay.statusCode).toBe(201);
    expect(childReplay.json()).toEqual(child.json());

    const guardianView = await app.inject({
      method: "GET",
      url: "/api/v1/guardian/enrollment",
      headers: { authorization: `Bearer ${guardianToken}` },
    });
    expect(guardianView.statusCode).toBe(200);
    expect(guardianEnrollmentResponseSchema.safeParse(guardianView.json()).success).toBe(true);
    expect(guardianView.json().child).toMatchObject({
      alias: "小山雀",
      minorMode: true,
      status: "active",
    });

    const childMode = await app.inject({
      method: "GET",
      url: "/api/v1/child/mode",
      headers: { authorization: `Bearer ${childToken}` },
    });
    expect(childMode.statusCode).toBe(200);
    expect(childModeResponseSchema.safeParse(childMode.json()).success).toBe(true);

    const childCannotWithdraw = await app.inject({
      method: "POST",
      url: "/api/v1/guardian/consent/withdrawal",
      headers: { authorization: `Bearer ${childToken}` },
      payload: {
        requestId: randomUUID(),
        reasonCode: "guardian_choice",
        confirmed: true,
      },
    });
    expect(childCannotWithdraw.statusCode).toBe(403);
    expect(errorResponseSchema.parse(childCannotWithdraw.json()).error.code).toBe("FORBIDDEN");

    const guardianCannotUseChildMode = await app.inject({
      method: "GET",
      url: "/api/v1/child/mode",
      headers: { authorization: `Bearer ${guardianToken}` },
    });
    expect(guardianCannotUseChildMode.statusCode).toBe(403);
    expect(errorResponseSchema.parse(guardianCannotUseChildMode.json()).error.code).toBe("FORBIDDEN");

    const withdrawalPayload = {
      requestId: withdrawalRequestId,
      reasonCode: "guardian_choice",
      confirmed: true,
    };
    const withdrawal = await app.inject({
      method: "POST",
      url: "/api/v1/guardian/consent/withdrawal",
      headers: { authorization: `Bearer ${guardianToken}` },
      payload: withdrawalPayload,
    });
    expect(withdrawal.statusCode).toBe(200);
    expect(consentWithdrawalResponseSchema.safeParse(withdrawal.json()).success).toBe(true);

    const withdrawalReplay = await app.inject({
      method: "POST",
      url: "/api/v1/guardian/consent/withdrawal",
      headers: { authorization: `Bearer ${guardianToken}` },
      payload: withdrawalPayload,
    });
    expect(withdrawalReplay.statusCode).toBe(200);
    expect(withdrawalReplay.json()).toEqual(withdrawal.json());

    const deactivatedChild = await app.inject({
      method: "GET",
      url: "/api/v1/child/mode",
      headers: { authorization: `Bearer ${childToken}` },
    });
    expect(deactivatedChild.statusCode).toBe(403);
    expect(errorResponseSchema.parse(deactivatedChild.json()).error.code).toBe(
      "ACCOUNT_DEACTIVATED",
    );

    const consent = await database
      .selectFrom("guardian_consents")
      .select(["policy_version", "status", "withdraw_request_id"])
      .executeTakeFirstOrThrow();
    expect(consent).toEqual({
      policy_version: GUARDIAN_CONSENT_VERSION,
      status: "withdrawn",
      withdraw_request_id: withdrawalRequestId,
    });
    const auditActions = await database
      .selectFrom("audit_entries")
      .select("action")
      .orderBy("created_at")
      .execute();
    expect(auditActions.map((entry) => entry.action)).toHaveLength(4);
    expect(auditActions.map((entry) => entry.action)).toEqual(expect.arrayContaining([
      "guardian_consent.granted",
      "child_account.activated",
      "guardian_consent.withdrawn",
      "child_account.deactivated",
    ]));
  });

  it("allows only one concurrent confirmation for an invitation", async () => {
    const invitationCode = await createInvitation();
    const responses = await Promise.all([
      app.inject({
        method: "POST",
        url: "/api/v1/enrollments/guardian-confirmation",
        payload: {
          requestId: randomUUID(),
          invitationCode,
          guardianAlias: "甲方监护人",
          policyVersion: GUARDIAN_CONSENT_VERSION,
          consentAccepted: true,
          guardianSessionToken: token(),
        },
      }),
      app.inject({
        method: "POST",
        url: "/api/v1/enrollments/guardian-confirmation",
        payload: {
          requestId: randomUUID(),
          invitationCode,
          guardianAlias: "乙方监护人",
          policyVersion: GUARDIAN_CONSENT_VERSION,
          consentAccepted: true,
          guardianSessionToken: token(),
        },
      }),
    ]);

    expect(responses.map((response) => response.statusCode).sort()).toEqual([201, 410]);
    const count = await database
      .selectFrom("enrollments")
      .select(sql<number>`COUNT(*)`.as("count"))
      .executeTakeFirstOrThrow();
    expect(Number(count.count)).toBe(1);
  });

  it("does not create prohibited identity fields", async () => {
    const columns = await sql<{ columnName: string }>`
      SELECT column_name AS columnName
      FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name IN ('guardian_accounts', 'child_accounts')
    `.execute(database);
    const names = columns.rows.map((column) => column.columnName.toLowerCase());

    expect(names).not.toContain("real_name");
    expect(names).not.toContain("phone");
    expect(names).not.toContain("id_card");
    expect(names).not.toContain("face_image");
  });

  it("issues a fresh child session for the reusable local test account", async () => {
    expect(await seedLocalTestAccount(database)).toBe("created");
    expect(await seedLocalTestAccount(database)).toBe("existing");

    const first = await app.inject({
      method: "POST",
      url: "/api/v1/dev/test-account/session",
      payload: { alias: "小树", ageBand: "9_11" },
    });
    expect(first.statusCode).toBe(201);
    const firstSession = localTestAccountSessionResponseSchema.parse(first.json());

    const firstMode = await app.inject({
      method: "GET",
      url: "/api/v1/child/mode",
      headers: { authorization: `Bearer ${firstSession.childSessionToken}` },
    });
    expect(firstMode.statusCode).toBe(200);
    expect(childModeResponseSchema.parse(firstMode.json()).child.alias).toBe("小树");

    const second = await app.inject({
      method: "POST",
      url: "/api/v1/dev/test-account/session",
      payload: { alias: "小山雀", ageBand: "12_14" },
    });
    const secondSession = localTestAccountSessionResponseSchema.parse(second.json());
    expect(secondSession.childSessionToken).not.toBe(firstSession.childSessionToken);

    const secondMode = await app.inject({
      method: "GET",
      url: "/api/v1/child/mode",
      headers: { authorization: `Bearer ${secondSession.childSessionToken}` },
    });
    expect(secondMode.statusCode).toBe(200);
    const secondChild = childModeResponseSchema.parse(secondMode.json()).child;
    expect(secondChild.alias).toBe("小山雀");
    expect(secondChild.ageBand).toBe("12_14");

    const replacedMode = await app.inject({
      method: "GET",
      url: "/api/v1/child/mode",
      headers: { authorization: `Bearer ${firstSession.childSessionToken}` },
    });
    expect(replacedMode.statusCode).toBe(403);
    expect(errorResponseSchema.parse(replacedMode.json()).error.code).toBe(
      "ACCOUNT_DEACTIVATED",
    );

    const activeSessions = await database
      .selectFrom("access_sessions")
      .select(sql<number>`COUNT(*)`.as("count"))
      .where("role", "=", "child")
      .where("revoked_at", "is", null)
      .executeTakeFirstOrThrow();
    expect(Number(activeSessions.count)).toBe(1);
  });
});
