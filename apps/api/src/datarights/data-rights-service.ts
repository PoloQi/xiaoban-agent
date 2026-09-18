import { createHash, randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import {
  DATA_RIGHTS_SCHEMA_VERSION,
  dataRightsRequestSchema,
  type DataRightsRequest,
  type DataRightsResponse,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";
import { hashSecret } from "../identity/service.js";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

interface GuardianPrincipal {
  guardianId: string;
}

interface ActiveGuardianChild extends GuardianPrincipal {
  childId: string;
}

type DataRightsEventAction =
  | "request_received"
  | "export_queued"
  | "functional_deletion_completed";

function hashCommand(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function toResponse(
  request: DataRightsRequest,
  row: {
    status: DataRightsResponse["status"];
    childStatusAfter: DataRightsResponse["childStatus"];
    effectiveAt: Date | null;
    queuedForManualProcessing: boolean;
  },
): DataRightsResponse {
  return {
    schemaVersion: DATA_RIGHTS_SCHEMA_VERSION,
    requestId: request.requestId,
    requestType: request.requestType,
    status: row.status,
    childStatus: row.childStatusAfter,
    queuedForManualProcessing: row.queuedForManualProcessing,
    effectiveAt: row.effectiveAt === null ? null : row.effectiveAt.toISOString(),
  };
}

export class DataRightsService {
  constructor(private readonly database: DatabaseExecutor) {}

  async submitRequest(token: string, rawBody: unknown): Promise<DataRightsResponse> {
    const parsed = dataRightsRequestSchema.safeParse(rawBody);
    if (!parsed.success) throw new PublicAppError("INVALID_REQUEST", 400);
    const request = parsed.data;
    if (!request.confirmed) throw new PublicAppError("INVALID_REQUEST", 400);
    const requestHash = hashCommand(request);
    const guardian = await this.authenticateGuardian(token);

    return this.inTransaction(async (transaction) => {
      const existing = await transaction.selectFrom("data_rights_requests")
        .selectAll()
        .where("request_id", "=", request.requestId)
        .executeTakeFirst();
      if (existing !== undefined) {
        if (existing.guardian_id !== guardian.guardianId || existing.request_hash !== requestHash) {
          throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
        }
        return toResponse(request, {
          status: existing.status,
          childStatusAfter: existing.child_status_after,
          effectiveAt: existing.effective_at,
          queuedForManualProcessing: existing.status === "queued",
        });
      }

      const child = await this.requireActiveChild(transaction, guardian);
      const now = new Date();
      const requestRowId = randomUUID();
      const isDelete = request.requestType === "delete";

      await transaction.insertInto("data_rights_requests").values({
        id: requestRowId,
        request_id: request.requestId,
        request_hash: requestHash,
        guardian_id: guardian.guardianId,
        child_id: child.childId,
        synthetic: 1,
        request_type: request.requestType,
        reason_code: request.reasonCode,
        status: isDelete ? "completed" : "queued",
        child_status_after: isDelete ? "deactivated" : "active",
        effective_at: isDelete ? now : null,
        created_at: now,
        updated_at: now,
      }).execute();

      await this.appendEvent(transaction, {
        request,
        requestRowId,
        guardianId: guardian.guardianId,
        action: "request_received",
        requestHash,
        now,
        sequence: 1,
      });

      if (isDelete) {
        await this.applyFunctionalDeletion(transaction, {
          request,
          requestRowId,
          guardian,
          child,
          requestHash,
          now,
        });
      } else {
        await this.appendEvent(transaction, {
          request,
          requestRowId,
          guardianId: guardian.guardianId,
          action: "export_queued",
          requestHash,
          now,
          sequence: 2,
        });
        await this.writeAudit(transaction, {
          actorId: guardian.guardianId,
          action: "data_rights.export_queued",
          targetId: child.childId,
          requestId: request.requestId,
          metadata: { requestType: "export", reasonCode: request.reasonCode },
          now,
        });
      }

      return toResponse(request, {
        status: isDelete ? "completed" : "queued",
        childStatusAfter: isDelete ? "deactivated" : "active",
        effectiveAt: isDelete ? now : null,
        queuedForManualProcessing: !isDelete,
      });
    });
  }

  private async applyFunctionalDeletion(
    transaction: Transaction<DatabaseSchema>,
    input: {
      request: DataRightsRequest;
      requestRowId: string;
      guardian: GuardianPrincipal;
      child: ActiveGuardianChild;
      requestHash: string;
      now: Date;
    },
  ): Promise<void> {
    await transaction.updateTable("guardian_consents")
      .set({
        status: "withdrawn",
        withdrawn_at: input.now,
        withdraw_reason_code: input.request.reasonCode,
        withdraw_request_id: input.request.requestId,
      })
      .where("guardian_id", "=", input.guardian.guardianId)
      .where("child_id", "=", input.child.childId)
      .where("status", "=", "active")
      .execute();

    await transaction.updateTable("enrollments")
      .set({ status: "withdrawn", updated_at: input.now })
      .where("guardian_id", "=", input.guardian.guardianId)
      .where("child_id", "=", input.child.childId)
      .where("status", "=", "active")
      .execute();

    await transaction.updateTable("child_accounts")
      .set({ status: "deactivated", updated_at: input.now })
      .where("id", "=", input.child.childId)
      .execute();

    await transaction.updateTable("guardian_child_links")
      .set({ deactivated_at: input.now })
      .where("guardian_id", "=", input.guardian.guardianId)
      .where("child_id", "=", input.child.childId)
      .execute();

    await transaction.updateTable("access_sessions")
      .set({ revoked_at: input.now })
      .where("role", "=", "child")
      .where("child_id", "=", input.child.childId)
      .where("revoked_at", "is", null)
      .execute();

    await this.appendEvent(transaction, {
      request: input.request,
      requestRowId: input.requestRowId,
      guardianId: input.guardian.guardianId,
      action: "functional_deletion_completed",
      requestHash: input.requestHash,
      now: input.now,
      sequence: 2,
    });
    await this.writeAudit(transaction, {
      actorId: input.guardian.guardianId,
      action: "data_rights.functional_deletion_completed",
      targetId: input.child.childId,
      requestId: input.request.requestId,
      metadata: { requestType: "delete", reasonCode: input.request.reasonCode },
      now: input.now,
    });
    await this.writeAudit(transaction, {
      actorId: input.guardian.guardianId,
      action: "child_account.deactivated",
      targetId: input.child.childId,
      requestId: input.request.requestId,
      metadata: { source: "data_rights_delete" },
      now: input.now,
    });
  }

  private async appendEvent(
    transaction: Transaction<DatabaseSchema>,
    input: {
      request: DataRightsRequest;
      requestRowId: string;
      guardianId: string;
      action: DataRightsEventAction;
      requestHash: string;
      now: Date;
      sequence: number;
    },
  ): Promise<void> {
    await transaction.insertInto("data_rights_request_events").values({
      id: randomUUID(),
      data_rights_request_id: input.requestRowId,
      request_id: input.request.requestId,
      event_request_id: randomUUID(),
      request_hash: input.requestHash,
      sequence_no: input.sequence,
      action: input.action,
      actor_guardian_id: input.guardianId,
      event_metadata: JSON.stringify({
        requestType: input.request.requestType,
        reasonCode: input.request.reasonCode,
      }),
      occurred_at: input.now,
      created_at: input.now,
    }).execute();
  }

  private async writeAudit(
    database: DatabaseExecutor,
    input: {
      actorId: string;
      action: string;
      targetId: string;
      requestId: string;
      metadata: Record<string, unknown>;
      now: Date;
    },
  ): Promise<void> {
    await database.insertInto("audit_entries").values({
      id: randomUUID(),
      actor_type: "guardian",
      actor_id: input.actorId,
      action: input.action,
      target_type: "child_account",
      target_id: input.targetId,
      request_id: input.requestId,
      metadata: JSON.stringify(input.metadata),
      created_at: input.now,
    }).execute();
  }

  private async authenticateGuardian(token: string): Promise<{ guardianId: string }> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) throw new PublicAppError("UNAUTHORIZED", 401);
    const session = await this.database.selectFrom("access_sessions")
      .select(["role", "subject_id", "revoked_at"])
      .where("token_hash", "=", hashSecret(token))
      .executeTakeFirst();
    if (session === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
    if (session.role !== "guardian") throw new PublicAppError("FORBIDDEN", 403);
    if (session.revoked_at !== null) throw new PublicAppError("UNAUTHORIZED", 401);
    return { guardianId: session.subject_id };
  }

  private async requireActiveChild(
    transaction: Transaction<DatabaseSchema>,
    guardian: GuardianPrincipal,
  ): Promise<ActiveGuardianChild> {
    const link = await transaction.selectFrom("guardian_accounts as guardian")
      .innerJoin("enrollments as enrollment", "enrollment.guardian_id", "guardian.id")
      .innerJoin("guardian_consents as consent", "consent.enrollment_id", "enrollment.id")
      .innerJoin("child_accounts as child", "child.id", "enrollment.child_id")
      .innerJoin("guardian_child_links as link", (join) => join
        .onRef("link.child_id", "=", "child.id")
        .onRef("link.guardian_id", "=", "guardian.id"))
      .select(["child.id as childId"])
      .where("guardian.id", "=", guardian.guardianId)
      .where("guardian.status", "=", "active")
      .where("enrollment.status", "=", "active")
      .where("consent.status", "=", "active")
      .where("child.status", "=", "active")
      .where("link.verification_status", "=", "verified")
      .where("link.deactivated_at", "is", null)
      .executeTakeFirst();
    if (link === undefined) throw new PublicAppError("FORBIDDEN", 403);
    return { guardianId: guardian.guardianId, childId: link.childId };
  }

  private async inTransaction<T>(run: (transaction: Transaction<DatabaseSchema>) => Promise<T>): Promise<T> {
    if (this.database.isTransaction) return run(this.database as Transaction<DatabaseSchema>);
    return this.database.transaction().execute(run);
  }
}
