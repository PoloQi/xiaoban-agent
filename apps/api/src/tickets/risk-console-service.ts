import { randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import {
  RISK_CONSOLE_SCHEMA_VERSION,
  riskConsoleTicketDetailSchema,
  riskConsoleTicketListResponseSchema,
  type RiskConsoleTicketDetail,
  type RiskConsoleTicketListResponse,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;
import { PublicAppError } from "../errors.js";
import { hashSecret } from "../identity/service.js";
import { RiskTicketStore, RiskTicketStoreError } from "./risk-ticket-store.js";

interface GuardianPrincipal {
  guardianId: string;
  childId: string;
}

type AssigneeState = "unclaimed" | "claimed_by_me" | "claimed_by_other";

function toIso(value: Date): string {
  return value.toISOString();
}

export class RiskConsoleService {
  constructor(private readonly database: DatabaseExecutor) {}

  private async inTransaction<T>(
    run: (transaction: Transaction<DatabaseSchema>) => Promise<T>,
  ): Promise<T> {
    if (this.database.isTransaction) {
      return run(this.database as Transaction<DatabaseSchema>);
    }
    return this.database.transaction().execute(run);
  }

  async list(token: string): Promise<RiskConsoleTicketListResponse> {
    const principal = await this.authenticate(token);
    return this.inTransaction(async (transaction) => {
      const rows = await transaction.selectFrom("risk_tickets")
        .selectAll()
        .where("child_id", "=", principal.childId)
        .orderBy("created_at", "desc")
        .limit(50)
        .execute();
      return riskConsoleTicketListResponseSchema.parse({
        schemaVersion: RISK_CONSOLE_SCHEMA_VERSION,
        synthetic: true,
        networkCallMade: false,
        tickets: rows.map((row) => ({
          id: row.id,
          caseReference: row.case_reference,
          level: row.risk_level,
          primaryCategory: row.primary_category,
          status: row.status,
          assigneeState: this.assigneeState(row.claimed_by_guardian_id, principal.guardianId),
          claimedAt: row.claimed_at === null ? null : toIso(row.claimed_at),
          createdAt: toIso(row.created_at),
          updatedAt: toIso(row.updated_at),
        })),
      });
    });
  }

  async detail(token: string, ticketId: string): Promise<RiskConsoleTicketDetail> {
    const principal = await this.authenticate(token);
    return this.inTransaction((transaction) =>
      this.loadDetail(transaction, principal, ticketId));
  }

  async claim(token: string, ticketId: string, requestId: string): Promise<RiskConsoleTicketDetail> {
    const principal = await this.authenticate(token);
    return this.inTransaction(async (transaction) => {
      const ticket = await this.lockOwnedTicket(transaction, principal, ticketId);
      const existing = await transaction.selectFrom("risk_ticket_console_notes")
        .select(["kind", "note"])
        .where("request_id", "=", requestId)
        .executeTakeFirst();
      if (existing === undefined) {
        if (ticket.claimed_by_guardian_id !== null) {
          throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
        }
        const now = new Date();
        await transaction.updateTable("risk_tickets")
          .set({ claimed_by_guardian_id: principal.guardianId, claimed_at: now })
          .where("id", "=", ticketId)
          .execute();
        await transaction.insertInto("risk_ticket_console_notes").values({
          id: randomUUID(),
          ticket_id: ticketId,
          request_id: requestId,
          guardian_id: principal.guardianId,
          kind: "claimed",
          note: null,
          created_at: now,
        }).execute();
      } else if (existing.kind !== "claimed" || existing.note !== null) {
        throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
      }
      return this.loadDetail(transaction, principal, ticketId);
    });
  }

  async addNote(
    token: string,
    ticketId: string,
    requestId: string,
    note: string,
  ): Promise<RiskConsoleTicketDetail> {
    const principal = await this.authenticate(token);
    return this.inTransaction(async (transaction) => {
      const ticket = await this.lockOwnedTicket(transaction, principal, ticketId);
      if (ticket.claimed_by_guardian_id !== principal.guardianId) {
        throw new PublicAppError("FORBIDDEN", 403);
      }
      const existing = await transaction.selectFrom("risk_ticket_console_notes")
        .select(["kind", "note"])
        .where("request_id", "=", requestId)
        .executeTakeFirst();
      if (existing === undefined) {
        if (ticket.status === "closed") {
          throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
        }
        await transaction.insertInto("risk_ticket_console_notes").values({
          id: randomUUID(),
          ticket_id: ticketId,
          request_id: requestId,
          guardian_id: principal.guardianId,
          kind: "disposition_note",
          note,
          created_at: new Date(),
        }).execute();
      } else if (existing.kind !== "disposition_note" || existing.note !== note) {
        throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
      }
      return this.loadDetail(transaction, principal, ticketId);
    });
  }

  async resolve(
    token: string,
    ticketId: string,
    requestId: string,
    dispositionNote: string,
  ): Promise<RiskConsoleTicketDetail> {
    const principal = await this.authenticate(token);
    return this.inTransaction(async (transaction) => {
      const ticket = await this.lockOwnedTicket(transaction, principal, ticketId);
      if (ticket.claimed_by_guardian_id !== principal.guardianId) {
        throw new PublicAppError("FORBIDDEN", 403);
      }
      if (!(await this.eventExists(transaction, requestId))) {
        await this.applyTicketEvent(transaction, ticketId, {
          requestId,
          action: "resolve",
          dispositionNote,
          occurredAt: new Date().toISOString(),
        });
      }
      return this.loadDetail(transaction, principal, ticketId);
    });
  }

  async close(token: string, ticketId: string, requestId: string): Promise<RiskConsoleTicketDetail> {
    const principal = await this.authenticate(token);
    return this.inTransaction(async (transaction) => {
      const ticket = await this.lockOwnedTicket(transaction, principal, ticketId);
      if (ticket.claimed_by_guardian_id !== principal.guardianId) {
        throw new PublicAppError("FORBIDDEN", 403);
      }
      if (!(await this.eventExists(transaction, requestId))) {
        await this.applyTicketEvent(transaction, ticketId, {
          requestId,
          action: "close",
          occurredAt: new Date().toISOString(),
        });
      }
      return this.loadDetail(transaction, principal, ticketId);
    });
  }

  private async eventExists(
    transaction: Transaction<DatabaseSchema>,
    requestId: string,
  ): Promise<boolean> {
    const existing = await transaction.selectFrom("risk_ticket_events")
      .select("id")
      .where("request_id", "=", requestId)
      .executeTakeFirst();
    return existing !== undefined;
  }
  private async applyTicketEvent(
    transaction: Transaction<DatabaseSchema>,
    ticketId: string,
    event: Record<string, unknown>,
  ): Promise<void> {
    try {
      await new RiskTicketStore(transaction).applyEvent(ticketId, event);
    } catch (error) {
      if (error instanceof RiskTicketStoreError) {
        if (error.code === "RISK_TICKET_NOT_FOUND") throw new PublicAppError("NOT_FOUND", 404);
        throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
      }
      throw error;
    }
  }

  private assigneeState(claimedByGuardianId: string | null, guardianId: string): AssigneeState {
    if (claimedByGuardianId === null) return "unclaimed";
    return claimedByGuardianId === guardianId ? "claimed_by_me" : "claimed_by_other";
  }

  private async lockOwnedTicket(
    transaction: Transaction<DatabaseSchema>,
    principal: GuardianPrincipal,
    ticketId: string,
  ) {
    const ticket = await transaction.selectFrom("risk_tickets")
      .selectAll()
      .where("id", "=", ticketId)
      .forUpdate()
      .executeTakeFirst();
    if (ticket === undefined || ticket.child_id !== principal.childId) {
      throw new PublicAppError("NOT_FOUND", 404);
    }
    return ticket;
  }

  private async loadDetail(
    transaction: Transaction<DatabaseSchema>,
    principal: GuardianPrincipal,
    ticketId: string,
  ): Promise<RiskConsoleTicketDetail> {
    const ticket = await transaction.selectFrom("risk_tickets")
      .selectAll()
      .where("id", "=", ticketId)
      .executeTakeFirst();
    if (ticket === undefined || ticket.child_id !== principal.childId) {
      throw new PublicAppError("NOT_FOUND", 404);
    }
    const store = new RiskTicketStore(transaction);
    const snapshot = await store.getTicket(ticketId);
    const noteRows = await transaction.selectFrom("risk_ticket_console_notes")
      .select(["id", "kind", "note", "created_at"])
      .where("ticket_id", "=", ticketId)
      .orderBy("created_at", "asc")
      .orderBy("id", "asc")
      .execute();
    const assigneeState = this.assigneeState(ticket.claimed_by_guardian_id, principal.guardianId);
    const claimedByMe = assigneeState === "claimed_by_me";
    return riskConsoleTicketDetailSchema.parse({
      id: ticket.id,
      caseReference: ticket.case_reference,
      level: ticket.risk_level,
      primaryCategory: ticket.primary_category,
      status: ticket.status,
      assigneeState,
      claimedAt: ticket.claimed_at === null ? null : toIso(ticket.claimed_at),
      createdAt: toIso(ticket.created_at),
      updatedAt: toIso(ticket.updated_at),
      resolution: snapshot.resolution,
      notifications: snapshot.notifications.map((item) => ({
        channel: item.channel,
        status: item.status,
        attempts: item.attempts,
        simulated: true,
        networkCallMade: false,
      })),
      notes: noteRows.map((row) => ({
        id: row.id,
        kind: row.kind,
        note: row.note,
        createdAt: toIso(row.created_at),
      })),
      permissions: {
        canClaim: assigneeState === "unclaimed",
        canAddNote: claimedByMe && ticket.status !== "closed",
        canResolve: claimedByMe && (ticket.status === "acknowledged" || ticket.status === "escalated"),
        canClose: claimedByMe && ticket.status === "resolved",
      },
      notificationBoundary: { simulated: true, networkCallMade: false, readOnly: true },
    });
  }

  private async authenticate(token: string): Promise<GuardianPrincipal> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    const session = await this.database.selectFrom("access_sessions")
      .select(["role", "subject_id as subjectId", "enrollment_id as enrollmentId", "revoked_at as revokedAt"])
      .where("token_hash", "=", hashSecret(token))
      .executeTakeFirst();
    if (session === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
    if (session.role !== "guardian") throw new PublicAppError("FORBIDDEN", 403);
    if (session.revokedAt !== null || session.enrollmentId === null) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }

    const principal = await this.database.selectFrom("guardian_accounts as guardian")
      .innerJoin("enrollments as enrollment", "enrollment.guardian_id", "guardian.id")
      .innerJoin("guardian_consents as consent", "consent.enrollment_id", "enrollment.id")
      .innerJoin("child_accounts as child", "child.id", "enrollment.child_id")
      .innerJoin("guardian_child_links as link", "link.child_id", "child.id")
      .select([
        "guardian.id as guardianId",
        "guardian.status as guardianStatus",
        "enrollment.status as enrollmentStatus",
        "consent.status as consentStatus",
        "child.id as childId",
        "child.status as childStatus",
        "link.verification_status as relationshipStatus",
        "link.deactivated_at as linkDeactivatedAt",
      ])
      .where("guardian.id", "=", session.subjectId)
      .where("enrollment.id", "=", session.enrollmentId)
      .whereRef("consent.guardian_id", "=", "guardian.id")
      .whereRef("consent.child_id", "=", "child.id")
      .whereRef("link.guardian_id", "=", "guardian.id")
      .executeTakeFirst();

    if (principal === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
    if (
      principal.guardianStatus !== "active"
      || principal.enrollmentStatus !== "active"
      || principal.consentStatus !== "active"
      || principal.childStatus !== "active"
      || principal.relationshipStatus !== "verified"
      || principal.linkDeactivatedAt !== null
    ) {
      throw new PublicAppError("ACCOUNT_DEACTIVATED", 403);
    }
    return { guardianId: principal.guardianId, childId: principal.childId };
  }
}