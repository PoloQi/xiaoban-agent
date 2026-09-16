import { describe, expect, it } from "vitest";

import {
  RISK_TICKET_SCHEMA_VERSION,
  riskTicketCreateRequestSchema,
  riskTicketSnapshotSchema,
} from "@xiaoban/contracts";

import {
  RiskTicketStateError,
  applyRiskTicketEvent,
  createRiskTicket,
} from "./risk-ticket-state-machine.js";

const now = "2026-09-16T11:12:00.000Z";

const createRequest = riskTicketCreateRequestSchema.parse({
  requestId: "019c2b71-0001-4001-8001-000000000001",
  synthetic: true,
  caseReference: "synthetic-risk-stage-six-l2",
  level: "L2",
  primaryCategory: "bullying",
  createdAt: now,
});

describe("synthetic risk ticket state machine", () => {
  it("opens an L2/L3 ticket with in-app and off-site notification plans that have not been sent", () => {
    const ticket = createRiskTicket(createRequest);

    expect(ticket).toMatchObject({
      schemaVersion: RISK_TICKET_SCHEMA_VERSION,
      synthetic: true,
      level: "L2",
      primaryCategory: "bullying",
      status: "open",
      resolution: null,
    });
    expect(ticket.notifications.map((item) => item.channel)).toEqual([
      "in_app",
      "off_site_backup",
    ]);
    expect(ticket.notifications.every((item) => item.status === "not_sent")).toBe(true);
    expect(riskTicketSnapshotSchema.safeParse(ticket).success).toBe(true);
  });

  it("rejects L0/L1 because ordinary support cannot create a risk ticket", () => {
    expect(() => createRiskTicket({
      ...createRequest,
      level: "L1",
      primaryCategory: "persistent_distress",
    })).toThrow(new RiskTicketStateError("RISK_TICKET_REQUEST_INVALID"));
  });

  it("requires ordered delivery receipts and acknowledgement from every required channel", () => {
    let ticket = createRiskTicket(createRequest);
    ticket = applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0002-4002-8002-000000000001",
      action: "record_send_attempted",
      channel: "in_app",
      occurredAt: now,
    });
    ticket = applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0002-4002-8002-000000000002",
      action: "record_delivered",
      channel: "in_app",
      occurredAt: now,
    });

    expect(() => applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0002-4002-8002-000000000003",
      action: "record_acknowledged",
      channel: "in_app",
      occurredAt: now,
    })).toThrow(new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION"));

    ticket = applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0002-4002-8002-000000000004",
      action: "record_viewed",
      channel: "in_app",
      occurredAt: now,
    });
    ticket = applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0002-4002-8002-000000000005",
      action: "record_acknowledged",
      channel: "in_app",
      occurredAt: now,
    });
    expect(ticket.status).toBe("waiting_for_acknowledgement");

    for (const action of ["record_send_attempted", "record_delivered", "record_viewed", "record_acknowledged"] as const) {
      ticket = applyRiskTicketEvent(ticket, {
        requestId: `019c2b71-0003-4003-8003-${action === "record_send_attempted" ? "000000000001" : action === "record_delivered" ? "000000000002" : action === "record_viewed" ? "000000000003" : "000000000004"}`,
        action,
        channel: "off_site_backup",
        occurredAt: now,
      });
    }
    expect(ticket.status).toBe("acknowledged");
  });

  it("allows one retry after failure, then escalates a timed-out unacknowledged channel", () => {
    let ticket = createRiskTicket(createRequest);
    ticket = applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0004-4004-8004-000000000001",
      action: "record_send_attempted",
      channel: "off_site_backup",
      occurredAt: now,
    });
    ticket = applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0004-4004-8004-000000000002",
      action: "record_failed",
      channel: "off_site_backup",
      occurredAt: now,
    });
    expect(ticket.notifications.find((item) => item.channel === "off_site_backup")?.status).toBe("failed");
    ticket = applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0004-4004-8004-000000000003",
      action: "record_send_attempted",
      channel: "off_site_backup",
      occurredAt: now,
    });
    ticket = applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0004-4004-8004-000000000004",
      action: "record_timed_out",
      channel: "off_site_backup",
      occurredAt: now,
    });
    expect(ticket.status).toBe("escalated");
  });

  it("requires a synthetic disposition to resolve and can only close a resolved ticket", () => {
    const ticket = createRiskTicket({
      ...createRequest,
      level: "L3",
      primaryCategory: "active_danger",
    });

    expect(() => applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0005-4005-8005-000000000001",
      action: "resolve",
      dispositionNote: "虚构处置：工单仍处于打开状态，不能直接完成。",
      occurredAt: now,
    })).toThrow(new RiskTicketStateError("RISK_TICKET_INVALID_TRANSITION"));

    let escalated = applyRiskTicketEvent(ticket, {
      requestId: "019c2b71-0005-4005-8005-000000000002",
      action: "escalate_for_immediate_human_review",
      occurredAt: now,
    });
    expect(() => applyRiskTicketEvent(escalated, {
      requestId: "019c2b71-0005-4005-8005-000000000003",
      action: "resolve",
      occurredAt: now,
    })).toThrow(new RiskTicketStateError("RISK_TICKET_EVENT_INVALID"));

    escalated = applyRiskTicketEvent(escalated, {
      requestId: "019c2b71-0005-4005-8005-000000000004",
      action: "resolve",
      dispositionNote: "虚构处置：已由值守成人按合成应急流程确认安全。",
      occurredAt: now,
    });
    expect(escalated.status).toBe("resolved");
    const closed = applyRiskTicketEvent(escalated, {
      requestId: "019c2b71-0005-4005-8005-000000000005",
      action: "close",
      occurredAt: now,
    });
    expect(closed.status).toBe("closed");
  });
});