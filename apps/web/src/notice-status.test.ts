import type { RiskConsoleTicketDetail } from "@xiaoban/contracts";
import { describe, expect, it } from "vitest";

import {
  getNoticeStatusMessage,
  noticeInputFromRiskConsoleDetail,
  resolveNoticeStatus,
} from "./notice-status";

const forbiddenSuccessWords = ["已送达", "已查看", "已确认", "发送成功", "通知成功"];

describe("notice status resilience copy", () => {
  it("uses a neutral child facing message for failed, timed out, escalated, and unacknowledged states", () => {
    const cases = [
      { notificationStatus: "failed" as const },
      { notificationStatus: "timed_out" as const },
      { ticketStatus: "escalated" as const, channelStatuses: ["delivered", "viewed"] as const },
      { ticketStatus: "waiting_for_acknowledgement" as const, channelStatuses: ["viewed", "delivered"] as const },
    ];

    for (const status of cases) {
      const childMessage = getNoticeStatusMessage("child", status);
      const guardianMessage = getNoticeStatusMessage("guardian", status);

      expect(childMessage.safeToShowSuccess).toBe(false);
      expect(guardianMessage.safeToShowSuccess).toBe(false);
      expect(childMessage.message).toContain("当面告诉一位可信任的大人");
      expect(guardianMessage.message).toContain("当面联系可信任大人");
      for (const message of [childMessage, guardianMessage]) {
        for (const word of forbiddenSuccessWords) {
          expect(`${message.title}${message.message}`).not.toContain(word);
        }
      }
    }
  });

  it("keeps attempted, delivered, and viewed channels pending until every local acknowledgement is aggregated", () => {
    expect(resolveNoticeStatus({ channelStatuses: ["attempted", "not_sent"] })).toBe("acknowledgement_pending");
    expect(resolveNoticeStatus({ channelStatuses: ["delivered", "viewed"] })).toBe("acknowledgement_pending");
    expect(resolveNoticeStatus({ ticketStatus: "waiting_for_acknowledgement", channelStatuses: ["acknowledged", "viewed"] }))
      .toBe("acknowledgement_pending");
  });

  it("labels fully acknowledged local receipts as local-only rather than real channel delivery", () => {
    const message = getNoticeStatusMessage("guardian", {
      ticketStatus: "acknowledged",
      channelStatuses: ["acknowledged", "acknowledged"],
    });

    expect(message.safeToShowSuccess).toBe(true);
    expect(message.message).toContain("无网络本地演练");
    expect(message.message).toContain("不代表真实");
  });
});

describe("notice status from real risk console ticket detail", () => {
  function detailWith(
    ticketStatus: RiskConsoleTicketDetail["status"],
    channelStatuses: ReadonlyArray<RiskConsoleTicketDetail["notifications"][number]["status"]>,
  ): Pick<RiskConsoleTicketDetail, "status" | "notifications"> {
    return {
      status: ticketStatus,
      notifications: channelStatuses.map((status, index) => ({
        channel: index === 0 ? "in_app" : "off_site_backup",
        status,
        attempts: status === "not_sent" ? 0 : 1,
        simulated: true,
        networkCallMade: false,
      })),
    };
  }

  it("maps persisted per-channel statuses from the workbench detail in channel order", () => {
    const input = noticeInputFromRiskConsoleDetail(
      detailWith("waiting_for_acknowledgement", ["delivered", "viewed"]),
    );

    expect(input.ticketStatus).toBe("waiting_for_acknowledgement");
    expect(input.channelStatuses).toEqual(["delivered", "viewed"]);
  });

  it("never shows success for fresh, failed, timed out, escalated, or single-channel tickets read from the workbench", () => {
    const cases = [
      detailWith("open", ["not_sent", "not_sent"]),
      detailWith("escalated", ["not_sent", "timed_out"]),
      detailWith("waiting_for_acknowledgement", ["failed", "not_sent"]),
      detailWith("escalated", ["delivered", "failed"]),
      detailWith("waiting_for_acknowledgement", ["acknowledged", "delivered"]),
    ] as const;

    for (const detail of cases) {
      const message = getNoticeStatusMessage("guardian", noticeInputFromRiskConsoleDetail(detail));
      expect(message.safeToShowSuccess).toBe(false);
      for (const word of forbiddenSuccessWords) {
        expect(`${message.title}${message.message}`).not.toContain(word);
      }
    }

    expect(resolveNoticeStatus(noticeInputFromRiskConsoleDetail(cases[1]))).toBe("delivery_unavailable");
    expect(resolveNoticeStatus(noticeInputFromRiskConsoleDetail(cases[2]))).toBe("delivery_unavailable");
    expect(resolveNoticeStatus(noticeInputFromRiskConsoleDetail(cases[4]))).toBe("acknowledgement_pending");
  });

  it("shows the local-only receipt only after both channels are acknowledged on an acknowledged or closed ticket", () => {
    for (const ticketStatus of ["acknowledged", "resolved", "closed"] as const) {
      const message = getNoticeStatusMessage(
        "guardian",
        noticeInputFromRiskConsoleDetail(detailWith(ticketStatus, ["acknowledged", "acknowledged"])),
      );

      expect(message.tone).toBe("local_acknowledged");
      expect(message.safeToShowSuccess).toBe(true);
      expect(message.message).toContain("不代表真实");
    }
  });
});
