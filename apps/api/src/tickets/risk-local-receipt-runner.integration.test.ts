import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { Transaction } from "kysely";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import type { DatabaseSchema } from "../database/types.js";
import { LocalSyntheticNotificationAdapter } from "./local-synthetic-notification-adapter.js";
import { RiskLocalReceiptError, RiskLocalReceiptRunner } from "./risk-local-receipt-runner.js";
import { RiskNotificationAttemptRunner } from "./risk-notification-attempt-runner.js";
import { RiskTicketStore } from "./risk-ticket-store.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Local receipt integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);
const baseTime = new Date("2026-09-17T02:40:00.000Z");

class RollbackTestTransaction extends Error {}

function createInput() {
  return {
    requestId: randomUUID(),
    synthetic: true as const,
    caseReference: `synthetic-risk-receipt-${randomUUID()}`,
    level: "L2" as const,
    primaryCategory: "bullying" as const,
    createdAt: baseTime.toISOString(),
  };
}

function receiptRequest(ticketId: string, channel: "in_app" | "off_site_backup") {
  return { requestId: randomUUID(), ticketId, channel };
}

async function inRollback(run: (transaction: Transaction<DatabaseSchema>) => Promise<void>) {
  try {
    await database.transaction().execute(async (transaction) => {
      await run(transaction);
      throw new RollbackTestTransaction();
    });
  } catch (error) {
    if (!(error instanceof RollbackTestTransaction)) throw error;
  }
}

afterAll(async () => {
  await database.destroy();
});

describe("phase 6A.6 local simulated success receipt runner", () => {
  it("records delivered->viewed->acknowledged for both channels and aggregates acknowledgement only after both confirm", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      let clock = new Date(baseTime.getTime() + 1_000);
      const adapter = new LocalSyntheticNotificationAdapter(() => clock);
      const attemptRunner = new RiskNotificationAttemptRunner(
        transaction,
        adapter,
        () => clock,
      );
      const ticket = await store.createTicket(createInput());
      const ticketId = (await transaction.selectFrom("risk_tickets").select("id")
        .where("case_reference", "=", ticket.caseReference)
        .executeTakeFirstOrThrow()).id;

      await attemptRunner.attemptNext({ requestId: randomUUID(), workerId: randomUUID() });
      clock = new Date(clock.getTime() + 1_000);
      await attemptRunner.attemptNext({ requestId: randomUUID(), workerId: randomUUID() });
      let snapshot = await store.getTicket(ticketId);
      expect(snapshot.notifications.map((item) => item.status)).toEqual(["attempted", "attempted"]);

      const receiptRunner = new RiskLocalReceiptRunner(transaction, () => clock);
      const inAppDelivered = receiptRequest(ticketId, "in_app");
      const inAppViewed = receiptRequest(ticketId, "in_app");
      const inAppAcknowledged = receiptRequest(ticketId, "in_app");

      clock = new Date(clock.getTime() + 1_000);
      const delivered = await receiptRunner.recordNext(inAppDelivered);
      expect(delivered).toMatchObject({
        recorded: true,
        replayed: false,
        simulated: true,
        networkCallMade: false,
        requestId: inAppDelivered.requestId,
        recordedAction: "record_delivered",
        channelStatus: "delivered",
        ticketStatus: "open",
      });
      expect(await receiptRunner.recordNext(inAppDelivered)).toMatchObject({
        recorded: true,
        replayed: true,
        requestId: inAppDelivered.requestId,
        recordedAction: "record_delivered",
        channelStatus: "delivered",
        ticketStatus: "open",
      });

      clock = new Date(clock.getTime() + 1_000);
      const viewed = await receiptRunner.recordNext(inAppViewed);
      expect(viewed).toMatchObject({
        recorded: true,
        recordedAction: "record_viewed",
        channelStatus: "viewed",
        ticketStatus: "open",
      });
      clock = new Date(clock.getTime() + 1_000);
      const acknowledged = await receiptRunner.recordNext(inAppAcknowledged);
      expect(acknowledged).toMatchObject({
        recorded: true,
        recordedAction: "record_acknowledged",
        channelStatus: "acknowledged",
        ticketStatus: "waiting_for_acknowledgement",
      });
      expect(await receiptRunner.recordNext(inAppAcknowledged)).toMatchObject({
        recorded: true,
        replayed: true,
        recordedAction: "record_acknowledged",
        channelStatus: "acknowledged",
        ticketStatus: "waiting_for_acknowledgement",
      });

      snapshot = await store.getTicket(ticketId);
      expect(snapshot.status).toBe("waiting_for_acknowledgement");
      const inApp = snapshot.notifications.find((item) => item.channel === "in_app");
      expect(inApp).toMatchObject({ status: "acknowledged", attempts: 1 });
      expect(inApp?.deliveredAt && inApp.viewedAt && inApp.acknowledgedAt).toBeTruthy();
      expect(new Date(inApp!.deliveredAt!).getTime())
        .toBeLessThan(new Date(inApp!.viewedAt!).getTime());
      expect(new Date(inApp!.viewedAt!).getTime())
        .toBeLessThan(new Date(inApp!.acknowledgedAt!).getTime());

      const done = await receiptRunner.recordNext(receiptRequest(ticketId, "in_app"));
      expect(done).toMatchObject({
        recorded: false,
        reason: "channel_already_acknowledged",
        channelStatus: "acknowledged",
        ticketStatus: "waiting_for_acknowledgement",
      });

      for (const expected of [
        { action: "record_delivered", status: "delivered", ticket: "waiting_for_acknowledgement" },
        { action: "record_viewed", status: "viewed", ticket: "waiting_for_acknowledgement" },
        { action: "record_acknowledged", status: "acknowledged", ticket: "acknowledged" },
      ] as const) {
        clock = new Date(clock.getTime() + 1_000);
        const result = await receiptRunner.recordNext(receiptRequest(ticketId, "off_site_backup"));
        expect(result).toMatchObject({
          recorded: true,
          replayed: false,
          recordedAction: expected.action,
          channelStatus: expected.status,
          ticketStatus: expected.ticket,
        });
      }

      snapshot = await store.getTicket(ticketId);
      expect(snapshot.status).toBe("acknowledged");
      expect(snapshot.notifications.every((item) => item.status === "acknowledged")).toBe(true);

      const rows = await transaction.selectFrom("risk_ticket_notification_outbox")
        .select(["channel", "status", "attempts", "delivered_at", "viewed_at", "acknowledged_at"])
        .where("ticket_id", "=", ticketId)
        .orderBy("channel", "asc")
        .execute();
      expect(rows.every((row) => row.delivered_at !== null
        && row.viewed_at !== null && row.acknowledged_at !== null)).toBe(true);

      const events = await transaction.selectFrom("risk_ticket_events")
        .select(["action", "channel"])
        .where("ticket_id", "=", ticketId)
        .orderBy("occurred_at", "asc")
        .orderBy("id", "asc")
        .execute();
      expect(events).toEqual([
        { action: "record_send_attempted", channel: "in_app" },
        { action: "record_send_attempted", channel: "off_site_backup" },
        { action: "record_delivered", channel: "in_app" },
        { action: "record_viewed", channel: "in_app" },
        { action: "record_acknowledged", channel: "in_app" },
        { action: "record_delivered", channel: "off_site_backup" },
        { action: "record_viewed", channel: "off_site_backup" },
        { action: "record_acknowledged", channel: "off_site_backup" },
      ]);

      const eventId = (await transaction.selectFrom("risk_ticket_events")
        .select("id").where("ticket_id", "=", ticketId).limit(1)
        .executeTakeFirstOrThrow()).id;
      await expect(transaction.updateTable("risk_ticket_events")
        .set({ action: "record_failed" }).where("id", "=", eventId).execute())
        .rejects.toThrow();
      await expect(transaction.deleteFrom("risk_ticket_events")
        .where("id", "=", eventId).execute())
        .rejects.toThrow();
    });
  });

  it("keeps the two channels independent so a receipt on one channel never advances the other", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const clock = new Date(baseTime.getTime() + 5_000);
      const ticket = await store.createTicket(createInput());
      const ticketId = (await transaction.selectFrom("risk_tickets").select("id")
        .where("case_reference", "=", ticket.caseReference)
        .executeTakeFirstOrThrow()).id;
      await store.applyEvent(ticketId, {
        requestId: randomUUID(),
        action: "record_send_attempted",
        channel: "in_app",
        occurredAt: clock.toISOString(),
      });
      const runner = new RiskLocalReceiptRunner(transaction, () => clock);

      await runner.recordNext(receiptRequest(ticketId, "in_app"));
      const snapshot = await store.getTicket(ticketId);
      const byChannel = Object.fromEntries(snapshot.notifications.map((item) => [item.channel, item.status]));
      expect(byChannel).toEqual({ in_app: "delivered", off_site_backup: "not_sent" });
      expect(snapshot.status).toBe("open");
    });
  });

  it("refuses a simulated success receipt when the channel has not been attempted or is terminal timed_out", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const clock = new Date(baseTime.getTime() + 2_000);
      const ticket = await store.createTicket({
        ...createInput(),
        level: "L3",
        primaryCategory: "active_danger",
      });
      const ticketId = (await transaction.selectFrom("risk_tickets").select("id")
        .where("case_reference", "=", ticket.caseReference)
        .executeTakeFirstOrThrow()).id;
      const runner = new RiskLocalReceiptRunner(transaction, () => clock);

      await expect(runner.recordNext(receiptRequest(ticketId, "in_app")))
        .rejects.toEqual(new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID"));

      await store.applyEvent(ticketId, {
        requestId: randomUUID(),
        action: "record_send_attempted",
        channel: "off_site_backup",
        occurredAt: clock.toISOString(),
      });
      await store.applyEvent(ticketId, {
        requestId: randomUUID(),
        action: "record_timed_out",
        channel: "off_site_backup",
        occurredAt: new Date(clock.getTime() + 1).toISOString(),
      });
      await expect(runner.recordNext(receiptRequest(ticketId, "off_site_backup")))
        .rejects.toEqual(new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID"));
    });
  });

  it("rejects malformed receipt requests and unknown tickets without appending events", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const clock = new Date(baseTime.getTime() + 3_000);
      const ticket = await store.createTicket(createInput());
      const ticketId = (await transaction.selectFrom("risk_tickets").select("id")
        .where("case_reference", "=", ticket.caseReference)
        .executeTakeFirstOrThrow()).id;
      const runner = new RiskLocalReceiptRunner(transaction, () => clock);

      await expect(runner.recordNext({ requestId: "bad", ticketId, channel: "in_app" }))
        .rejects.toEqual(new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID"));
      await expect(runner.recordNext({ requestId: randomUUID(), ticketId, channel: "sms" }))
        .rejects.toEqual(new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID"));
      await expect(runner.recordNext({ requestId: randomUUID(), ticketId: randomUUID(), channel: "in_app" }))
        .rejects.toEqual(new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID"));
      await expect(runner.recordNext({ ...receiptRequest(ticketId, "in_app"), extra: true }))
        .rejects.toEqual(new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID"));

      const count = await transaction.selectFrom("risk_ticket_events")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("ticket_id", "=", ticketId)
        .executeTakeFirstOrThrow();
      expect(Number(count.count)).toBe(0);
    });
  });
});
