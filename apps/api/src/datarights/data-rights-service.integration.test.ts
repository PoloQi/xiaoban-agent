import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { Transaction } from "kysely";

import {
  dataRightsResponseSchema,
  GUARDIAN_CONSENT_VERSION,
  CHILD_NOTICE_VERSION,
} from "@xiaoban/contracts";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import type { DatabaseSchema } from "../database/types.js";
import { buildApp } from "../app.js";
import { DataRightsService } from "./data-rights-service.js";
import { hashSecret } from "../identity/service.js";
import { PublicAppError } from "../errors.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Data rights integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);
const createdAt = new Date("2026-09-17T12:00:00.000Z");

class RollbackTestTransaction extends Error {}

async function inRollback(run: (transaction: Transaction<DatabaseSchema>) => Promise<void>): Promise<void> {
  try {
    await database.transaction().execute(async (transaction) => {
      await run(transaction);
      throw new RollbackTestTransaction();
    });
  } catch (error) {
    if (!(error instanceof RollbackTestTransaction)) throw error;
  }
}

function token(): string {
  return randomBytes(32).toString("base64url");
}

async function seedActiveRelationship(
  transaction: Transaction<DatabaseSchema>,
): Promise<{ guardianId: string; childId: string; guardianToken: string; childToken: string }> {
  const siteId = randomUUID();
  const invitationId = randomUUID();
  const guardianId = randomUUID();
  const childId = randomUUID();
  const enrollmentId = randomUUID();
  const consentId = randomUUID();
  const linkId = randomUUID();
  const guardianToken = token();
  const childToken = token();
  const invitationCode = `SYNTHETIC-${randomUUID()}`;

  await transaction.insertInto("sites").values({
    id: siteId,
    display_name: "数据权利合成站",
    status: "active",
    created_at: createdAt,
  }).execute();
  await transaction.insertInto("pilot_invitations").values({
    id: invitationId,
    site_id: siteId,
    batch_name: "数据权利合成批次",
    code_hash: hashSecret(invitationCode),
    status: "consumed",
    expires_at: new Date("2030-12-31T00:00:00.000Z"),
    created_at: createdAt,
    updated_at: createdAt,
  }).execute();
  await transaction.insertInto("guardian_accounts").values({
    id: guardianId,
    alias: "青禾监护人",
    verification_method: "controlled_site_invite",
    status: "active",
    created_at: createdAt,
  }).execute();
  await transaction.insertInto("child_accounts").values({
    id: childId,
    site_id: siteId,
    alias: "小树",
    age_band: "9_11",
    minor_mode: 1,
    status: "active",
    child_notice_version: CHILD_NOTICE_VERSION,
    notice_acknowledged_at: createdAt,
    created_at: createdAt,
    updated_at: createdAt,
  }).execute();
  await transaction.insertInto("enrollments").values({
    id: enrollmentId,
    invitation_id: invitationId,
    guardian_id: guardianId,
    child_id: childId,
    status: "active",
    guardian_request_id: randomUUID(),
    child_request_id: randomUUID(),
    created_at: createdAt,
    completed_at: createdAt,
    updated_at: createdAt,
  }).execute();
  await transaction.insertInto("guardian_consents").values({
    id: consentId,
    enrollment_id: enrollmentId,
    guardian_id: guardianId,
    child_id: childId,
    policy_version: GUARDIAN_CONSENT_VERSION,
    scope_code: "pilot_account_safety",
    status: "active",
    granted_at: createdAt,
    withdrawn_at: null,
    withdraw_reason_code: null,
    withdraw_request_id: null,
  }).execute();
  await transaction.insertInto("guardian_child_links").values({
    id: linkId,
    guardian_id: guardianId,
    child_id: childId,
    relationship_role: "guardian",
    verification_status: "verified",
    verified_at: createdAt,
    deactivated_at: null,
  }).execute();
  await transaction.insertInto("access_sessions").values({
    id: randomUUID(),
    enrollment_id: enrollmentId,
    role: "guardian",
    subject_id: guardianId,
    child_id: null,
    token_hash: hashSecret(guardianToken),
    created_at: createdAt,
    revoked_at: null,
  }).execute();
  await transaction.insertInto("access_sessions").values({
    id: randomUUID(),
    enrollment_id: enrollmentId,
    role: "child",
    subject_id: childId,
    child_id: childId,
    token_hash: hashSecret(childToken),
    created_at: createdAt,
    revoked_at: null,
  }).execute();

  return { guardianId, childId, guardianToken, childToken };
}

afterAll(async () => {
  await database.destroy();
});

describe("phase 6B.1 data rights requests", () => {
  it("queues an export request, keeps the child active, and appends received/queued events", async () => {
    await inRollback(async (transaction) => {
      const seeded = await seedActiveRelationship(transaction);
      const service = new DataRightsService(transaction);
      const requestId = randomUUID();

      const response = dataRightsResponseSchema.parse(await service.submitRequest(seeded.guardianToken, {
        requestId,
        requestType: "export",
        reasonCode: "privacy_request",
        confirmed: true,
      }));
      expect(response).toMatchObject({
        requestId,
        requestType: "export",
        status: "queued",
        childStatus: "active",
        queuedForManualProcessing: true,
        effectiveAt: null,
      });

      const replayed = await service.submitRequest(seeded.guardianToken, {
        requestId,
        requestType: "export",
        reasonCode: "privacy_request",
        confirmed: true,
      });
      expect(replayed).toEqual(response);

      const child = await transaction.selectFrom("child_accounts")
        .select("status").where("id", "=", seeded.childId).executeTakeFirstOrThrow();
      expect(child.status).toBe("active");
      const events = await transaction.selectFrom("data_rights_request_events")
        .select("action").where("request_id", "=", requestId)
        .orderBy("sequence_no", "asc").execute();
      expect(events.map((event) => event.action)).toEqual([
        "request_received",
        "export_queued",
      ]);
    });
  });

  it("completes functional deletion and stops child free functionality by deactivation and revoked child sessions", async () => {
    await inRollback(async (transaction) => {
      const seeded = await seedActiveRelationship(transaction);
      const service = new DataRightsService(transaction);
      const requestId = randomUUID();

      const response = dataRightsResponseSchema.parse(await service.submitRequest(seeded.guardianToken, {
        requestId,
        requestType: "delete",
        reasonCode: "privacy_request",
        confirmed: true,
      }));
      expect(response.status).toBe("completed");
      expect(response.childStatus).toBe("deactivated");
      expect(response.queuedForManualProcessing).toBe(false);
      expect(response.effectiveAt).not.toBeNull();

      const child = await transaction.selectFrom("child_accounts")
        .select("status").where("id", "=", seeded.childId).executeTakeFirstOrThrow();
      const enrollment = await transaction.selectFrom("enrollments")
        .select("status").where("child_id", "=", seeded.childId).executeTakeFirstOrThrow();
      const consent = await transaction.selectFrom("guardian_consents")
        .select(["status", "withdraw_reason_code", "withdraw_request_id"])
        .where("child_id", "=", seeded.childId).executeTakeFirstOrThrow();
      const link = await transaction.selectFrom("guardian_child_links")
        .select("deactivated_at").where("child_id", "=", seeded.childId).executeTakeFirstOrThrow();
      const childSession = await transaction.selectFrom("access_sessions")
        .select("revoked_at").where("role", "=", "child")
        .where("child_id", "=", seeded.childId).executeTakeFirstOrThrow();
      expect(child.status).toBe("deactivated");
      expect(enrollment.status).toBe("withdrawn");
      expect(consent).toMatchObject({
        status: "withdrawn",
        withdraw_reason_code: "privacy_request",
        withdraw_request_id: requestId,
      });
      expect(link.deactivated_at).not.toBeNull();
      expect(childSession.revoked_at).not.toBeNull();

      const events = await transaction.selectFrom("data_rights_request_events")
        .select("action").where("request_id", "=", requestId)
        .orderBy("sequence_no", "asc").execute();
      expect(events.map((event) => event.action)).toEqual([
        "request_received",
        "functional_deletion_completed",
      ]);
      const eventId = events[0] === undefined ? "" : (
        await transaction.selectFrom("data_rights_request_events").select("id")
          .where("request_id", "=", requestId)
          .where("action", "=", "request_received")
          .executeTakeFirstOrThrow()
      ).id;
      await expect(transaction.updateTable("data_rights_request_events")
        .set({ action: "export_queued" }).where("id", "=", eventId).execute()).rejects.toThrow();
      await expect(transaction.deleteFrom("data_rights_request_events")
        .where("id", "=", eventId).execute()).rejects.toThrow();

      const audits = await transaction.selectFrom("audit_entries")
        .select("action").where("request_id", "=", requestId)
        .orderBy("created_at", "asc").execute();
      expect(audits.map((audit) => audit.action).sort()).toEqual([
        "child_account.deactivated",
        "data_rights.functional_deletion_completed",
      ]);
    });
  });

  it("registers the guardian route and rejects child callers at the HTTP boundary", async () => {
    await inRollback(async (transaction) => {
      const seeded = await seedActiveRelationship(transaction);
      const app = buildApp({ dataRightsService: new DataRightsService(transaction) });
      try {
        const accepted = await app.inject({
          method: "POST",
          url: "/api/v1/guardian/data-rights/requests",
          headers: { authorization: `Bearer ${seeded.guardianToken}` },
          payload: {
            requestId: randomUUID(),
            requestType: "export",
            reasonCode: "privacy_request",
            confirmed: true,
          },
        });
        expect(accepted.statusCode).toBe(201);
        expect(dataRightsResponseSchema.parse(accepted.json())).toMatchObject({
          requestType: "export",
          status: "queued",
          childStatus: "active",
          queuedForManualProcessing: true,
          effectiveAt: null,
        });

        const forbidden = await app.inject({
          method: "POST",
          url: "/api/v1/guardian/data-rights/requests",
          headers: { authorization: `Bearer ${seeded.childToken}` },
          payload: {
            requestId: randomUUID(),
            requestType: "export",
            reasonCode: "privacy_request",
            confirmed: true,
          },
        });
        expect(forbidden.statusCode).toBe(403);
      } finally {
        await app.close();
      }
    });
  });

  it("rejects unconfirmed requests, child callers, and conflicting idempotent payloads", async () => {
    await inRollback(async (transaction) => {
      const seeded = await seedActiveRelationship(transaction);
      const service = new DataRightsService(transaction);
      const requestId = randomUUID();

      await expect(service.submitRequest(seeded.guardianToken, {
        requestId,
        requestType: "delete",
        reasonCode: "privacy_request",
        confirmed: false,
      })).rejects.toEqual(new PublicAppError("INVALID_REQUEST", 400));

      await expect(service.submitRequest(seeded.childToken, {
        requestId: randomUUID(),
        requestType: "export",
        reasonCode: "privacy_request",
        confirmed: true,
      })).rejects.toEqual(new PublicAppError("FORBIDDEN", 403));

      await service.submitRequest(seeded.guardianToken, {
        requestId,
        requestType: "export",
        reasonCode: "privacy_request",
        confirmed: true,
      });
      await expect(service.submitRequest(seeded.guardianToken, {
        requestId,
        requestType: "delete",
        reasonCode: "privacy_request",
        confirmed: true,
      })).rejects.toEqual(new PublicAppError("IDEMPOTENCY_CONFLICT", 409));
    });
  });
});
