import { randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import { requestIdSchema } from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { LocalSyntheticNotificationAdapter } from "./local-synthetic-notification-adapter.js";
import { RiskLocalReceiptRunner } from "./risk-local-receipt-runner.js";
import { RiskNotificationAttemptRunner } from "./risk-notification-attempt-runner.js";
import { RiskOutboxClaimWorker } from "./risk-outbox-claim-worker.js";
import { RiskTicketStore } from "./risk-ticket-store.js";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export type RiskSlaTabletopDrillErrorCode = "RISK_SLA_TABLETOP_DRILL_INVALID";

export class RiskSlaTabletopDrillError extends Error {
  constructor(readonly code: RiskSlaTabletopDrillErrorCode) {
    super(code);
    this.name = "RiskSlaTabletopDrillError";
  }
}

export interface RiskSlaTabletopDrillRequest {
  requestId: string;
  workerId: string;
  level: "L2" | "L3";
  scenario: "within_sla" | "breach";
  leaseDurationMs?: number;
}

export interface RiskSlaCheckpointResult {
  key: "dual_channel_delivery" | "dual_channel_acknowledgement" | "immediate_human_review";
  measuredMs: number | null;
  limitMs: number;
  pass: boolean;
}

export interface RiskSlaTabletopDrillResult {
  drill: "risk_sla_tabletop";
  simulated: true;
  networkCallMade: false;
  sent: false;
  delivered: boolean;
  ticketId: string;
  caseReference: string;
  level: "L2" | "L3";
  scenario: "within_sla" | "breach";
  finalTicketStatus: string;
  startedAt: string;
  checkpoints: RiskSlaCheckpointResult[];
  slaMet: boolean;
}

const DEFAULT_LEASE_MS = 10_000;
const MIN_LEASE_MS = 1_000;
const MAX_LEASE_MS = 30_000;
const RETRY_BACKOFF_MS = 1_000;

// PRD V0.4 §9 suggested SLAs. The L3 "immediate delivery" proxy (60s) is a
// local drill interpretation only, not a production SLA commitment.
const LIMITS = {
  L2: { deliveryMs: 5 * 60_000, acknowledgementMs: 15 * 60_000 },
  L3: { deliveryMs: 60_000, humanReviewMs: 5 * 60_000 },
} as const;

const ANCHOR = new Date("2026-09-18T00:00:00.000Z");
const DRILL_NOTE = "虚构处置：SLA桌面演练工单按剧本完成闭环";

export class RiskSlaTabletopDrillRunner {
  constructor(private readonly database: DatabaseExecutor) {}

  async runDrill(rawInput: unknown): Promise<RiskSlaTabletopDrillResult> {
    const request = this.parseRequest(rawInput);
    if (request === undefined) {
      throw new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID");
    }

    return this.inTransaction(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      let clock = new Date(ANCHOR.getTime());
      const now = () => clock;
      const advance = (ms: number): Date => {
        clock = new Date(clock.getTime() + ms);
        return clock;
      };

      const created = await store.createTicket({
        requestId: randomUUID(),
        synthetic: true as const,
        caseReference: `synthetic-risk-sla-${randomUUID()}`,
        level: request.level,
        primaryCategory: request.level === "L2" ? "bullying" : "active_danger",
        createdAt: clock.toISOString(),
      });
      const ticketId = (await transaction.selectFrom("risk_tickets").select("id")
        .where("case_reference", "=", created.caseReference)
        .executeTakeFirstOrThrow()).id;

      if (request.scenario === "breach") {
        return this.runBreach({ transaction, store, request, ticketId,
          caseReference: created.caseReference, now, advance });
      }
      return this.runWithinSla({ transaction, store, request, ticketId,
        caseReference: created.caseReference, now, advance });
    });
  }

  private async runWithinSla(args: {
    transaction: Transaction<DatabaseSchema>;
    store: RiskTicketStore;
    request: RiskSlaTabletopDrillRequest & { leaseDurationMs: number };
    ticketId: string;
    caseReference: string;
    now: () => Date;
    advance: (ms: number) => Date;
  }): Promise<RiskSlaTabletopDrillResult> {
    const { store, request, ticketId, caseReference, now } = args;
    const successAdapter = new LocalSyntheticNotificationAdapter(now);
    const attemptRunner = new RiskNotificationAttemptRunner(
      args.transaction,
      successAdapter,
      now,
    );
    const receiptRunner = new RiskLocalReceiptRunner(args.transaction, now);
    const anchor = now().getTime();
    const jumpTo = (offsetMs: number): Date => {
      args.advance(anchor + offsetMs - now().getTime());
      return now();
    };

    // L2 timeline (PRD V0.4 §9: 5m delivery, 15m acknowledgement):
    //   attempted 15s/16s, delivered 60s/90s, viewed 4m/5m, ack 12m/13m.
    // L3 timeline (immediate delivery proxy 60s, 5m human response):
    //   attempted 10s/11s, delivered 30s/31s, viewed 100s/101s,
    //   ack 200s/201s, immediate human review at 210s.
    const l2 = request.level === "L2";
    const attemptSchedule = l2 ? [15_000, 16_000] : [10_000, 11_000];
    const receiptSchedule: Array<{ channel: "in_app" | "off_site_backup"; offsetMs: number }> = l2
      ? [
          { channel: "in_app", offsetMs: 60_000 },
          { channel: "off_site_backup", offsetMs: 90_000 },
          { channel: "in_app", offsetMs: 240_000 },
          { channel: "off_site_backup", offsetMs: 300_000 },
          { channel: "in_app", offsetMs: 720_000 },
          { channel: "off_site_backup", offsetMs: 780_000 },
        ]
      : [
          { channel: "in_app", offsetMs: 30_000 },
          { channel: "off_site_backup", offsetMs: 31_000 },
          { channel: "in_app", offsetMs: 100_000 },
          { channel: "off_site_backup", offsetMs: 101_000 },
          { channel: "in_app", offsetMs: 200_000 },
          { channel: "off_site_backup", offsetMs: 201_000 },
        ];
    const humanReviewOffsetMs = l2 ? null : 210_000;
    const resolveOffsetMs = l2 ? 840_000 : 360_000;

    for (const offsetMs of attemptSchedule) {
      jumpTo(offsetMs);
      const attempted = await attemptRunner.attemptNext({
        requestId: randomUUID(),
        workerId: request.workerId,
        leaseDurationMs: request.leaseDurationMs,
      });
      if (!attempted.claimed || attempted.notificationStatus !== "attempted") {
        throw new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID");
      }
    }

    for (const step of receiptSchedule) {
      jumpTo(step.offsetMs);
      await receiptRunner.recordNext({
        requestId: randomUUID(),
        ticketId,
        channel: step.channel,
      });
    }

    const acknowledged = await store.getTicket(ticketId);
    const deliveredAt = acknowledged.notifications.map((item) => item.deliveredAt);
    const acknowledgedAt = acknowledged.notifications.map((item) => item.acknowledgedAt);
    if (acknowledged.status !== "acknowledged"
      || deliveredAt.some((value) => value === null)
      || acknowledgedAt.some((value) => value === null)) {
      throw new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID");
    }

    let humanReviewAt: string | null = null;
    if (!l2) {
      humanReviewAt = jumpTo(humanReviewOffsetMs as number).toISOString();
      await store.applyEvent(ticketId, {
        requestId: randomUUID(),
        action: "escalate_for_immediate_human_review",
        occurredAt: humanReviewAt,
      });
    }

    jumpTo(resolveOffsetMs);
    await store.applyEvent(ticketId, {
      requestId: randomUUID(),
      action: "resolve",
      dispositionNote: DRILL_NOTE,
      occurredAt: now().toISOString(),
    });
    jumpTo(resolveOffsetMs + 1_000);
    await store.applyEvent(ticketId, {
      requestId: randomUUID(),
      action: "close",
      occurredAt: now().toISOString(),
    });

    const final = await store.getTicket(ticketId);
    if (final.status !== "closed") {
      throw new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID");
    }

    const t0 = new Date(acknowledged.createdAt).getTime();
    const deliveryMeasured = Math.max(
      ...deliveredAt.map((value) => new Date(value as string).getTime() - t0),
    );
    const acknowledgementMeasured = Math.max(
      ...acknowledgedAt.map((value) => new Date(value as string).getTime() - t0),
    );
    const checkpoints: RiskSlaCheckpointResult[] = request.level === "L2"
      ? [
          checkpoint("dual_channel_delivery", deliveryMeasured, LIMITS.L2.deliveryMs),
          checkpoint("dual_channel_acknowledgement", acknowledgementMeasured, LIMITS.L2.acknowledgementMs),
        ]
      : [
          checkpoint("dual_channel_delivery", deliveryMeasured, LIMITS.L3.deliveryMs),
          checkpoint("immediate_human_review",
            new Date(humanReviewAt as string).getTime() - t0, LIMITS.L3.humanReviewMs),
        ];

    return this.result({
      ticketId, caseReference, level: request.level, scenario: request.scenario,
      finalTicketStatus: final.status, startedAt: acknowledged.createdAt,
      delivered: true, checkpoints,
    });
  }

  private async runBreach(args: {
    transaction: Transaction<DatabaseSchema>;
    store: RiskTicketStore;
    request: RiskSlaTabletopDrillRequest & { leaseDurationMs: number };
    ticketId: string;
    caseReference: string;
    now: () => Date;
    advance: (ms: number) => Date;
  }): Promise<RiskSlaTabletopDrillResult> {
    const { transaction, store, request, ticketId, caseReference, now, advance } = args;
    const claimWorker = new RiskOutboxClaimWorker(transaction, now);
    const failureAdapter = new LocalSyntheticNotificationAdapter(now, "local_simulated_failure");
    const attemptRunner = new RiskNotificationAttemptRunner(
      transaction,
      failureAdapter,
      now,
      "local_simulated_failure",
    );

    // Pin the in_app row so the drill exercises the same failing backup row.
    await claimWorker.claimNext({
      requestId: randomUUID(),
      workerId: request.workerId,
      leaseDurationMs: request.leaseDurationMs,
    });
    advance(1);
    const firstFailure = await attemptRunner.attemptNext({
      requestId: request.requestId,
      workerId: request.workerId,
      leaseDurationMs: request.leaseDurationMs,
      simulateFailure: true,
    });
    if (!("claimed" in firstFailure) || !firstFailure.claimed
      || firstFailure.notificationStatus !== "failed") {
      throw new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID");
    }

    advance(RETRY_BACKOFF_MS);
    const withinBackoff = await claimWorker.claimNext({
      requestId: randomUUID(),
      workerId: request.workerId,
      leaseDurationMs: request.leaseDurationMs,
    });
    if (withinBackoff.claimed) {
      throw new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID");
    }
    advance(1);
    const secondFailure = await attemptRunner.attemptNext({
      requestId: randomUUID(),
      workerId: request.workerId,
      leaseDurationMs: request.leaseDurationMs,
      simulateFailure: true,
    });
    if (!("claimed" in secondFailure) || !secondFailure.claimed
      || secondFailure.notificationStatus !== "timed_out") {
      throw new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID");
    }

    const final = await store.getTicket(ticketId);
    if (final.status !== "escalated") {
      throw new RiskSlaTabletopDrillError("RISK_SLA_TABLETOP_DRILL_INVALID");
    }

    const deliveryLimit = request.level === "L2" ? LIMITS.L2.deliveryMs : LIMITS.L3.deliveryMs;
    const checkpoints: RiskSlaCheckpointResult[] = request.level === "L2"
      ? [
          { key: "dual_channel_delivery", measuredMs: null, limitMs: deliveryLimit, pass: false },
          { key: "dual_channel_acknowledgement", measuredMs: null,
            limitMs: LIMITS.L2.acknowledgementMs, pass: false },
        ]
      : [
          { key: "dual_channel_delivery", measuredMs: null, limitMs: deliveryLimit, pass: false },
          { key: "immediate_human_review", measuredMs: null,
            limitMs: LIMITS.L3.humanReviewMs, pass: false },
        ];

    return this.result({
      ticketId, caseReference, level: request.level, scenario: request.scenario,
      finalTicketStatus: final.status, startedAt: final.createdAt,
      delivered: false, checkpoints,
    });
  }

  private result(input: {
    ticketId: string;
    caseReference: string;
    level: "L2" | "L3";
    scenario: "within_sla" | "breach";
    finalTicketStatus: string;
    startedAt: string;
    delivered: boolean;
    checkpoints: RiskSlaCheckpointResult[];
  }): RiskSlaTabletopDrillResult {
    return {
      drill: "risk_sla_tabletop",
      simulated: true,
      networkCallMade: false,
      sent: false,
      delivered: input.delivered,
      ticketId: input.ticketId,
      caseReference: input.caseReference,
      level: input.level,
      scenario: input.scenario,
      finalTicketStatus: input.finalTicketStatus,
      startedAt: input.startedAt,
      checkpoints: input.checkpoints,
      slaMet: input.checkpoints.every((item) => item.pass),
    };
  }

  private parseRequest(rawInput: unknown):
    (RiskSlaTabletopDrillRequest & { leaseDurationMs: number }) | undefined {
    if (rawInput === null || typeof rawInput !== "object") return undefined;
    const input = rawInput as Record<string, unknown>;
    if (!Object.keys(input).every((key) =>
      ["requestId", "workerId", "level", "scenario", "leaseDurationMs"].includes(key))) {
      return undefined;
    }
    const requestIdResult = requestIdSchema.safeParse(input.requestId);
    const workerIdResult = requestIdSchema.safeParse(input.workerId);
    if (!requestIdResult.success || !workerIdResult.success) return undefined;
    if (input.level !== "L2" && input.level !== "L3") return undefined;
    if (input.scenario !== "within_sla" && input.scenario !== "breach") return undefined;
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
      level: input.level,
      scenario: input.scenario,
      leaseDurationMs,
    };
  }

  private async inTransaction<T>(run: (transaction: Transaction<DatabaseSchema>) => Promise<T>): Promise<T> {
    if (this.database.isTransaction) return run(this.database as Transaction<DatabaseSchema>);
    return this.database.transaction().execute(run);
  }
}

function checkpoint(
  key: RiskSlaCheckpointResult["key"],
  measuredMs: number,
  limitMs: number,
): RiskSlaCheckpointResult {
  return { key, measuredMs, limitMs, pass: measuredMs <= limitMs };
}
