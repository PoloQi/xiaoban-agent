import type { Kysely, Transaction } from "kysely";

import {
  requestIdSchema,
  type RiskNotificationChannel,
  type RiskTicketStatus,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { RiskTicketStore, RiskTicketStoreError } from "./risk-ticket-store.js";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export type RiskLocalReceiptErrorCode = "RISK_LOCAL_RECEIPT_INVALID";

export class RiskLocalReceiptError extends Error {
  constructor(readonly code: RiskLocalReceiptErrorCode) {
    super(code);
    this.name = "RiskLocalReceiptError";
  }
}

export interface RiskLocalReceiptRequest {
  requestId: string;
  ticketId: string;
  channel: RiskNotificationChannel;
}

export type RiskLocalReceiptResult =
  | {
      recorded: true;
      replayed: boolean;
      simulated: true;
      networkCallMade: false;
      ticketId: string;
      channel: RiskNotificationChannel;
      requestId: string;
      recordedAction: "record_delivered" | "record_viewed" | "record_acknowledged";
      channelStatus: "delivered" | "viewed" | "acknowledged";
      ticketStatus: RiskTicketStatus;
      occurredAt: string;
    }
  | {
      recorded: false;
      simulated: true;
      networkCallMade: false;
      ticketId: string;
      channel: RiskNotificationChannel;
      requestId: string;
      reason: "channel_already_acknowledged";
      channelStatus: "acknowledged";
      ticketStatus: RiskTicketStatus;
    };

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CHANNELS = ["in_app", "off_site_backup"] as const;

function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

const NEXT_SUCCESS_RECEIPT: Record<
  "attempted" | "delivered" | "viewed",
  { action: "record_delivered" | "record_viewed" | "record_acknowledged"; status: "delivered" | "viewed" | "acknowledged" }
> = {
  attempted: { action: "record_delivered", status: "delivered" },
  delivered: { action: "record_viewed", status: "viewed" },
  viewed: { action: "record_acknowledged", status: "acknowledged" },
};

export class RiskLocalReceiptRunner {
  constructor(
    private readonly database: DatabaseExecutor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async recordNext(rawInput: unknown): Promise<RiskLocalReceiptResult> {
    const request = this.parseRequest(rawInput);
    if (request === undefined) throw new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID");

    return this.inTransaction(async (transaction) => {
      const store = new RiskTicketStore(transaction);
      const readSnapshot = async () => {
        try {
          return await store.getTicket(request.ticketId);
        } catch (error) {
          if (error instanceof RiskTicketStoreError && error.code === "RISK_TICKET_NOT_FOUND") {
            throw new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID");
          }
          throw error;
        }
      };

      const existing = await transaction.selectFrom("risk_ticket_events")
        .select(["action", "occurred_at"])
        .where("ticket_id", "=", request.ticketId)
        .where("channel", "=", request.channel)
        .where("request_id", "=", request.requestId)
        .executeTakeFirst();
      if (existing !== undefined) {
        const step = this.stepForAction(existing.action);
        const replayed = await readSnapshot();
        return {
          recorded: true,
          replayed: true,
          simulated: true,
          networkCallMade: false,
          ticketId: request.ticketId,
          channel: request.channel,
          requestId: request.requestId,
          recordedAction: step.action,
          channelStatus: step.status,
          ticketStatus: replayed.status,
          occurredAt: existing.occurred_at.toISOString(),
        };
      }

      const snapshot = await readSnapshot();
      const notification = snapshot.notifications.find((item) => item.channel === request.channel);
      if (notification === undefined) {
        throw new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID");
      }
      if (notification.status === "acknowledged") {
        return {
          recorded: false,
          simulated: true,
          networkCallMade: false,
          ticketId: request.ticketId,
          channel: request.channel,
          requestId: request.requestId,
          reason: "channel_already_acknowledged",
          channelStatus: "acknowledged",
          ticketStatus: snapshot.status,
        };
      }

      const currentStatus = notification.status;
      if (currentStatus !== "attempted" && currentStatus !== "delivered" && currentStatus !== "viewed") {
        throw new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID");
      }
      const step = NEXT_SUCCESS_RECEIPT[currentStatus];
      const occurredAt = this.now().toISOString();
      const next = await store.applyEvent(request.ticketId, {
        requestId: request.requestId,
        action: step.action,
        channel: request.channel,
        occurredAt,
      });

      return {
        recorded: true,
        replayed: false,
        simulated: true,
        networkCallMade: false,
        ticketId: request.ticketId,
        channel: request.channel,
        requestId: request.requestId,
        recordedAction: step.action,
        channelStatus: step.status,
        ticketStatus: next.status,
        occurredAt,
      };
    });
  }

  private stepForAction(action: string) {
    const entry = Object.values(NEXT_SUCCESS_RECEIPT).find((step) => step.action === action);
    if (entry === undefined) throw new RiskLocalReceiptError("RISK_LOCAL_RECEIPT_INVALID");
    return entry;
  }

  private parseRequest(rawInput: unknown): RiskLocalReceiptRequest | undefined {
    if (rawInput === null || typeof rawInput !== "object") return undefined;
    const input = rawInput as Record<string, unknown>;
    if (Object.keys(input).sort().join(",") !== "channel,requestId,ticketId") return undefined;
    if (!isUuid(input.requestId) || !requestIdSchema.safeParse(input.ticketId).success) return undefined;
    if (!CHANNELS.includes(input.channel as RiskNotificationChannel)) return undefined;
    return {
      requestId: input.requestId as string,
      ticketId: input.ticketId as string,
      channel: input.channel as RiskNotificationChannel,
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


