import { randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { Transaction } from "kysely";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import type { DatabaseSchema } from "../database/types.js";
import { RiskTicketStore } from "./risk-ticket-store.js";
import {
  RiskOutboxClaimWorker,
  RiskOutboxClaimWorkerError,
} from "./risk-outbox-claim-worker.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Outbox claim integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);
const createdAt = "2026-09-16T12:00:00.000Z";

class RollbackTestTransaction extends Error {}

function createInput() {
  return {
    requestId: randomUUID(),
    synthetic: true as const,
    caseReference: `synthetic-risk-claim-${randomUUID()}`,
    level: "L2" as const,
    primaryCategory: "bullying" as const,
    createdAt,
  };
}

function claimRequest(overrides: Partial<{ workerId: string; leaseDurationMs: number }> = {}) {
  return {
    requestId: randomUUID(),
    workerId: overrides.workerId ?? randomUUID(),
    ...(overrides.leaseDurationMs === undefined
      ? {}
      : { leaseDurationMs: overrides.leaseDurationMs }),
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

describe("phase 6A.3 risk outbox claim worker (claim only, never send)", () => {
  it("claims a not-sent outbox row with a lease without changing notification status or attempts", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const worker = new RiskOutboxClaimWorker(transaction, () => new Date(createdAt));
      const ticket = await store.createTicket(createInput());
      const request = claimRequest();

      const result = await worker.claimNext(request);
      if (!result.claimed) throw new Error("expected an outbox claim");
      expect(result).toMatchObject({
        claimed: true,
        sent: false,
        ticketId: (
          await transaction.selectFrom("risk_tickets").select("id")
            .where("case_reference", "=", ticket.caseReference)
            .executeTakeFirstOrThrow()
        ).id,
        notificationStatus: "not_sent",
        attempts: 0,
        claimRequestId: request.requestId,
        workerId: request.workerId,
        leaseCount: 1,
      });

      const row = await transaction.selectFrom("risk_ticket_notification_outbox")
        .selectAll().where("id", "=", result.outboxId).executeTakeFirstOrThrow();
      expect(row.status).toBe("not_sent");
      expect(row.attempts).toBe(0);
      expect(row.lease_owner_id).toBe(request.workerId);
      expect(row.lease_count).toBe(1);
      expect(row.lease_expiresAt ?? row.lease_expires_at).toBeDefined();

      const claimCount = await transaction.selectFrom("risk_ticket_outbox_claims")
        .select(({ fn }) => fn.countAll<number>().as("count"))
        .where("outbox_id", "=", result.outboxId)
        .executeTakeFirstOrThrow();
      expect(Number(claimCount.count)).toBe(1);
    });
  });

  it("replays the same claim request idempotently and rejects a different worker on that request", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const worker = new RiskOutboxClaimWorker(transaction, () => new Date(createdAt));
      await store.createTicket(createInput());
      const request = claimRequest();

      const first = await worker.claimNext(request);
      const replayed = await worker.claimNext(request);
      expect(replayed).toEqual(first);

      const rows = await transaction.selectFrom("risk_ticket_outbox_claims")
        .select("id").where("claim_request_id", "=", request.requestId).execute();
      expect(rows).toHaveLength(1);

      await expect(worker.claimNext({
        ...request,
        workerId: randomUUID(),
      })).rejects.toEqual(
        new RiskOutboxClaimWorkerError("RISK_OUTBOX_CLAIM_IDEMPOTENCY_CONFLICT"),
      );
      await expect(worker.claimNext({ requestId: "not-a-uuid", workerId: randomUUID() }))
        .rejects.toEqual(new RiskOutboxClaimWorkerError("RISK_OUTBOX_CLAIM_INVALID"));
      await expect(worker.claimNext(claimRequest({ leaseDurationMs: 500 })))
        .rejects.toEqual(new RiskOutboxClaimWorkerError("RISK_OUTBOX_CLAIM_INVALID"));
    });
  });

  it("claims each available row once, reports no work when both leases are active, and reclaims an expired lease", async () => {
    await inRollback(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const worker = new RiskOutboxClaimWorker(transaction, () => new Date(createdAt));
      const ticket = await store.createTicket(createInput());
      const ticketId = (await transaction.selectFrom("risk_tickets").select("id")
        .where("case_reference", "=", ticket.caseReference).executeTakeFirstOrThrow()).id;

      const first = await worker.claimNext(claimRequest());
      const second = await worker.claimNext(claimRequest());
      if (!first.claimed || !second.claimed) throw new Error("expected two claims");
      expect(first.outboxId).not.toBe(second.outboxId);
      expect([first.channel, second.channel].sort()).toEqual(["in_app", "off_site_backup"]);
      expect(await worker.claimNext(claimRequest())).toEqual({ claimed: false, sent: false });

      const expiredAt = new Date("2026-09-16T11:59:59.000Z");
      await transaction.updateTable("risk_ticket_notification_outbox")
        .set({ lease_expires_at: expiredAt })
        .where("id", "=", first.outboxId)
        .execute();

      const reclaimed = await worker.claimNext(claimRequest());
      if (!reclaimed.claimed) throw new Error("expected expired lease reclaim");
      expect(reclaimed.outboxId).toBe(first.outboxId);
      expect(reclaimed.leaseCount).toBe(2);
      expect(reclaimed.notificationStatus).toBe("not_sent");
      expect(reclaimed.attempts).toBe(0);

      const firstRow = await transaction.selectFrom("risk_ticket_notification_outbox")
        .select(["status", "attempts", "lease_count"])
        .where("id", "=", first.outboxId)
        .executeTakeFirstOrThrow();
      expect(firstRow).toEqual({ status: "not_sent", attempts: 0, lease_count: 2 });

      const claimRows = await transaction.selectFrom("risk_ticket_outbox_claims")
        .select(["id", "lease_token"])
        .where("ticket_id", "=", ticketId)
        .orderBy("leased_at", "asc")
        .orderBy("id", "asc")
        .execute();
      expect(claimRows).toHaveLength(3);
      const claimId = claimRows[0]!.id;

      await expect(transaction.updateTable("risk_ticket_outbox_claims")
        .set({ worker_id: randomUUID() }).where("id", "=", claimId).execute())
        .rejects.toThrow();
      await expect(transaction.deleteFrom("risk_ticket_outbox_claims")
        .where("id", "=", claimId).execute())
        .rejects.toThrow();
    });
  });

  it("uses FOR UPDATE SKIP LOCKED so a second connection claims the other row", async () => {
    const store = new RiskTicketStore(database);
    const ticket = await store.createTicket(createInput());
    const ticketRow = await database.selectFrom("risk_tickets").select("id")
      .where("case_reference", "=", ticket.caseReference).executeTakeFirstOrThrow();
    try {
      await database.transaction().execute(async (transaction) => {
        const locked = await transaction.selectFrom("risk_ticket_notification_outbox")
          .select("id")
          .where("status", "=", "not_sent")
          .orderBy("created_at", "asc")
          .orderBy("channel", "asc")
          .orderBy("id", "asc")
          .forUpdate()
          .skipLocked()
          .limit(1)
          .executeTakeFirstOrThrow();

        const concurrent = await new RiskOutboxClaimWorker(database, () => new Date(createdAt))
          .claimNext(claimRequest({ leaseDurationMs: 5_000 }));
        if (!concurrent.claimed) throw new Error("expected concurrent claim to skip the lock");
        expect(concurrent.sent).toBe(false);
        expect(concurrent.notificationStatus).toBe("not_sent");
        expect(concurrent.attempts).toBe(0);
        expect(concurrent.outboxId).not.toBe(locked.id);
      });

      const outbox = await database.selectFrom("risk_ticket_notification_outbox")
        .select(["channel", "status", "attempts", "lease_count"])
        .where("ticket_id", "=", ticketRow.id)
        .orderBy("channel", "asc")
        .execute();
      expect(outbox).toHaveLength(2);
      expect(outbox.every((row) => row.status === "not_sent" && row.attempts === 0)).toBe(true);
      expect(outbox.map((row) => row.lease_count).sort()).toEqual([0, 1]);
    } finally {
      await database.deleteFrom("risk_tickets")
        .where("id", "=", ticketRow.id).execute();
    }
  });

  it("does not leave synthetic claim data after the rolled-back and cleaned tests", async () => {
    const tickets = await database.selectFrom("risk_tickets")
      .select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    const outbox = await database.selectFrom("risk_ticket_notification_outbox")
      .select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    const claims = await database.selectFrom("risk_ticket_outbox_claims")
      .select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    expect(Number(tickets.count)).toBe(0);
    expect(Number(outbox.count)).toBe(0);
    expect(Number(claims.count)).toBe(0);
  });
});