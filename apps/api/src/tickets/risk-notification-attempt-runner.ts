import { createHash } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import type { RiskNotificationChannel, RiskNotificationStatus, RiskTicketSnapshot } from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { LocalSyntheticNotificationAdapter } from "./local-synthetic-notification-adapter.js";
import { RiskOutboxClaimWorker } from "./risk-outbox-claim-worker.js";
import { RiskTicketStore } from "./risk-ticket-store.js";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export type RiskNotificationAttemptErrorCode =
  | "RISK_NOTIFICATION_ATTEMPT_INVALID"
  | "RISK_NOTIFICATION_ATTEMPT_IDEMPOTENCY_CONFLICT";

export class RiskNotificationAttemptError extends Error {
  constructor(readonly code: RiskNotificationAttemptErrorCode) {
    super(code);
    this.name = "RiskNotificationAttemptError";
  }
}

export interface RiskNotificationAttemptRequest {
  requestId: string;
  workerId: string;
  leaseDurationMs?: number;
  simulateFailure?: boolean;
}

export type RiskNotificationAttemptResult =
  | {
      claimed: true;
      attempted: true;
      sent: false;
      delivered: false;
      replayed: boolean;
      ticketId: string;
      outboxId: string;
      channel: RiskNotificationChannel;
      notificationStatus: "attempted" | "failed" | "timed_out";
      attempts: 1 | 2;
      requestId: string;
      workerId: string;
      attemptedAt: string;
      failureMode?: "local_simulated_failure";
    }
  | {
      claimed: false;
      attempted: false;
      sent: false;
      delivered: false;
    };

const DEFAULT_LEASE_MS = 10_000;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 30_000;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

function derivedRequestId(requestId: string, suffix: string): string {
  const hash = createHash("sha256").update(`${requestId}:${suffix}`, "utf8").digest("hex");
  const hex = `${hash.slice(0, 12)}5${hash.slice(13, 16)}8${hash.slice(17, 32)}`;
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

function attemptedResult(
  snapshot: RiskTicketSnapshot,
  input: {
    ticketId: string;
    outboxId: string;
    workerId: string;
    channel: RiskNotificationChannel;
    requestId: string;
    attemptedAt: string;
    replayed: boolean;
    failureMode?: "local_simulated_failure";
  },
): RiskNotificationAttemptResult {
  const notification = snapshot.notifications.find((item) => item.channel === input.channel);
  if (notification === undefined
    || (notification.status !== "attempted" && notification.status !== "failed" && notification.status !== "timed_out")
    || notification.attempts < 1 || notification.attempts > 2) {
    throw new RiskNotificationAttemptError("RISK_NOTIFICATION_ATTEMPT_INVALID");
  }
  return {
    claimed: true,
    attempted: true,
    sent: false,
    delivered: false,
    replayed: input.replayed,
    ticketId: input.ticketId,
    outboxId: input.outboxId,
    channel: input.channel,
    notificationStatus: notification.status,
    attempts: notification.attempts === 1 ? 1 : 2,
    requestId: input.requestId,
    workerId: input.workerId,
    attemptedAt: input.attemptedAt,
    ...(notification.status === "failed" || notification.status === "timed_out"
      ? { failureMode: "local_simulated_failure" as const }
      : {}),
  };
}

export class RiskNotificationAttemptRunner {
  constructor(
    private readonly database: DatabaseExecutor,
    private readonly adapter: LocalSyntheticNotificationAdapter = new LocalSyntheticNotificationAdapter(),
    private readonly now: () => Date = () => new Date(),
    private readonly adapterOutcome: "locally_attempted" | "local_simulated_failure" = "locally_attempted",
  ) {}

  async attemptNext(rawInput: unknown): Promise<RiskNotificationAttemptResult> {
    const request = this.parseRequest(rawInput);
    if (request === undefined) {
      throw new RiskNotificationAttemptError("RISK_NOTIFICATION_ATTEMPT_INVALID");
    }

    return this.inTransaction(async (transaction) => {
      const existingClaim = await transaction.selectFrom("risk_ticket_outbox_claims")
        .selectAll()
        .where("claim_request_id", "=", request.requestId)
        .executeTakeFirst();
      const existingEvent = existingClaim === undefined
        ? undefined
        : await transaction.selectFrom("risk_ticket_events")
          .selectAll()
          .where("request_id", "=", request.requestId)
          .orderBy("occurred_at", "desc")
          .orderBy("id", "desc")
          .executeTakeFirst();

      if (existingClaim !== undefined && existingEvent !== undefined) {
        if (existingClaim.worker_id !== request.workerId || existingEvent.channel === null) {
          throw new RiskNotificationAttemptError("RISK_NOTIFICATION_ATTEMPT_IDEMPOTENCY_CONFLICT");
        }
        const replayedFailed = await transaction.selectFrom("risk_ticket_events")
          .selectAll()
          .where("request_id", "=", derivedRequestId(request.requestId, "failed"))
          .executeTakeFirst();
        const replayedTimedOut = replayedFailed === undefined
          ? undefined
          : await transaction.selectFrom("risk_ticket_events")
            .selectAll()
            .where("request_id", "=", derivedRequestId(request.requestId, "timed_out"))
            .executeTakeFirst();
        const storedSnapshot = await new RiskTicketStore(transaction).getTicket(existingEvent.ticket_id);
        const snapshot = replayedFailed === undefined
          ? storedSnapshot
          : {
              ...storedSnapshot,
              notifications: storedSnapshot.notifications.map((notification) => notification.channel === existingEvent.channel
                ? {
                    ...notification,
                    status: (replayedTimedOut === undefined ? "failed" : "timed_out") as RiskNotificationStatus,
                  }
                : notification),
            };
        return attemptedResult(snapshot, {
          ticketId: existingEvent.ticket_id,
          outboxId: existingClaim.outbox_id,
          workerId: existingClaim.worker_id,
          channel: existingEvent.channel,
          requestId: request.requestId,
          attemptedAt: (replayedTimedOut ?? replayedFailed ?? existingEvent).occurred_at.toISOString(),
          replayed: true,
        });
      }

      const claim = await new RiskOutboxClaimWorker(transaction, this.now).claimNext({
        requestId: request.requestId,
        workerId: request.workerId,
        leaseDurationMs: request.leaseDurationMs,
      });
      if (!claim.claimed) return { claimed: false, attempted: false, sent: false, delivered: false };

      const simulateFailure = request.simulateFailure ?? this.adapterOutcome === "local_simulated_failure";
      const receipt = await this.adapter.attempt({
        synthetic: true,
        ticketId: claim.ticketId,
        outboxId: claim.outboxId,
        channel: claim.channel,
        claimRequestId: request.requestId,
        workerId: request.workerId,
        leaseToken: claim.leaseToken,
        ...(simulateFailure ? { failureMode: "local_simulated_failure" as const } : {}),
      });

      const store = new RiskTicketStore(transaction);
      const attemptedSnapshot = await store.applyEvent(claim.ticketId, {
        requestId: request.requestId,
        action: "record_send_attempted",
        channel: claim.channel,
        occurredAt: receipt.attemptedAt,
      });

      if (receipt.outcome === "local_simulated_failure") {
        const attemptedNotification = attemptedSnapshot.notifications.find((item) => item.channel === claim.channel);
        if (attemptedNotification?.attempts === 2) {
          const timedOut = await store.applyEvent(claim.ticketId, {
            requestId: derivedRequestId(request.requestId, "timed_out"),
            action: "record_timed_out",
            channel: claim.channel,
            occurredAt: new Date(new Date(receipt.attemptedAt).getTime() + 1).toISOString(),
          });
          return attemptedResult(timedOut, {
            ticketId: claim.ticketId,
            outboxId: claim.outboxId,
            workerId: request.workerId,
            channel: claim.channel,
            requestId: request.requestId,
            attemptedAt: receipt.attemptedAt,
            replayed: false,
          });
        }

        const failedAt = new Date(new Date(receipt.attemptedAt).getTime() + 1).toISOString();
        const failed = await store.applyEvent(claim.ticketId, {
          requestId: derivedRequestId(request.requestId, "failed"),
          action: "record_failed",
          channel: claim.channel,
          occurredAt: failedAt,
        });
        await transaction.updateTable("risk_ticket_notification_outbox")
          .set({
            lease_owner_id: null,
            leased_at: null,
            lease_expires_at: null,
            updated_at: new Date(failedAt),
          })
          .where("id", "=", claim.outboxId)
          .execute();
        return attemptedResult(failed, {
          ticketId: claim.ticketId,
          outboxId: claim.outboxId,
          workerId: request.workerId,
          channel: claim.channel,
          requestId: request.requestId,
          attemptedAt: receipt.attemptedAt,
          replayed: false,
        });
      }
      const snapshot = await store.getTicket(claim.ticketId);
      return attemptedResult(snapshot, {
        ticketId: claim.ticketId,
        outboxId: claim.outboxId,
        workerId: request.workerId,
        channel: claim.channel,
        requestId: request.requestId,
        attemptedAt: receipt.attemptedAt,
        replayed: false,
      });
    });
  }

  private parseRequest(rawInput: unknown): RiskNotificationAttemptRequest | undefined {
    if (rawInput === null || typeof rawInput !== "object") return undefined;
    const input = rawInput as Record<string, unknown>;
    if (!isUuid(input.requestId) || !isUuid(input.workerId)) return undefined;
    if (input.simulateFailure !== undefined && input.simulateFailure !== true) return undefined;
    const leaseDurationMs = input.leaseDurationMs === undefined
      ? DEFAULT_LEASE_MS
      : input.leaseDurationMs;
    if (typeof leaseDurationMs !== "number" || !Number.isInteger(leaseDurationMs)
      || leaseDurationMs < MIN_LEASE_MS || leaseDurationMs > MAX_LEASE_MS) {
      return undefined;
    }
    return {
      requestId: input.requestId,
      workerId: input.workerId,
      leaseDurationMs,
      ...(input.simulateFailure === true ? { simulateFailure: true as const } : {}),
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









