import { randomUUID } from "node:crypto";

import { type Kysely, type Transaction } from "kysely";

import { requestIdSchema } from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export type RiskOutboxClaimWorkerErrorCode =
  | "RISK_OUTBOX_CLAIM_INVALID"
  | "RISK_OUTBOX_CLAIM_IDEMPOTENCY_CONFLICT";

export class RiskOutboxClaimWorkerError extends Error {
  constructor(readonly code: RiskOutboxClaimWorkerErrorCode) {
    super(code);
    this.name = "RiskOutboxClaimWorkerError";
  }
}

export interface RiskOutboxClaimRequest {
  requestId: string;
  workerId: string;
  leaseDurationMs?: number;
}

export interface RiskOutboxClaim {
  claimed: true;
  sent: false;
  ticketId: string;
  outboxId: string;
  channel: "in_app" | "off_site_backup";
  notificationStatus: "not_sent" | "failed";
  attempts: 0 | 1;
  claimRequestId: string;
  workerId: string;
  leaseToken: string;
  leasedAt: string;
  leaseExpiresAt: string;
  leaseCount: number;
}

export type RiskOutboxClaimResult = RiskOutboxClaim | {
  claimed: false;
  sent: false;
};

const DEFAULT_LEASE_MS = 10_000;
const RETRY_BACKOFF_MS = 1_000;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 30_000;

function toIso(value: Date): string {
  return value.toISOString();
}

export class RiskOutboxClaimWorker {
  constructor(
    private readonly database: DatabaseExecutor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async claimNext(rawInput: unknown): Promise<RiskOutboxClaimResult> {
    const request = this.parseRequest(rawInput);
    if (request === undefined) throw new RiskOutboxClaimWorkerError("RISK_OUTBOX_CLAIM_INVALID");

    return this.inTransaction(async (transaction) => {
      const existing = await transaction.selectFrom("risk_ticket_outbox_claims")
        .selectAll()
        .where("claim_request_id", "=", request.requestId)
        .executeTakeFirst();
      if (existing !== undefined) {
        if (existing.worker_id !== request.workerId) {
          throw new RiskOutboxClaimWorkerError("RISK_OUTBOX_CLAIM_IDEMPOTENCY_CONFLICT");
        }
        const outbox = await transaction.selectFrom("risk_ticket_notification_outbox")
          .selectAll()
          .where("id", "=", existing.outbox_id)
          .executeTakeFirst();
        if (outbox === undefined) throw new RiskOutboxClaimWorkerError("RISK_OUTBOX_CLAIM_INVALID");
        const priorClaims = await transaction.selectFrom("risk_ticket_outbox_claims")
          .select(({ fn }) => fn.countAll<number>().as("count"))
          .where("outbox_id", "=", existing.outbox_id)
          .where("leased_at", "<=", existing.leased_at)
          .executeTakeFirstOrThrow();
        return this.toClaim(existing, outbox, Number(priorClaims.count));
      }

      const now = this.now();
      const expiresAt = new Date(now.getTime() + request.leaseDurationMs);
      const candidate = await transaction.selectFrom("risk_ticket_notification_outbox")
        .selectAll()
        .where((eb) => eb.or([
          eb.and([
            eb("status", "=", "not_sent"),
            eb.or([
              eb("lease_expires_at", "is", null),
              eb("lease_expires_at", "<", now),
            ]),
          ]),
          eb.and([
            eb("status", "=", "failed"),
            eb("attempts", "<", 2),
            eb.or([
              eb("lease_expires_at", "is", null),
              eb("lease_expires_at", "<", now),
            ]),
            eb("failed_at", "<=", new Date(now.getTime() - RETRY_BACKOFF_MS)),
          ]),
        ]))
        .orderBy("created_at", "asc")
        .orderBy("channel", "asc")
        .orderBy("id", "asc")
        .forUpdate()
        .skipLocked()
        .limit(1)
        .executeTakeFirst();

      if (candidate === undefined) return { claimed: false, sent: false };

      const claimId = randomUUID();
      const leaseToken = randomUUID();
      await transaction.insertInto("risk_ticket_outbox_claims").values({
        id: claimId,
        outbox_id: candidate.id,
        ticket_id: candidate.ticket_id,
        claim_request_id: request.requestId,
        worker_id: request.workerId,
        lease_token: leaseToken,
        leased_at: now,
        lease_expires_at: expiresAt,
        created_at: now,
      }).execute();

      await transaction.updateTable("risk_ticket_notification_outbox")
        .set((eb) => ({
          lease_owner_id: request.workerId,
          leased_at: now,
          lease_expires_at: expiresAt,
          lease_count: eb("lease_count", "+", 1),
          updated_at: now,
        }))
        .where("id", "=", candidate.id)
        .execute();

      return this.toClaim({
        id: claimId,
        outbox_id: candidate.id,
        ticket_id: candidate.ticket_id,
        claim_request_id: request.requestId,
        worker_id: request.workerId,
        lease_token: leaseToken,
        leased_at: now,
        lease_expires_at: expiresAt,
      }, {
        channel: candidate.channel,
        status: candidate.status,
        attempts: candidate.attempts,
        lease_count: candidate.lease_count + 1,
        failed_at: candidate.failed_at,
      });
    });
  }

  private parseRequest(rawInput: unknown): (RiskOutboxClaimRequest & { leaseDurationMs: number }) | undefined {
    if (rawInput === null || typeof rawInput !== "object") return undefined;
    const input = rawInput as Record<string, unknown>;
    const requestIdResult = requestIdSchema.safeParse(input.requestId);
    const workerIdResult = requestIdSchema.safeParse(input.workerId);
    if (!requestIdResult.success || !workerIdResult.success) return undefined;
    const leaseDurationMs = input.leaseDurationMs === undefined
      ? DEFAULT_LEASE_MS
      : input.leaseDurationMs;
    if (typeof leaseDurationMs !== "number" || !Number.isInteger(leaseDurationMs)
      || leaseDurationMs < MIN_LEASE_MS || leaseDurationMs > MAX_LEASE_MS) {
      return undefined;
    }
    return {
      requestId: requestIdResult.data,
      workerId: workerIdResult.data,
      leaseDurationMs,
    };
  }

  private toClaim(
    claim: {
      id: string;
      outbox_id: string;
      ticket_id: string;
      claim_request_id: string;
      worker_id: string;
      lease_token: string;
      leased_at: Date;
      lease_expires_at: Date;
    },
    outbox: {
      channel: "in_app" | "off_site_backup";
      status: "not_sent" | "attempted" | "delivered" | "viewed" | "acknowledged" | "failed" | "timed_out";
      attempts: number;
      lease_count: number;
      failed_at: Date | null;
    },
    replayAttemptNumber?: number,
  ): RiskOutboxClaim {
    if (replayAttemptNumber !== undefined) {
      if (replayAttemptNumber !== 1 && replayAttemptNumber !== 2) {
        throw new RiskOutboxClaimWorkerError("RISK_OUTBOX_CLAIM_INVALID");
      }
      var replayStatus = replayAttemptNumber === 1
        ? { status: "not_sent" as const, attempts: 0 as const }
        : { status: "failed" as const, attempts: 1 as const };
    } else {
      if ((outbox.status !== "not_sent" || outbox.attempts !== 0)
        && (outbox.status !== "failed" || outbox.attempts !== 1)) {
        throw new RiskOutboxClaimWorkerError("RISK_OUTBOX_CLAIM_INVALID");
      }
      var replayStatus = {
        status: outbox.status,
        attempts: outbox.attempts,
      } as { status: "not_sent"; attempts: 0 } | { status: "failed"; attempts: 1 };
    }
    return {
      claimed: true,
      sent: false,
      ticketId: claim.ticket_id,
      outboxId: claim.outbox_id,
      channel: outbox.channel,
      notificationStatus: replayStatus.status,
      attempts: replayStatus.attempts,
      claimRequestId: claim.claim_request_id,
      workerId: claim.worker_id,
      leaseToken: claim.lease_token,
      leasedAt: toIso(claim.leased_at),
      leaseExpiresAt: toIso(claim.lease_expires_at),
      leaseCount: outbox.lease_count,
    };
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






