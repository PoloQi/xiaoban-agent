import { randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import { requestIdSchema } from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { LocalSyntheticNotificationAdapter } from "./local-synthetic-notification-adapter.js";
import { RiskNotificationAttemptRunner } from "./risk-notification-attempt-runner.js";
import { RiskOutboxClaimWorker } from "./risk-outbox-claim-worker.js";
import { RiskTicketStore } from "./risk-ticket-store.js";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export type RiskBackoffScheduleDrillErrorCode = "RISK_BACKOFF_DRILL_INVALID";

export class RiskBackoffScheduleDrillError extends Error {
  constructor(readonly code: RiskBackoffScheduleDrillErrorCode) {
    super(code);
    this.name = "RiskBackoffScheduleDrillError";
  }
}

export interface RiskBackoffScheduleDrillRequest {
  requestId: string;
  workerId: string;
  leaseDurationMs?: number;
}

export type RiskBackoffScheduleDrillResult = {
  drill: "risk_notification_backoff_schedule";
  simulated: true;
  networkCallMade: false;
  sent: false;
  delivered: false;
  ticketId: string;
  channel: "in_app" | "off_site_backup";
  attempts: 2;
  finalNotificationStatus: "timed_out";
  finalTicketStatus: "escalated";
  steps: {
    firstFailureRecorded: true;
    retryClaimableWithinBackoff: false;
    retryClaimedAfterBackoff: true;
    secondFailureEscalated: true;
  };
} | {
  drill: "risk_notification_backoff_schedule";
  simulated: true;
  networkCallMade: false;
  sent: false;
  delivered: false;
  scheduled: false;
  reason: "no_due_row";
};

const DEFAULT_LEASE_MS = 10_000;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 30_000;
const RETRY_BACKOFF_MS = 1_000;
const DRILL_STEP_GAP_MS = 1;

export class RiskBackoffScheduleDrillRunner {
  constructor(
    private readonly database: DatabaseExecutor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async runDrill(rawInput: unknown): Promise<RiskBackoffScheduleDrillResult> {
    const request = this.parseRequest(rawInput);
    if (request === undefined) throw new RiskBackoffScheduleDrillError("RISK_BACKOFF_DRILL_INVALID");

    return this.inTransaction(async (transaction) => {
      let clock = this.now();

      const claimWorker = new RiskOutboxClaimWorker(transaction, () => clock);
      const attemptRunner = new RiskNotificationAttemptRunner(
        transaction,
        new LocalSyntheticNotificationAdapter(() => clock, "local_simulated_failure"),
        () => clock,
        "local_simulated_failure",
      );

      // The two channels share one ticket. Pin the backup channel with an active
      // lease so the deterministic drill proves backoff for the same failed row,
      // rather than simply moving on to the other never-sent channel.
      await claimWorker.claimNext({
        requestId: randomUUID(),
        workerId: request.workerId,
        leaseDurationMs: request.leaseDurationMs,
      });

      const firstClaim = await claimWorker.claimNext({
        requestId: request.requestId,
        workerId: request.workerId,
        leaseDurationMs: request.leaseDurationMs,
      });
      if (!firstClaim.claimed) {
        return {
          drill: "risk_notification_backoff_schedule",
          simulated: true,
          networkCallMade: false,
          sent: false,
          delivered: false,
          scheduled: false,
          reason: "no_due_row",
        };
      }

      clock = new Date(clock.getTime() + DRILL_STEP_GAP_MS);
      const firstFailure = await attemptRunner.attemptNext({
        requestId: request.requestId,
        workerId: request.workerId,
        leaseDurationMs: request.leaseDurationMs,
        simulateFailure: true,
      });
      if (!("claimed" in firstFailure) || !firstFailure.claimed
        || firstFailure.notificationStatus !== "failed" || firstFailure.attempts !== 1) {
        throw new RiskBackoffScheduleDrillError("RISK_BACKOFF_DRILL_INVALID");
      }

      // Attempted at T1; the attempt runner records failed_at = T1 + 1ms.
      // At T1 + backoff the eligibility threshold (now - backoff = T1) is still 1ms before failed_at.
      clock = new Date(clock.getTime() + RETRY_BACKOFF_MS);
      const withinBackoff = await claimWorker.claimNext({
        requestId: randomUUID(),
        workerId: request.workerId,
        leaseDurationMs: request.leaseDurationMs,
      });
      if (withinBackoff.claimed) {
        throw new RiskBackoffScheduleDrillError("RISK_BACKOFF_DRILL_INVALID");
      }

      clock = new Date(clock.getTime() + 1);
      const retryClaim = await claimWorker.claimNext({
        requestId: randomUUID(),
        workerId: request.workerId,
        leaseDurationMs: request.leaseDurationMs,
      });
      if (!retryClaim.claimed || retryClaim.outboxId !== firstClaim.outboxId
        || retryClaim.notificationStatus !== "failed" || retryClaim.attempts !== 1) {
        throw new RiskBackoffScheduleDrillError("RISK_BACKOFF_DRILL_INVALID");
      }

      clock = new Date(clock.getTime() + DRILL_STEP_GAP_MS);
      const secondFailure = await attemptRunner.attemptNext({
        requestId: retryClaim.claimRequestId,
        workerId: request.workerId,
        leaseDurationMs: request.leaseDurationMs,
        simulateFailure: true,
      });
      if (!("claimed" in secondFailure) || !secondFailure.claimed
        || secondFailure.notificationStatus !== "timed_out" || secondFailure.attempts !== 2) {
        throw new RiskBackoffScheduleDrillError("RISK_BACKOFF_DRILL_INVALID");
      }

      const ticket = await new RiskTicketStore(transaction).getTicket(firstClaim.ticketId);
      if (ticket.status !== "escalated") {
        throw new RiskBackoffScheduleDrillError("RISK_BACKOFF_DRILL_INVALID");
      }

      return {
        drill: "risk_notification_backoff_schedule",
        simulated: true,
        networkCallMade: false,
        sent: false,
        delivered: false,
        ticketId: firstClaim.ticketId,
        channel: firstClaim.channel,
        attempts: 2,
        finalNotificationStatus: "timed_out",
        finalTicketStatus: "escalated",
        steps: {
          firstFailureRecorded: true,
          retryClaimableWithinBackoff: false,
          retryClaimedAfterBackoff: true,
          secondFailureEscalated: true,
        },
      };
    });
  }

  private parseRequest(rawInput: unknown): (RiskBackoffScheduleDrillRequest & { leaseDurationMs: number }) | undefined {
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

  private async inTransaction<T>(run: (transaction: Transaction<DatabaseSchema>) => Promise<T>): Promise<T> {
    if (this.database.isTransaction) return run(this.database as Transaction<DatabaseSchema>);
    return this.database.transaction().execute(run);
  }
}





