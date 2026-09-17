import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { Transaction } from "kysely";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import type { DatabaseSchema } from "../database/types.js";
import {
  RiskBackoffScheduleDrillError,
  RiskBackoffScheduleDrillRunner,
} from "./risk-backoff-schedule-drill-runner.js";
import { RiskOutboxClaimWorker } from "./risk-outbox-claim-worker.js";
import { RiskTicketStore } from "./risk-ticket-store.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Backoff drill integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);
const createdAt = "2026-09-17T11:00:00.000Z";
const workerId = randomUUID();

class RollbackTestTransaction extends Error {}

function createInput() {
  return {
    requestId: randomUUID(),
    synthetic: true as const,
    caseReference: `synthetic-risk-boff-${randomUUID()}`,
    level: "L3" as const,
    primaryCategory: "self_harm" as const,
    createdAt,
  };
}

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

afterAll(async () => {
  await database.destroy();
});

describe("phase 6A.8 deterministic local backoff schedule drill", () => {
  it("waits out the backoff window, reclaims the same failed row, and escalates after two failures", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      let clock = new Date("2026-09-17T11:05:00.000Z");
      const runner = new RiskBackoffScheduleDrillRunner(transaction, () => clock);
      const ticket = await store.createTicket(createInput());
      const ticketId = (await transaction.selectFrom("risk_tickets").select("id")
        .where("case_reference", "=", ticket.caseReference)
        .executeTakeFirstOrThrow()).id;
      const requestId = randomUUID();

      const result = await runner.runDrill({ requestId, workerId, leaseDurationMs: 10_000 });
      expect(result).toEqual({
        drill: "risk_notification_backoff_schedule",
        simulated: true,
        networkCallMade: false,
        sent: false,
        delivered: false,
        ticketId,
        channel: "off_site_backup",
        attempts: 2,
        finalNotificationStatus: "timed_out",
        finalTicketStatus: "escalated",
        steps: {
          firstFailureRecorded: true,
          retryClaimableWithinBackoff: false,
          retryClaimedAfterBackoff: true,
          secondFailureEscalated: true,
        },
      });

      const snapshot = await store.getTicket(ticketId);
      expect(snapshot.status).toBe("escalated");
      const retried = snapshot.notifications.find((item) => item.channel === "off_site_backup");
      expect(retried).toMatchObject({
        status: "timed_out",
        attempts: 2,
        deliveredAt: null,
        viewedAt: null,
        acknowledgedAt: null,
      });

      const outbox = await transaction.selectFrom("risk_ticket_notification_outbox")
        .select(["channel", "status", "attempts", "delivered_at", "viewed_at", "acknowledged_at"])
        .where("ticket_id", "=", ticketId)
        .orderBy("channel", "asc")
        .execute();
      expect(outbox).toEqual([
        {
          channel: "in_app",
          status: "not_sent",
          attempts: 0,
          delivered_at: null,
          viewed_at: null,
          acknowledged_at: null,
        },
        {
          channel: "off_site_backup",
          status: "timed_out",
          attempts: 2,
          delivered_at: null,
          viewed_at: null,
          acknowledged_at: null,
        },
      ]);

      const events = await transaction.selectFrom("risk_ticket_events")
        .select(["action", "channel"])
        .where("ticket_id", "=", ticketId)
        .orderBy("occurred_at", "asc")
        .orderBy("id", "asc")
        .execute();
      expect(events).toEqual([
        { action: "record_send_attempted", channel: "off_site_backup" },
        { action: "record_failed", channel: "off_site_backup" },
        { action: "record_send_attempted", channel: "off_site_backup" },
        { action: "record_timed_out", channel: "off_site_backup" },
      ]);

      const claims = await transaction.selectFrom("risk_ticket_outbox_claims")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("ticket_id", "=", ticketId)
        .executeTakeFirstOrThrow();
      expect(Number(claims.count)).toBe(3);
    });
  });

  it("reports no due row without recording an event when every row is inside an active lease", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const clock = new Date("2026-09-17T11:10:00.000Z");
      await store.createTicket(createInput());
      const claimWorker = new RiskOutboxClaimWorker(transaction, () => clock);
      await claimWorker.claimNext({ requestId: randomUUID(), workerId });
      await claimWorker.claimNext({ requestId: randomUUID(), workerId });

      const result = await new RiskBackoffScheduleDrillRunner(transaction, () => clock)
        .runDrill({ requestId: randomUUID(), workerId });
      expect(result).toEqual({
        drill: "risk_notification_backoff_schedule",
        simulated: true,
        networkCallMade: false,
        sent: false,
        delivered: false,
        scheduled: false,
        reason: "no_due_row",
      });

      const eventCount = await transaction.selectFrom("risk_ticket_events")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow();
      expect(Number(eventCount.count)).toBe(0);
    });
  });

  it("rejects invalid drill requests without claiming or sending", async () => {
    await inRollback(async (transaction) => {
      const runner = new RiskBackoffScheduleDrillRunner(transaction);
      await expect(runner.runDrill({ requestId: "bad", workerId }))
        .rejects.toEqual(new RiskBackoffScheduleDrillError("RISK_BACKOFF_DRILL_INVALID"));
      await expect(runner.runDrill({ requestId: randomUUID(), workerId, leaseDurationMs: 500 }))
        .rejects.toEqual(new RiskBackoffScheduleDrillError("RISK_BACKOFF_DRILL_INVALID"));
    });
  });
});



