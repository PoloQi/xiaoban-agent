import { createHash, randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import {
  riskTicketCreateRequestSchema,
  riskTicketEventSchema,
  RISK_TICKET_SCHEMA_VERSION,
  riskTicketSnapshotSchema,
  type RiskTicketEvent,
  type RiskTicketSnapshot,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import {
  RiskTicketStateError,
  applyRiskTicketEvent,
  createRiskTicket,
} from "./risk-ticket-state-machine.js";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export type RiskTicketStoreErrorCode =
  | RiskTicketStateError["code"]
  | "RISK_TICKET_NOT_FOUND"
  | "RISK_TICKET_CASE_CONFLICT"
  | "RISK_TICKET_IDEMPOTENCY_CONFLICT";

export class RiskTicketStoreError extends Error {
  constructor(readonly code: RiskTicketStoreErrorCode) {
    super(code);
    this.name = "RiskTicketStoreError";
  }
}

function hashCommand(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function toIso(value: Date): string {
  return value.toISOString();
}

function isDuplicateEntry(error: unknown): boolean {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && error.code === "ER_DUP_ENTRY";
}

export class RiskTicketStore {
  constructor(private readonly database: DatabaseExecutor) {}

  async createTicket(rawInput: unknown): Promise<RiskTicketSnapshot> {
    const parsed = riskTicketCreateRequestSchema.safeParse(rawInput);
    if (!parsed.success) throw new RiskTicketStoreError("RISK_TICKET_REQUEST_INVALID");
    const input = parsed.data;
    const requestHash = hashCommand(input);

    return this.inTransaction(async (transaction) => {
      const existing = await transaction.selectFrom("risk_tickets")
        .select(["id", "request_hash"])
        .where("request_id", "=", input.requestId)
        .executeTakeFirst();
      if (existing !== undefined) {
        if (existing.request_hash !== requestHash) {
          throw new RiskTicketStoreError("RISK_TICKET_IDEMPOTENCY_CONFLICT");
        }
        return this.readSnapshot(transaction, existing.id);
      }

      const conflictingCase = await transaction.selectFrom("risk_tickets")
        .select("id")
        .where("case_reference", "=", input.caseReference)
        .executeTakeFirst();
      if (conflictingCase !== undefined) {
        throw new RiskTicketStoreError("RISK_TICKET_CASE_CONFLICT");
      }

      const snapshot = createRiskTicket(input);
      const now = new Date();
      const ticketId = randomUUID();
      try {
        await transaction.insertInto("risk_tickets").values({
          id: ticketId,
          request_id: input.requestId,
          request_hash: requestHash,
          synthetic: 1,
          case_reference: snapshot.caseReference,
          risk_level: snapshot.level,
          primary_category: snapshot.primaryCategory,
          status: snapshot.status,
          resolution: null,
          created_at: new Date(snapshot.createdAt),
          updated_at: new Date(snapshot.updatedAt),
        }).execute();

        for (const notification of snapshot.notifications) {
          await transaction.insertInto("risk_ticket_notification_outbox").values({
            id: randomUUID(),
            ticket_id: ticketId,
            channel: notification.channel,
            status: notification.status,
            attempts: notification.attempts,
            lease_owner_id: null,
            leased_at: null,
            lease_expires_at: null,
            lease_count: 0,
            delivered_at: null,
            viewed_at: null,
            acknowledged_at: null,
            failed_at: null,
            timed_out_at: null,
            created_at: now,
            updated_at: now,
          }).execute();
        }
      } catch (error) {
        if (!isDuplicateEntry(error)) throw error;
        throw new RiskTicketStoreError("RISK_TICKET_IDEMPOTENCY_CONFLICT");
      }

      return this.readSnapshot(transaction, ticketId);
    });
  }

  async applyEvent(ticketId: string, rawEvent: unknown): Promise<RiskTicketSnapshot> {
    const parsed = riskTicketEventSchema.safeParse(rawEvent);
    if (!parsed.success) throw new RiskTicketStoreError("RISK_TICKET_EVENT_INVALID");
    const event = parsed.data;
    const requestHash = hashCommand(event);

    return this.inTransaction(async (transaction) => {
      const ticket = await transaction.selectFrom("risk_tickets")
        .selectAll()
        .where("id", "=", ticketId)
        .forUpdate()
        .executeTakeFirst();
      if (ticket === undefined) throw new RiskTicketStoreError("RISK_TICKET_NOT_FOUND");

      const existingEvent = await transaction.selectFrom("risk_ticket_events")
        .select("request_hash")
        .where("request_id", "=", event.requestId)
        .executeTakeFirst();
      if (existingEvent !== undefined) {
        if (existingEvent.request_hash !== requestHash) {
          throw new RiskTicketStoreError("RISK_TICKET_IDEMPOTENCY_CONFLICT");
        }
        return this.readSnapshot(transaction, ticketId);
      }

      const current = await this.readSnapshotLocked(transaction, ticketId);
      let next: RiskTicketSnapshot;
      try {
        next = applyRiskTicketEvent(current, event);
      } catch (error) {
        if (error instanceof RiskTicketStateError) {
          throw new RiskTicketStoreError(error.code);
        }
        throw error;
      }

      await transaction.insertInto("risk_ticket_events").values({
        id: randomUUID(),
        ticket_id: ticketId,
        request_id: event.requestId,
        request_hash: requestHash,
        action: event.action,
        channel: event.channel ?? null,
        disposition_note: event.dispositionNote ?? null,
        occurred_at: new Date(event.occurredAt),
        created_at: new Date(),
      }).execute();

      for (const notification of next.notifications) {
        await transaction.updateTable("risk_ticket_notification_outbox")
          .set({
            status: notification.status,
            attempts: notification.attempts,
            delivered_at: notification.deliveredAt === null ? null : new Date(notification.deliveredAt),
            viewed_at: notification.viewedAt === null ? null : new Date(notification.viewedAt),
            acknowledged_at: notification.acknowledgedAt === null ? null : new Date(notification.acknowledgedAt),
            failed_at: notification.failedAt === null ? null : new Date(notification.failedAt),
            timed_out_at: notification.timedOutAt === null ? null : new Date(notification.timedOutAt),
            updated_at: new Date(event.occurredAt),
          })
          .where("ticket_id", "=", ticketId)
          .where("channel", "=", notification.channel)
          .execute();
      }

      await transaction.updateTable("risk_tickets")
        .set({
          status: next.status,
          resolution: next.resolution,
          updated_at: new Date(next.updatedAt),
        })
        .where("id", "=", ticketId)
        .execute();

      return next;
    });
  }

  async getTicket(ticketId: string): Promise<RiskTicketSnapshot> {
    return this.inTransaction((transaction) => this.readSnapshot(transaction, ticketId));
  }

  async listEvents(ticketId: string): Promise<RiskTicketEvent[]> {
    return this.inTransaction(async (transaction) => {
      const ticket = await transaction.selectFrom("risk_tickets")
        .select("id").where("id", "=", ticketId).executeTakeFirst();
      if (ticket === undefined) throw new RiskTicketStoreError("RISK_TICKET_NOT_FOUND");
      return this.readEvents(transaction, ticketId);
    });
  }

  private async readSnapshot(
    database: DatabaseExecutor,
    ticketId: string,
  ): Promise<RiskTicketSnapshot> {
    const ticket = await database.selectFrom("risk_tickets")
      .selectAll().where("id", "=", ticketId).executeTakeFirst();
    if (ticket === undefined) throw new RiskTicketStoreError("RISK_TICKET_NOT_FOUND");
    const outbox = await database.selectFrom("risk_ticket_notification_outbox")
      .selectAll()
      .where("ticket_id", "=", ticketId)
      .orderBy("channel", "asc")
      .execute();

    return riskTicketSnapshotSchema.parse({
      schemaVersion: RISK_TICKET_SCHEMA_VERSION,
      synthetic: true,
      caseReference: ticket.case_reference,
      level: ticket.risk_level,
      primaryCategory: ticket.primary_category,
      status: ticket.status,
      resolution: ticket.resolution,
      notifications: outbox.map((item) => ({
        channel: item.channel,
        status: item.status,
        attempts: item.attempts,
        deliveredAt: item.delivered_at === null ? null : toIso(item.delivered_at),
        viewedAt: item.viewed_at === null ? null : toIso(item.viewed_at),
        acknowledgedAt: item.acknowledged_at === null ? null : toIso(item.acknowledged_at),
        failedAt: item.failed_at === null ? null : toIso(item.failed_at),
        timedOutAt: item.timed_out_at === null ? null : toIso(item.timed_out_at),
      })),
      createdAt: toIso(ticket.created_at),
      updatedAt: toIso(ticket.updated_at),
    });
  }

  private async readSnapshotLocked(
    transaction: Transaction<DatabaseSchema>,
    ticketId: string,
  ): Promise<RiskTicketSnapshot> {
    await transaction.selectFrom("risk_tickets")
      .select("id").where("id", "=", ticketId).forUpdate().executeTakeFirstOrThrow();
    await transaction.selectFrom("risk_ticket_notification_outbox")
      .select("id")
      .where("ticket_id", "=", ticketId)
      .forUpdate()
      .execute();
    return this.readSnapshot(transaction, ticketId);
  }

  private async readEvents(
    database: DatabaseExecutor,
    ticketId: string,
  ): Promise<RiskTicketEvent[]> {
    const rows = await database.selectFrom("risk_ticket_events")
      .selectAll()
      .where("ticket_id", "=", ticketId)
      .orderBy("occurred_at", "asc")
      .orderBy("id", "asc")
      .execute();
    return rows.map((row) => ({
      requestId: row.request_id,
      action: row.action,
      ...(row.channel === null ? {} : { channel: row.channel }),
      ...(row.disposition_note === null ? {} : { dispositionNote: row.disposition_note }),
      occurredAt: toIso(row.occurred_at),
    }));
  }

  private async inTransaction<T>(
    run: (transaction: Transaction<DatabaseSchema>) => Promise<T>,
  ): Promise<T> {
    if (this.database.isTransaction) {
      return run(this.database as Transaction<DatabaseSchema>);
    }
    return this.database.transaction().execute(run);
  }
}