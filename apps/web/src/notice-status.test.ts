import { describe, expect, it } from "vitest";

import { getNoticeStatusMessage, resolveNoticeStatus } from "./notice-status";

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
