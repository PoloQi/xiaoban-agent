import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Transaction } from "kysely";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import type { DatabaseSchema } from "../database/types.js";
import { hashSecret } from "../identity/service.js";
import {
  LOCAL_TEST_ACCOUNT,
  LocalTestAccountService,
  seedLocalTestAccount,
} from "../identity/local-test-account.js";
import { RiskConsoleService } from "./risk-console-service.js";
import { RiskTicketStore } from "./risk-ticket-store.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Risk console route integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);
const localAccount = new LocalTestAccountService(database);
const nowDate = new Date("2026-09-17T04:00:00.000Z");

class RollbackTestTransaction extends Error {}

async function inRollback(
  run: (transaction: Transaction<DatabaseSchema>) => Promise<void>,
): Promise<void> {
  try {
    await database.transaction().execute(async (transaction) => {
      await run(transaction);
      throw new RollbackTestTransaction();
    });
  } catch (error) {
    if (!(error instanceof RollbackTestTransaction)) throw error;
  }
}

async function clearIdentity(): Promise<void> {
  await database.deleteFrom("risk_ticket_notification_outbox").execute();
  await database.deleteFrom("risk_ticket_outbox_claims").execute();
  await database.deleteFrom("risk_tickets").execute();
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

async function seedTicket(transaction: Transaction<DatabaseSchema>, childId: string): Promise<string> {
  const store = new RiskTicketStore(transaction);
  const created = await store.createTicket({
    requestId: randomUUID(),
    synthetic: true as const,
    caseReference: `synthetic-risk-route-${randomUUID()}`,
    level: "L2" as const,
    primaryCategory: "bullying" as const,
    createdAt: nowDate.toISOString(),
  });
  const ticketId = (await transaction.selectFrom("risk_tickets").select("id")
    .where("case_reference", "=", created.caseReference).executeTakeFirstOrThrow()).id;
  await transaction.updateTable("risk_tickets").set({ child_id: childId }).where("id", "=", ticketId).execute();
  for (const channel of ["in_app", "off_site_backup"] as const) {
    for (const action of ["record_send_attempted", "record_delivered", "record_viewed", "record_acknowledged"] as const) {
      await store.applyEvent(ticketId, { requestId: randomUUID(), action, channel, occurredAt: new Date().toISOString() });
    }
  }
  return ticketId;
}

async function otherGuardianToken(transaction: Transaction<DatabaseSchema>): Promise<string> {
  const siteId = randomUUID();
  const guardianId = randomUUID();
  const childId = randomUUID();
  const enrollmentId = randomUUID();
  const invitationId = randomUUID();
  await transaction.insertInto("sites").values({ id: siteId, display_name: "他户站（虚构）", status: "active", created_at: nowDate }).execute();
  await transaction.insertInto("pilot_invitations").values({
    id: invitationId, site_id: siteId, batch_name: "他户", code_hash: randomBytes(32),
    status: "consumed", expires_at: new Date("2030-12-31"), created_at: nowDate, updated_at: nowDate,
  }).execute();
  await transaction.insertInto("guardian_accounts").values({
    id: guardianId, alias: "他户监护人", verification_method: "controlled_site_invite", status: "active", created_at: nowDate,
  }).execute();
  await transaction.insertInto("child_accounts").values({
    id: childId, site_id: siteId, alias: "小花", age_band: "9_11", minor_mode: 1, status: "active",
    child_notice_version: "child-boundaries-2026-08-v1", notice_acknowledged_at: nowDate, created_at: nowDate, updated_at: nowDate,
  }).execute();
  await transaction.insertInto("enrollments").values({
    id: enrollmentId, invitation_id: invitationId, guardian_id: guardianId, child_id: childId, status: "active",
    guardian_request_id: randomUUID(), child_request_id: randomUUID(), created_at: nowDate, completed_at: nowDate, updated_at: nowDate,
  }).execute();
  await transaction.insertInto("guardian_consents").values({
    id: randomUUID(), enrollment_id: enrollmentId, guardian_id: guardianId, child_id: childId,
    policy_version: "guardian-consent-2026-08-v1", scope_code: "pilot_account_safety", status: "active",
    granted_at: nowDate, withdrawn_at: null, withdraw_reason_code: null, withdraw_request_id: null,
  }).execute();
  await transaction.insertInto("guardian_child_links").values({
    id: randomUUID(), guardian_id: guardianId, child_id: childId, relationship_role: "guardian",
    verification_status: "verified", verified_at: nowDate, deactivated_at: null,
  }).execute();
  const token = randomBytes(32).toString("base64url");
  await transaction.insertInto("access_sessions").values({
    id: randomUUID(), enrollment_id: enrollmentId, role: "guardian", subject_id: guardianId,
    child_id: null, token_hash: hashSecret(token), created_at: nowDate, revoked_at: null,
  }).execute();
  return token;
}

function auth(token: string) {
  return { authorization: `Bearer ${token}` };
}

beforeEach(async () => {
  await clearIdentity();
  await seedLocalTestAccount(database);
});

afterAll(async () => {
  await clearIdentity();
  await database.destroy();
});

describe("phase 6 risk console routes", () => {
  it("rejects missing auth and child role with 403", async () => {
    await inRollback(async (transaction) => {
      const app = buildApp({ riskConsoleService: new RiskConsoleService(transaction) });
      await app.ready();
      const noAuth = await app.inject({ method: "GET", url: "/api/v1/risk-console/tickets" });
      expect(noAuth.statusCode).toBe(403);
      const badToken = await app.inject({
        method: "GET", url: "/api/v1/risk-console/tickets", headers: auth("not-a-token"),
      });
      expect(badToken.statusCode).toBe(403);

      const child = await localAccount.resumeSession();
      const childForbidden = await app.inject({
        method: "GET", url: "/api/v1/risk-console/tickets", headers: auth(child.childSessionToken),
      });
      expect(childForbidden.statusCode).toBe(403);
      await app.close();
    });
  });

  it("drives the full claim/notes/resolve/close flow for the verified guardian with no-network boundary", async () => {
    const guardian = await localAccount.createGuardianSession();
    await inRollback(async (transaction) => {
      const app = buildApp({ riskConsoleService: new RiskConsoleService(transaction) });
      await app.ready();
      const token = guardian.guardianSessionToken;
      const ticketId = await seedTicket(transaction, LOCAL_TEST_ACCOUNT.childId);
      const base = `/api/v1/risk-console/tickets/${ticketId}`;

      const list = await app.inject({ method: "GET", url: "/api/v1/risk-console/tickets", headers: auth(token) });
      expect(list.statusCode).toBe(200);
      const listBody = list.json();
      expect(listBody.networkCallMade).toBe(false);
      expect(listBody.tickets).toHaveLength(1);

      const detail = await app.inject({ method: "GET", url: base, headers: auth(token) });
      expect(detail.statusCode).toBe(200);
      expect(detail.json().notificationBoundary).toEqual({ simulated: true, networkCallMade: false, readOnly: true });

      const claim = await app.inject({
        method: "POST", url: `${base}/claim`, headers: { ...auth(token), "content-type": "application/json" },
        payload: { requestId: randomUUID() },
      });
      expect(claim.statusCode).toBe(200);
      expect(claim.json().assigneeState).toBe("claimed_by_me");

      const invalidBody = await app.inject({
        method: "POST", url: `${base}/notes`, headers: { ...auth(token), "content-type": "application/json" },
        payload: { requestId: randomUUID(), note: "没有虚构处置前缀且过短" },
      });
      expect(invalidBody.statusCode).toBe(400);

      const note = await app.inject({
        method: "POST", url: `${base}/notes`, headers: { ...auth(token), "content-type": "application/json" },
        payload: { requestId: randomUUID(), note: "虚构处置：已保留页面线索并当面沟通。" },
      });
      expect(note.statusCode).toBe(200);
      expect(note.json().notes.some((item: { kind: string }) => item.kind === "disposition_note")).toBe(true);

      const resolve = await app.inject({
        method: "POST", url: `${base}/resolve`, headers: { ...auth(token), "content-type": "application/json" },
        payload: { requestId: randomUUID(), dispositionNote: "虚构处置：本地演练处置完成。" },
      });
      expect(resolve.statusCode).toBe(200);
      expect(resolve.json().status).toBe("resolved");

      const close = await app.inject({
        method: "POST", url: `${base}/close`, headers: { ...auth(token), "content-type": "application/json" },
        payload: { requestId: randomUUID() },
      });
      expect(close.statusCode).toBe(200);
      expect(close.json().status).toBe("closed");
      expect(JSON.stringify(close.json())).not.toContain("conversation");
      await app.close();
    });
  });

  it("returns 403 for another-household guardian and an unknown ticket id", async () => {
    const guardian = await localAccount.createGuardianSession();
    await inRollback(async (transaction) => {
      const app = buildApp({ riskConsoleService: new RiskConsoleService(transaction) });
      await app.ready();
      const token = guardian.guardianSessionToken;
      const ticketId = await seedTicket(transaction, LOCAL_TEST_ACCOUNT.childId);
      const otherToken = await otherGuardianToken(transaction);

      const cross = await app.inject({
        method: "GET", url: `/api/v1/risk-console/tickets/${ticketId}`, headers: auth(otherToken),
      });
      expect(cross.statusCode).toBe(403);
      const crossClaim = await app.inject({
        method: "POST",
        url: `/api/v1/risk-console/tickets/${ticketId}/claim`,
        headers: { ...auth(otherToken), "content-type": "application/json" },
        payload: { requestId: randomUUID() },
      });
      expect(crossClaim.statusCode).toBe(403);

      const unknown = await app.inject({
        method: "GET", url: `/api/v1/risk-console/tickets/${randomUUID()}`, headers: auth(token),
      });
      expect(unknown.statusCode).toBe(403);
      await app.close();
    });
  });
});