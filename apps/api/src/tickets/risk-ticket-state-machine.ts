import {
  RISK_TICKET_SCHEMA_VERSION,
  riskTicketCreateRequestSchema,
  riskTicketEventSchema,
  riskTicketSnapshotSchema,
  type RiskNotificationPlan,
  type RiskNotificationStatus,
  type RiskTicketCreateRequest,
  type RiskTicketEvent,
  type RiskTicketSnapshot,
  type RiskTicketStatus,
} from "@xiaoban/contracts";

export type RiskTicketErrorCode =
  | "RISK_TICKET_REQUEST_INVALID"
  | "RISK_TICKET_EVENT_INVALID"
  | "RISK_TICKET_INVALID_TRANSITION";

export class RiskTicketStateError extends Error {
  constructor(readonly code: RiskTicketErrorCode) {
    super(code);
    this.name = "RiskTicketStateError";
  }
}

const CHANNELS = ["in_app", "off_site_backup"] as const;

function freshNotification(channel: RiskNotificationPlan["channel"]): RiskNotificationPlan {
  return {
    channel,
    status: "not_sent",
    attempts: 0,
    deliveredAt: null,
    viewedAt: null,
    acknowledgedAt: null,
    failedAt: null,
    timedOutAt: null,
  };
}

export function createRiskTicket(input: unknown): RiskTicketSnapshot {
  const request = riskTicketCreateRequestSchema.safeParse(input);
  if (!request.success) throw new RiskTicketStateError("RISK_TICKET_REQUEST_INVALID");
  return riskTicketSnapshotSchema.parse({
    schemaVersion: RISK_TICKET_SCHEMA_VERSION,
    synthetic: true,
    caseReference: request.data.caseReference,
    level: request.data.level,
    primaryCategory: request.data.primaryCategory,
    status: "open",
    resolution: null,
    notifications: CHANNELS.map(freshNotification),
    createdAt: request.data.createdAt,
    updatedAt: request.data.createdAt,
  });
}

function setStatus(notification: RiskNotificationPlan, status: RiskNotificationStatus): void {
  notification.status = status;
}

export function applyRiskTicketEvent(
  snapshot: RiskTicketSnapshot,
  eventInput: unknown,
): RiskTicketSnapshot {
  const event = riskTicketEventSchema.safeParse(eventInput);
  if (!event.success) throw new RiskTicketStateError("RISK_TICKET_EVENT_INVALID");
  const e = event.data;
  const next: RiskTicketSnapshot = structuredClone(snapshot);
  next.updatedAt = e.occurredAt;

  const updateNotification = (
    mutate: (notification: RiskNotificationPlan) => void,
  ): void => {
    const channel = e.channel;
    if (channel === undefined) throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
    const notification = next.notifications.find((item) => item.channel === channel);
    if (notification === undefined) throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
    mutate(notification);
  };

  switch (e.action) {
    case "record_send_attempted":
      updateNotification((n) => {
        if (n.status !== "not_sent" && n.status !== "failed" && n.status !== "timed_out") {
          throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
        }
        if (n.attempts >= 2) throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
        n.attempts += 1;
        setStatus(n, "attempted");
      });
      break;
    case "record_delivered":
      updateNotification((n) => {
        if (n.status !== "attempted") throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
        setStatus(n, "delivered");
        n.deliveredAt = e.occurredAt;
      });
      break;
    case "record_viewed":
      updateNotification((n) => {
        if (n.status !== "delivered") throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
        setStatus(n, "viewed");
        n.viewedAt = e.occurredAt;
      });
      break;
    case "record_acknowledged":
      updateNotification((n) => {
        if (n.status !== "viewed") throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
        setStatus(n, "acknowledged");
        n.acknowledgedAt = e.occurredAt;
      });
      next.status = next.notifications
        .every((item) => item.status === "acknowledged")
        ? "acknowledged"
        : "waiting_for_acknowledgement";
      break;
    case "record_failed":
      updateNotification((n) => {
        if (n.status !== "attempted") throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
        setStatus(n, "failed");
        n.failedAt = e.occurredAt;
      });
      break;
    case "record_timed_out":
      updateNotification((n) => {
        if (n.status !== "attempted") throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
        setStatus(n, "timed_out");
        n.timedOutAt = e.occurredAt;
      });
      next.status = "escalated";
      break;
    case "escalate_for_immediate_human_review":
      next.status = "escalated";
      break;
    case "resolve":
      if (next.status !== "acknowledged" && next.status !== "escalated") {
        throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
      }
      if (e.dispositionNote === undefined) {
        throw new RiskTicketStateError("RISK_TICKET_EVENT_INVALID");
      }
      next.status = "resolved";
      next.resolution = e.dispositionNote;
      break;
    case "close":
      if (next.status !== "resolved") throw new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION");
      next.status = "closed";
      break;
    default: {
      const exhaustive: never = e.action;
      throw new Error(`RISK_TICKET_ACTION_UNKNOWN:${String(exhaustive)}`);
    }
  }

  return riskTicketSnapshotSchema.parse(next);
}