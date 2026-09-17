import { describe, expect, it } from "vitest";

import { applyRiskTicketEvent, createRiskTicket } from "./risk-ticket-state-machine.js";
import { buildRiskNoticeStatusView } from "./risk-notice-status.js";

const baseTime = "2026-09-17T07:00:00.000Z";
const later = "2026-09-17T07:01:00.000Z";
const requestId = "00000000-0000-4000-8000-000000000001";

function ticket() {
  return createRiskTicket({
    requestId,
    synthetic: true,
    caseReference: "synthetic-risk-stage-six-l2",
    level: "L2",
    primaryCategory: "fraud_privacy",
    createdAt: baseTime,
  });
}

describe("buildRiskNoticeStatusView", () => {
  it("keeps an unreceipted fresh ticket neutral without showing delivery success", () => {
    const view = buildRiskNoticeStatusView(ticket(), "guardian");
    expect(view).toMatchObject({
      audience: "guardian",
      state: "waiting_for_acknowledgement",
      successfulDeliveryShown: false,
    });
    expect(view?.headline).not.toContain("成功");
  });

  it("shows a safe downgrade after a channel failure", () => {
    let snapshot = applyRiskTicketEvent(ticket(), {
      requestId, action: "record_send_attempted", channel: "in_app", occurredAt: baseTime,
    });
    snapshot = applyRiskTicketEvent(snapshot, {
      requestId, action: "record_failed", channel: "in_app", occurredAt: later,
    });

    const view = buildRiskNoticeStatusView(snapshot, "child");
    expect(view).toMatchObject({
      audience: "child",
      state: "temporarily_unavailable",
      successfulDeliveryShown: false,
    });
    expect(view?.directAction).toContain("当面告诉");
  });

  it("shows a safe downgrade for timed-out and escalated tickets", () => {
    let snapshot = applyRiskTicketEvent(ticket(), {
      requestId, action: "record_send_attempted", channel: "in_app", occurredAt: baseTime,
    });
    snapshot = applyRiskTicketEvent(snapshot, {
      requestId, action: "record_timed_out", channel: "in_app", occurredAt: later,
    });

    expect(buildRiskNoticeStatusView(snapshot, "guardian")?.state).toBe("temporarily_unavailable");
  });

  it("does not render a downgrade after both channels are acknowledged", () => {
    let snapshot = ticket();
    let id = 1;
    for (const channel of ["in_app", "off_site_backup"] as const) {
      for (const action of ["record_send_attempted", "record_delivered", "record_viewed", "record_acknowledged"] as const) {
        snapshot = applyRiskTicketEvent(snapshot, {
          requestId: `00000000-0000-4000-8000-${id.toString().padStart(12, "0")}`,
          action,
          channel,
          occurredAt: later,
        });
        id += 1;
      }
    }

    expect(buildRiskNoticeStatusView(snapshot, "guardian")).toBeNull();
  });
});


