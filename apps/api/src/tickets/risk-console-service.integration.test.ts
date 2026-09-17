import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeEach, describe, expect, it } from "vitest";

import type { Kysely, Transaction } from "kysely";

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
  throw new Error("Risk console integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);
const localAccount = new LocalTestAccountService(database);
const now = "2026-09-17T03:00:00.000Z";
const nowDate = new Date(now);

type Executor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;
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

// Only non-append-only identity tables are physically cleared between tests.
// All append-only risk rows (events / console notes) are created inside a
// rolled-back transaction so they never require UPDATE/DELETE.
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

async function seedTicket(
  executor: Executor,
  level: "L2" | "L3",
  primaryCategory: "bullying" | "active_danger",
  childId: string,
): Promise<string> {
  const created = await new RiskTicketStore(executor).createTicket({
    requestId: randomUUID(),
    synthetic: true as const,
    caseReference: `synthetic-risk-console-${randomUUID()}`,
    level,
    primaryCategory,
    createdAt: now,
  });
  const ticketId = (await executor.selectFrom("risk_tickets").select("id")
    .where("case_reference", "=", created.caseReference)
    .executeTakeFirstOrThrow()).id;
  await executor.updateTable("risk_tickets")
    .set({ child_id: childId })
    .where("id", "=", ticketId)
    .execute();
  return ticketId;
}

async function acknowledgeBoth(executor: Executor, ticketId: string): Promise<void> {
  const store = new RiskTicketStore(executor);
  for (const channel of ["in_app", "off_site_backup"] as const) {
    for (const [action, suffix] of [
      ["record_send_attempted", "10"],
      ["record_delivered", "11"],
      ["record_viewed", "12"],
      ["record_acknowledged", "13"],
    ] as const) {
      await store.applyEvent(ticketId, {
        requestId: randomUUID(),
        action,
        channel,
        occurredAt: `2026-09-17T03:${suffix}:00.000Z`,
      });
    }
  }
}

async function seedSecondHousehold(
  executor: Executor,
): Promise<{ guardianToken: string; childId: string }> {
  const siteId = randomUUID();
  const guardianId = randomUUID();
  const childId = randomUUID();
  const enrollmentId = randomUUID();
  const consentId = randomUUID();
  const linkId = randomUUID();
  const invitationId = randomUUID();
  await executor.insertInto("sites").values({
    id: siteId, display_name: "他户站（虚构）", status: "active", created_at: nowDate,
  }).execute();
  await executor.insertInto("pilot_invitations").values({
    id: invitationId, site_id: siteId, batch_name: "他户",
    code_hash: randomBytes(32), status: "consumed", expires_at: new Date("2030-12-31"),
    created_at: nowDate, updated_at: nowDate,
  }).execute();
  await executor.insertInto("guardian_accounts").values({
    id: guardianId, alias: "他户监护人", verification_method: "controlled_site_invite",
    status: "active", created_at: nowDate,
  }).execute();
  await executor.insertInto("child_accounts").values({
    id: childId, site_id: siteId, alias: "小花", age_band: "9_11",
    minor_mode: 1, status: "active", child_notice_version: "child-boundaries-2026-08-v1",
    notice_acknowledged_at: nowDate, created_at: nowDate, updated_at: nowDate,
  }).execute();
  await executor.insertInto("enrollments").values({
    id: enrollmentId, invitation_id: invitationId, guardian_id: guardianId,
    child_id: childId, status: "active", guardian_request_id: randomUUID(),
    child_request_id: randomUUID(), created_at: nowDate, completed_at: nowDate, updated_at: nowDate,
  }).execute();
  await executor.insertInto("guardian_consents").values({
    id: consentId, enrollment_id: enrollmentId, guardian_id: guardianId,
    child_id: childId, policy_version: "guardian-consent-2026-08-v1",
    scope_code: "pilot_account_safety", status: "active", granted_at: nowDate,
    withdrawn_at: null, withdraw_reason_code: null, withdraw_request_id: null,
  }).execute();
  await executor.insertInto("guardian_child_links").values({
    id: linkId, guardian_id: guardianId, child_id: childId, relationship_role: "guardian",
    verification_status: "verified", verified_at: nowDate, deactivated_at: null,
  }).execute();
  const token = randomBytes(32).toString("base64url");
  await executor.insertInto("access_sessions").values({
    id: randomUUID(), enrollment_id: enrollmentId, role: "guardian",
    subject_id: guardianId, child_id: null, token_hash: hashSecret(token),
    created_at: nowDate, revoked_at: null,
  }).execute();
  return { guardianToken: token, childId };
}

beforeEach(async () => {
  await clearIdentity();
  await seedLocalTestAccount(database);
});

afterAll(async () => {
  await clearIdentity();
  await database.destroy();
});

describe("phase 6 risk console service (MySQL)", () => {
  it("lists only the guardian's household tickets and hides ordinary chat / contact data", async () => {
    const guardian = await localAccount.createGuardianSession();
    await inRollback(async (transaction) => {
      const service = new RiskConsoleService(transaction);
      await seedTicket(transaction, "L2", "bullying", LOCAL_TEST_ACCOUNT.childId);
      const other = await seedSecondHousehold(transaction);
      await seedTicket(transaction, "L3", "active_danger", other.childId);

      const list = await service.list(guardian.guardianSessionToken);
      expect(list.synthetic).toBe(true);
      expect(list.networkCallMade).toBe(false);
      expect(list.tickets).toHaveLength(1);
      expect(list.tickets[0]).toMatchObject({ level: "L2", assigneeState: "unclaimed" });
      expect(JSON.stringify(list)).not.toContain("conversation");

      const otherList = await service.list(other.guardianToken);
      expect(otherList.tickets).toHaveLength(1);
      expect(otherList.tickets[0]).toMatchObject({ level: "L3" });
    });
  });

  it("runs claim -> note -> resolve -> close with idempotent replays and read-only no-network notifications", async () => {
    const guardian = await localAccount.createGuardianSession();
    await inRollback(async (transaction) => {
      const service = new RiskConsoleService(transaction);
      const token = guardian.guardianSessionToken;
      const ticketId = await seedTicket(transaction, "L2", "bullying", LOCAL_TEST_ACCOUNT.childId);
      await acknowledgeBoth(transaction, ticketId);

      const claimReq = randomUUID();
      const claimed = await service.claim(token, ticketId, claimReq);
      expect(claimed.assigneeState).toBe("claimed_by_me");
      expect(claimed.permissions.canClaim).toBe(false);
      expect(claimed.permissions.canResolve).toBe(true);
      expect(claimed.notes.some((n) => n.kind === "claimed")).toBe(true);
      expect(claimed.notifications.every((n) => n.simulated === true && n.networkCallMade === false)).toBe(true);
      expect(claimed.notificationBoundary).toEqual({ simulated: true, networkCallMade: false, readOnly: true });

      const replayed = await service.claim(token, ticketId, claimReq);
      expect(replayed.notes.filter((n) => n.kind === "claimed")).toHaveLength(1);

      const noteReq = randomUUID();
      const note = "虚构处置：已当面和孩子核对页面并保留必要线索。";
      await service.addNote(token, ticketId, noteReq, note);
      const noteReplay = await service.addNote(token, ticketId, noteReq, note);
      expect(noteReplay.notes.filter((n) => n.kind === "disposition_note")).toHaveLength(1);

      const resolveReq = randomUUID();
      const disposition = "虚构处置：已完成本地演练处置，孩子已与可信任大人沟通。";
      const resolved = await service.resolve(token, ticketId, resolveReq, disposition);
      expect(resolved.status).toBe("resolved");
      expect(resolved.resolution).toBe(disposition);
      expect(resolved.permissions.canClose).toBe(true);
      await expect(service.resolve(token, ticketId, resolveReq, disposition)).resolves.toBeDefined();

      const closeReq = randomUUID();
      const closed = await service.close(token, ticketId, closeReq);
      expect(closed.status).toBe("closed");
      expect(closed.permissions.canAddNote).toBe(false);
      await expect(service.close(token, ticketId, closeReq)).resolves.toBeDefined();

      const firstNoteId = (await transaction.selectFrom("risk_ticket_console_notes").select("id")
        .where("ticket_id", "=", ticketId).orderBy("created_at", "asc").executeTakeFirstOrThrow()).id;
      await expect(transaction.updateTable("risk_ticket_console_notes")
        .set({ note: "不应被修改" }).where("id", "=", firstNoteId).execute()).rejects.toThrow();
      await expect(transaction.deleteFrom("risk_ticket_console_notes")
        .where("id", "=", firstNoteId).execute()).rejects.toThrow();
      const events = await transaction.selectFrom("risk_ticket_events").select("action")
        .where("ticket_id", "=", ticketId).orderBy("occurred_at", "asc").execute();
      expect(events.slice(-2).map((e) => e.action)).toEqual(["resolve", "close"]);
    });
  });

  it("forbids adding a note to a closed ticket and resolving before acknowledgement", async () => {
    const guardian = await localAccount.createGuardianSession();
    await inRollback(async (transaction) => {
      const service = new RiskConsoleService(transaction);
      const token = guardian.guardianSessionToken;
      const ticketId = await seedTicket(transaction, "L2", "bullying", LOCAL_TEST_ACCOUNT.childId);
      await acknowledgeBoth(transaction, ticketId);
      await service.claim(token, ticketId, randomUUID());
      await service.resolve(token, ticketId, randomUUID(), "虚构处置：本地演练提前解决。");
      await service.close(token, ticketId, randomUUID());
      await expect(service.addNote(token, ticketId, randomUUID(), "虚构处置：关闭后不应再追加备注。"))
        .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });

      const openTicket = await seedTicket(transaction, "L3", "active_danger", LOCAL_TEST_ACCOUNT.childId);
      await service.claim(token, openTicket, randomUUID());
      await expect(service.resolve(token, openTicket, randomUUID(), "虚构处置：未回执不应解决。"))
        .rejects.toMatchObject({ code: "IDEMPOTENCY_CONFLICT", statusCode: 409 });
    });
  });

  it("rejects child role, other-household guardian, and missing auth with 401/403/404", async () => {
    const child = await localAccount.resumeSession();
    await inRollback(async (transaction) => {
      const service = new RiskConsoleService(transaction);
      const ticketId = await seedTicket(transaction, "L2", "bullying", LOCAL_TEST_ACCOUNT.childId);
      await expect(service.list(child.childSessionToken)).rejects.toMatchObject({ statusCode: 403 });
      await expect(service.detail(child.childSessionToken, ticketId)).rejects.toMatchObject({ statusCode: 403 });

      const other = await seedSecondHousehold(transaction);
      await expect(service.list(other.guardianToken)).resolves.toMatchObject({ tickets: [] });
      await expect(service.detail(other.guardianToken, ticketId))
        .rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });
      await expect(service.claim(other.guardianToken, ticketId, randomUUID()))
        .rejects.toMatchObject({ code: "NOT_FOUND", statusCode: 404 });

      await expect(service.list("not-a-valid-token")).rejects.toMatchObject({ statusCode: 401 });
    });
  });
});