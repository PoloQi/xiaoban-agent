import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { Transaction } from "kysely";

import type { RiskTicketSnapshot } from "@xiaoban/contracts";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import type { DatabaseSchema } from "../database/types.js";
import { RiskTicketStateError } from "./risk-ticket-state-machine.js";
import { RiskTicketStore, RiskTicketStoreError } from "./risk-ticket-store.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Risk ticket integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);
const now = "2026-09-16T11:40:00.000Z";

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

function createInput(overrides: Partial<{
  requestId: string;
  caseReference: string;
}> = {}) {
  return {
    requestId: overrides.requestId ?? randomUUID(),
    synthetic: true as const,
    caseReference: overrides.caseReference ?? `synthetic-risk-ticket-${randomUUID()}`,
    level: "L2" as const,
    primaryCategory: "bullying" as const,
    createdAt: now,
  };
}

async function acknowledgeInApp(
  store: RiskTicketStore,
  ticketId: string,
  suffix: string,
): Promise<RiskTicketSnapshot> {
  let ticket = await store.applyEvent(ticketId, {
    requestId: randomUUID(),
    action: "record_send_attempted",
    channel: "in_app",
    occurredAt: `2026-09-16T11:${suffix}:00.000Z`,
  });
  ticket = await store.applyEvent(ticketId, {
    requestId: randomUUID(),
    action: "record_delivered",
    channel: "in_app",
    occurredAt: `2026-09-16T11:${suffix}:01.000Z`,
  });
  ticket = await store.applyEvent(ticketId, {
    requestId: randomUUID(),
    action: "record_viewed",
    channel: "in_app",
    occurredAt: `2026-09-16T11:${suffix}:02.000Z`,
  });
  return store.applyEvent(ticketId, {
    requestId: randomUUID(),
    action: "record_acknowledged",
    channel: "in_app",
    occurredAt: `2026-09-16T11:${suffix}:03.000Z`,
  });
}

afterAll(async () => {
  await database.destroy();
});

describe("phase 6A.2 risk ticket MySQL outbox store", () => {
  it("creates synthetic tickets idempotently with two not-sent outbox rows", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const input = createInput();
      const created = await store.createTicket(input);
      expect(created).toMatchObject({
        synthetic: true,
        level: "L2",
        primaryCategory: "bullying",
        status: "open",
        resolution: null,
      });
      expect(created.notifications.map((item) => item.channel)).toEqual([
        "in_app",
        "off_site_backup",
      ]);
      expect(created.notifications.every((item) => item.status === "not_sent")).toBe(true);

      const outbox = await transaction.selectFrom("risk_ticket_notification_outbox")
        .select(["channel", "status", "attempts"])
        .where("ticket_id", "=", (
          await transaction.selectFrom("risk_tickets").select("id")
            .where("case_reference", "=", input.caseReference).executeTakeFirstOrThrow()
        ).id)
        .orderBy("channel", "asc")
        .execute();
      expect(outbox).toEqual([
        { channel: "in_app", status: "not_sent", attempts: 0 },
        { channel: "off_site_backup", status: "not_sent", attempts: 0 },
      ]);

      const replayed = await store.createTicket(input);
      expect(replayed).toEqual(created);
      await expect(store.createTicket({ ...input, caseReference: `synthetic-risk-ticket-${randomUUID()}` }))
        .rejects.toEqual(new RiskTicketStoreError("RISK_TICKET_IDEMPOTENCY_CONFLICT"));

      const duplicateCase = createInput({ caseReference: input.caseReference });
      await expect(store.createTicket(duplicateCase))
        .rejects.toEqual(new RiskTicketStoreError("RISK_TICKET_CASE_CONFLICT"));
    });
  });

  it("persists append-only events and outbox receipt state through acknowledgement, resolution, and close", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const created = await store.createTicket(createInput());
      const ticketRow = await transaction.selectFrom("risk_tickets")
        .select("id").where("case_reference", "=", created.caseReference)
        .executeTakeFirstOrThrow();

      let ticket = await acknowledgeInApp(store, ticketRow.id, "41");
      expect(ticket.status).toBe("waiting_for_acknowledgement");

      const eventInputs: Array<{ requestId: string }> = [];
      const makeEvent = (requestId: string) => ({ requestId });
      const attempted = {
        requestId: randomUUID(),
        action: "record_send_attempted" as const,
        channel: "off_site_backup" as const,
        occurredAt: "2026-09-16T11:42:00.000Z",
      };
      eventInputs.push(makeEvent(attempted.requestId));
      ticket = await store.applyEvent(ticketRow.id, attempted);
      expect(await store.applyEvent(ticketRow.id, attempted)).toEqual(ticket);
      await expect(store.applyEvent(ticketRow.id, {
        ...attempted,
        action: "record_delivered",
        occurredAt: "2026-09-16T11:42:01.000Z",
      })).rejects.toEqual(new RiskTicketStoreError("RISK_TICKET_IDEMPOTENCY_CONFLICT"));

      ticket = await store.applyEvent(ticketRow.id, {
        requestId: randomUUID(),
        action: "record_delivered",
        channel: "off_site_backup",
        occurredAt: "2026-09-16T11:42:01.000Z",
      });
      ticket = await store.applyEvent(ticketRow.id, {
        requestId: randomUUID(),
        action: "record_viewed",
        channel: "off_site_backup",
        occurredAt: "2026-09-16T11:42:02.000Z",
      });
      ticket = await store.applyEvent(ticketRow.id, {
        requestId: randomUUID(),
        action: "record_acknowledged",
        channel: "off_site_backup",
        occurredAt: "2026-09-16T11:42:03.000Z",
      });
      expect(ticket.status).toBe("acknowledged");

      await expect(store.applyEvent(ticketRow.id, {
        requestId: randomUUID(),
        action: "resolve",
        dispositionNote: "虚构处置：工单仍需合法状态转换。",
        occurredAt: "2026-09-16T11:42:04.000Z",
      })).resolves.toBeDefined();
      ticket = await store.getTicket(ticketRow.id);
      expect(ticket.status).toBe("resolved");
      expect(ticket.resolution).toBe("虚构处置：工单仍需合法状态转换。");
      ticket = await store.applyEvent(ticketRow.id, {
        requestId: randomUUID(),
        action: "close",
        occurredAt: "2026-09-16T11:42:05.000Z",
      });
      expect(ticket.status).toBe("closed");

      const events = await store.listEvents(ticketRow.id);
      expect(events.map((event) => event.action)).toEqual([
        "record_send_attempted",
        "record_delivered",
        "record_viewed",
        "record_acknowledged",
        "record_send_attempted",
        "record_delivered",
        "record_viewed",
        "record_acknowledged",
        "resolve",
        "close",
      ]);
      const firstEventId = (await transaction.selectFrom("risk_ticket_events")
        .select("id").where("ticket_id", "=", ticketRow.id)
        .orderBy("occurred_at", "asc").orderBy("id", "asc")
        .executeTakeFirstOrThrow()).id;
      await expect(transaction.updateTable("risk_ticket_events")
        .set({ action: "close" })
        .where("id", "=", firstEventId).execute()).rejects.toThrow();
      await expect(transaction.deleteFrom("risk_ticket_events")
        .where("id", "=", firstEventId).execute()).rejects.toThrow();
    });
  });

  it("persists failure timeout escalation and rejects unknown tickets or invalid transitions", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const created = await store.createTicket({
        ...createInput(),
        level: "L3",
        primaryCategory: "active_danger",
      });
      const ticketRow = await transaction.selectFrom("risk_tickets")
        .select("id").where("case_reference", "=", created.caseReference)
        .executeTakeFirstOrThrow();

      await store.applyEvent(ticketRow.id, {
        requestId: randomUUID(),
        action: "record_send_attempted",
        channel: "off_site_backup",
        occurredAt: "2026-09-16T11:43:00.000Z",
      });
      await store.applyEvent(ticketRow.id, {
        requestId: randomUUID(),
        action: "record_failed",
        channel: "off_site_backup",
        occurredAt: "2026-09-16T11:43:01.000Z",
      });
      await store.applyEvent(ticketRow.id, {
        requestId: randomUUID(),
        action: "record_send_attempted",
        channel: "off_site_backup",
        occurredAt: "2026-09-16T11:43:02.000Z",
      });
      const timedOut = await store.applyEvent(ticketRow.id, {
        requestId: randomUUID(),
        action: "record_timed_out",
        channel: "off_site_backup",
        occurredAt: "2026-09-16T11:43:03.000Z",
      });
      expect(timedOut.status).toBe("escalated");
      expect(timedOut.notifications.find((item) => item.channel === "off_site_backup"))
        .toMatchObject({ status: "timed_out", attempts: 2 });

      await expect(store.applyEvent(randomUUID(), {
        requestId: randomUUID(),
        action: "close",
        occurredAt: "2026-09-16T11:43:04.000Z",
      })).rejects.toEqual(new RiskTicketStoreError("RISK_TICKET_NOT_FOUND"));
      await expect(store.applyEvent(ticketRow.id, {
        requestId: randomUUID(),
        action: "close",
        occurredAt: "2026-09-16T11:43:05.000Z",
      })).rejects.toEqual(new RiskTicketStoreError("RISK_TICKET_INVALID_TRANSITION"));
    });
  });

  it("does not leave synthetic risk ticket data after the rolled-back test", async () => {
    const tickets = await database.selectFrom("risk_tickets")
      .select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    const outbox = await database.selectFrom("risk_ticket_notification_outbox")
      .select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    const events = await database.selectFrom("risk_ticket_events")
      .select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    expect(Number(tickets.count)).toBe(0);
    expect(Number(outbox.count)).toBe(0);
    expect(Number(events.count)).toBe(0);
  });
});