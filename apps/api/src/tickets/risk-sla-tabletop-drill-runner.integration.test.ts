import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { Transaction } from "kysely";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import type { DatabaseSchema } from "../database/types.js";
import {
  RiskSlaTabletopDrillError,
  RiskSlaTabletopDrillRunner,
} from "./risk-sla-tabletop-drill-runner.js";
import { RiskTicketStore } from "./risk-ticket-store.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("SLA tabletop drill integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);
const workerId = randomUUID();

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

afterAll(async () => {
  await database.destroy();
});

describe("phase 6A.10 deterministic local risk SLA tabletop drill", () => {
  it("closes an L2 ticket within the 5m delivery / 15m acknowledgement SLAs", async () => {
    await inRollback(async (transaction) => {
      const runner = new RiskSlaTabletopDrillRunner(transaction);
      const result = await runner.runDrill({
        requestId: randomUUID(),
        workerId,
        level: "L2",
        scenario: "within_sla",
      });

      expect(result.drill).toBe("risk_sla_tabletop");
      expect(result.simulated).toBe(true);
      expect(result.networkCallMade).toBe(false);
      expect(result.sent).toBe(false);
      expect(result.delivered).toBe(true);
      expect(result.finalTicketStatus).toBe("closed");
      expect(result.slaMet).toBe(true);
      expect(result.checkpoints).toEqual([
        { key: "dual_channel_delivery", measuredMs: 90_000, limitMs: 300_000, pass: true },
        { key: "dual_channel_acknowledgement", measuredMs: 780_000, limitMs: 900_000, pass: true },
      ]);

      const snapshot = await new RiskTicketStore(transaction).getTicket(result.ticketId);
      expect(snapshot.notifications).toEqual([
        expect.objectContaining({ channel: "in_app", status: "acknowledged", attempts: 1 }),
        expect.objectContaining({ channel: "off_site_backup", status: "acknowledged", attempts: 1 }),
      ]);
      expect(snapshot.resolution).toMatch(/^虚构处置：/u);

      const events = await transaction.selectFrom("risk_ticket_events")
        .select("action").where("ticket_id", "=", result.ticketId)
        .orderBy("occurred_at", "asc").orderBy("id", "asc").execute();
      expect(events.map((event) => event.action)).toEqual([
        "record_send_attempted", "record_send_attempted",
        "record_delivered", "record_delivered",
        "record_viewed", "record_viewed",
        "record_acknowledged", "record_acknowledged",
        "resolve", "close",
      ]);
    });
  });

  it("closes an L3 ticket with immediate delivery and human review within 5m", async () => {
    await inRollback(async (transaction) => {
      const runner = new RiskSlaTabletopDrillRunner(transaction);
      const result = await runner.runDrill({
        requestId: randomUUID(),
        workerId,
        level: "L3",
        scenario: "within_sla",
      });

      expect(result.delivered).toBe(true);
      expect(result.finalTicketStatus).toBe("closed");
      expect(result.slaMet).toBe(true);
      expect(result.checkpoints).toEqual([
        { key: "dual_channel_delivery", measuredMs: 31_000, limitMs: 60_000, pass: true },
        { key: "immediate_human_review", measuredMs: 210_000, limitMs: 300_000, pass: true },
      ]);

      const events = await transaction.selectFrom("risk_ticket_events")
        .select("action").where("ticket_id", "=", result.ticketId)
        .orderBy("occurred_at", "asc").orderBy("id", "asc").execute();
      expect(events.map((event) => event.action)).toEqual([
        "record_send_attempted", "record_send_attempted",
        "record_delivered", "record_delivered",
        "record_viewed", "record_viewed",
        "record_acknowledged", "record_acknowledged",
        "escalate_for_immediate_human_review",
        "resolve", "close",
      ]);
    });
  });

  it("reports a breach with escalation when the backup channel fails twice", async () => {
    await inRollback(async (transaction) => {
      const runner = new RiskSlaTabletopDrillRunner(transaction);
      const result = await runner.runDrill({
        requestId: randomUUID(),
        workerId,
        level: "L2",
        scenario: "breach",
      });

      expect(result.delivered).toBe(false);
      expect(result.finalTicketStatus).toBe("escalated");
      expect(result.slaMet).toBe(false);
      expect(result.checkpoints).toEqual([
        { key: "dual_channel_delivery", measuredMs: null, limitMs: 300_000, pass: false },
        { key: "dual_channel_acknowledgement", measuredMs: null, limitMs: 900_000, pass: false },
      ]);

      const outbox = await transaction.selectFrom("risk_ticket_notification_outbox")
        .select(["channel", "status", "attempts"])
        .where("ticket_id", "=", result.ticketId)
        .orderBy("channel", "asc").execute();
      expect(outbox).toEqual([
        { channel: "in_app", status: "not_sent", attempts: 0 },
        { channel: "off_site_backup", status: "timed_out", attempts: 2 },
      ]);
    });
  });

  it("rejects invalid drill requests without creating a ticket", async () => {
    await inRollback(async (transaction) => {
      const runner = new RiskSlaTabletopDrillRunner(transaction);
      await expect(runner.runDrill({ requestId: "bad", workerId, level: "L2", scenario: "within_sla" }))
        .rejects.toEqual(new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID"));
      await expect(runner.runDrill({ requestId: randomUUID(), workerId, level: "L1", scenario: "within_sla" }))
        .rejects.toEqual(new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID"));
      await expect(runner.runDrill({ requestId: randomUUID(), workerId, level: "L3", scenario: "on_time" }))
        .rejects.toEqual(new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID"));

      const count = await transaction.selectFrom("risk_tickets")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .executeTakeFirstOrThrow();
      expect(Number(count.count)).toBe(0);
    });
  });
});
