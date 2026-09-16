import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { Transaction } from "kysely";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import type { DatabaseSchema } from "../database/types.js";
import { LocalSyntheticNotificationAdapter } from "./local-synthetic-notification-adapter.js";
import { RiskOutboxClaimWorker } from "./risk-outbox-claim-worker.js";
import { RiskNotificationAttemptError, RiskNotificationAttemptRunner } from "./risk-notification-attempt-runner.js";
import { RiskTicketStore } from "./risk-ticket-store.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Notification attempt integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);
const createdAt = "2026-09-16T12:15:00.000Z";
const attemptedAt = new Date("2026-09-16T12:15:01.000Z");

class RollbackTestTransaction extends Error {}

function createInput() {
  return {
    requestId: randomUUID(),
    synthetic: true as const,
    caseReference: `synthetic-risk-attempt-${randomUUID()}`,
    level: "L2" as const,
    primaryCategory: "bullying" as const,
    createdAt,
  };
}

function attemptRequest() {
  return { requestId: randomUUID(), workerId: randomUUID(), leaseDurationMs: 10_000 };
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

describe("phase 6A.4/6A.5 local notification attempt runner", () => {
  it("claims an outbox row, invokes only the local adapter, and records attempted without delivery", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const runner = new RiskNotificationAttemptRunner(
        transaction,
        new LocalSyntheticNotificationAdapter(() => attemptedAt),
        () => new Date(createdAt),
      );
      const ticket = await store.createTicket(createInput());
      const request = attemptRequest();

      const result = await runner.attemptNext(request);
      expect(result).toMatchObject({
        claimed: true,
        attempted: true,
        sent: false,
        delivered: false,
        replayed: false,
        ticketId: (
          await transaction.selectFrom("risk_tickets").select("id")
            .where("case_reference", "=", ticket.caseReference)
            .executeTakeFirstOrThrow()
        ).id,
        channel: "in_app",
        notificationStatus: "attempted",
        attempts: 1,
        requestId: request.requestId,
        workerId: request.workerId,
        attemptedAt: attemptedAt.toISOString(),
      });

      const outbox = await transaction.selectFrom("risk_ticket_notification_outbox")
        .select(["channel", "status", "attempts", "delivered_at", "viewed_at", "acknowledged_at"])
        .where("ticket_id", "=", (
          await transaction.selectFrom("risk_tickets").select("id")
            .where("case_reference", "=", ticket.caseReference)
            .executeTakeFirstOrThrow()
        ).id)
        .orderBy("channel", "asc")
        .execute();
      expect(outbox).toEqual([
        {
          channel: "in_app",
          status: "attempted",
          attempts: 1,
          delivered_at: null,
          viewed_at: null,
          acknowledged_at: null,
        },
        {
          channel: "off_site_backup",
          status: "not_sent",
          attempts: 0,
          delivered_at: null,
          viewed_at: null,
          acknowledged_at: null,
        },
      ]);

      const events = await transaction.selectFrom("risk_ticket_events")
        .select(["action", "channel"])
        .orderBy("occurred_at", "asc")
        .orderBy("id", "asc")
        .execute();
      expect(events).toEqual([
        { action: "record_send_attempted", channel: "in_app" },
      ]);
    });
  });

  it("replays the same attempt request idempotently, processes the second channel next, and reports no work after", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const runner = new RiskNotificationAttemptRunner(
        transaction,
        new LocalSyntheticNotificationAdapter(() => attemptedAt),
        () => new Date(createdAt),
      );
      await store.createTicket(createInput());
      const request = attemptRequest();

      const first = await runner.attemptNext(request);
      const replayed = await runner.attemptNext(request);
      expect(first).toMatchObject({ replayed: false });
      expect({ ...replayed, replayed: false }).toEqual(first);
      expect(replayed).toMatchObject({ replayed: true });

      const second = await runner.attemptNext(attemptRequest());
      expect(second).toMatchObject({
        claimed: true,
        attempted: true,
        sent: false,
        delivered: false,
        channel: "off_site_backup",
        notificationStatus: "attempted",
        attempts: 1,
      });
      expect(await runner.attemptNext(attemptRequest())).toEqual({
        claimed: false,
        attempted: false,
        sent: false,
        delivered: false,
      });

      const rows = await transaction.selectFrom("risk_ticket_events")
        .select("request_id").where("action", "=", "record_send_attempted").execute();
      expect(rows).toHaveLength(2);
      expect(rows.filter((row) => row.request_id === request.requestId)).toHaveLength(1);
    });
  });


  it("fails locally once, enforces a one-second backoff, then times out and escalates after the second failure", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      let current = new Date("2026-09-16T12:20:00.000Z");
      const runnerFactory = () => new RiskNotificationAttemptRunner(
        transaction,
        new LocalSyntheticNotificationAdapter(() => current),
        () => current,
        "local_simulated_failure",
      );
      const ticket = await store.createTicket(createInput());
      const ticketId = (await transaction.selectFrom("risk_tickets").select("id")
        .where("case_reference", "=", ticket.caseReference)
        .executeTakeFirstOrThrow()).id;

      const firstRequest = attemptRequest();
      const first = await runnerFactory().attemptNext(firstRequest);
      expect(first).toMatchObject({
        claimed: true,
        attempted: true,
        sent: false,
        delivered: false,
        channel: "in_app",
        notificationStatus: "failed",
        attempts: 1,
        failureMode: "local_simulated_failure",
      });

      current = new Date("2026-09-16T12:20:00.500Z");
      const otherChannelClaim = await new RiskOutboxClaimWorker(transaction, () => current)
        .claimNext(attemptRequest());
      expect(otherChannelClaim).toMatchObject({
        claimed: true,
        channel: "off_site_backup",
        notificationStatus: "not_sent",
        attempts: 0,
      });
      await expect(new RiskOutboxClaimWorker(transaction, () => current).claimNext(attemptRequest()))
        .resolves.toEqual({ claimed: false, sent: false });
      const firstReplayed = await runnerFactory().attemptNext(firstRequest);
      expect(firstReplayed).toMatchObject({
        replayed: true,
        notificationStatus: "failed",
        attempts: 1,
        sent: false,
        delivered: false,
      });

      current = new Date("2026-09-16T12:20:01.100Z");
      const secondRequest = attemptRequest();
      const second = await runnerFactory().attemptNext(secondRequest);
      expect(second).toMatchObject({
        claimed: true,
        attempted: true,
        sent: false,
        delivered: false,
        channel: "in_app",
        notificationStatus: "timed_out",
        attempts: 2,
        failureMode: "local_simulated_failure",
      });

      const snapshot = await store.getTicket(ticketId);
      expect(snapshot.status).toBe("escalated");
      expect(snapshot.notifications.find((item) => item.channel === "in_app")).toMatchObject({
        status: "timed_out",
        attempts: 2,
        deliveredAt: null,
        viewedAt: null,
        acknowledgedAt: null,
      });

      const secondReplayed = await runnerFactory().attemptNext(secondRequest);
      expect(secondReplayed).toMatchObject({
        replayed: true,
        notificationStatus: "timed_out",
        attempts: 2,
        sent: false,
        delivered: false,
      });
      await expect(runnerFactory().attemptNext(attemptRequest())).resolves.toEqual({
        claimed: false,
        attempted: false,
        sent: false,
        delivered: false,
      });

      const rows = await transaction.selectFrom("risk_ticket_notification_outbox")
        .select(["status", "attempts", "delivered_at", "viewed_at", "acknowledged_at", "lease_owner_id"])
        .where("ticket_id", "=", ticketId)
        .orderBy("channel", "asc")
        .execute();
      expect(rows).toMatchObject([
        {
          status: "timed_out",
          attempts: 2,
          delivered_at: null,
          viewed_at: null,
          acknowledged_at: null,
          lease_owner_id: expect.any(String),
        },
        {
          status: "not_sent",
          attempts: 0,
          delivered_at: null,
          viewed_at: null,
          acknowledged_at: null,
          lease_owner_id: expect.any(String),
        },
      ]);

      const events = await transaction.selectFrom("risk_ticket_events")
        .select(["action", "channel"])
        .where("ticket_id", "=", ticketId)
        .orderBy("occurred_at", "asc")
        .orderBy("id", "asc")
        .execute();
      expect(events).toEqual([
        { action: "record_send_attempted", channel: "in_app" },
        { action: "record_failed", channel: "in_app" },
        { action: "record_send_attempted", channel: "in_app" },
        { action: "record_timed_out", channel: "in_app" },
      ]);

      const eventId = (await transaction.selectFrom("risk_ticket_events")
        .select("id").where("ticket_id", "=", ticketId).limit(1)
        .executeTakeFirstOrThrow()).id;
      await expect(transaction.updateTable("risk_ticket_events")
        .set({ action: "record_delivered" }).where("id", "=", eventId).execute())
        .rejects.toThrow();
      await expect(transaction.deleteFrom("risk_ticket_events")
        .where("id", "=", eventId).execute())
        .rejects.toThrow();
    });
  });
  it("rejects an idempotency conflict and invalid requests without recording an event", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const runner = new RiskNotificationAttemptRunner(
        transaction,
        new LocalSyntheticNotificationAdapter(() => attemptedAt),
        () => new Date(createdAt),
      );
      await store.createTicket(createInput());
      const request = attemptRequest();
      await runner.attemptNext(request);

      await expect(runner.attemptNext({ ...request, workerId: randomUUID() }))
        .rejects.toEqual(new RiskNotificationAttemptError("RISK_NOTIFICATION_ATTEMPT_IDEMPOTENCY_CONFLICT"));
      await expect(runner.attemptNext({ requestId: "bad", workerId: randomUUID() }))
        .rejects.toEqual(new RiskNotificationAttemptError("RISK_NOTIFICATION_ATTEMPT_INVALID"));
      await expect(runner.attemptNext({ ...attemptRequest(), leaseDurationMs: 500 }))
        .rejects.toEqual(new RiskNotificationAttemptError("RISK_NOTIFICATION_ATTEMPT_INVALID"));
    });
  });
});








