import {
  guardianDashboardResponseSchema,
  riskConsoleTicketDetailSchema,
} from "@xiaoban/contracts";
import { describe, expect, it } from "vitest";

import {
  getNoticeStatusMessage,
  type NoticeStatusMessage,
  noticeInputFromRiskConsoleDetail,
  resolveNoticeStatus,
  syntheticNotSentNoticeInput,
} from "./notice-status";

const forbiddenSuccessWords = ["已送达", "已查看", "已确认", "发送成功", "通知成功"];

function expectNoSuccess(message: NoticeStatusMessage): void {
  expect(message.safeToShowSuccess).toBe(false);
  for (const word of forbiddenSuccessWords) {
    expect(`${message.title}${message.message}`).not.toContain(word);
  }
}

// 与 guardian-dashboard.test.ts 相同形状的真实 GET /api/v1/guardian/dashboard 响应。
const guardianDashboardResponse = {
  schemaVersion: "guardian-dashboard-2026-09-v1",
  access: { mode: "read_only", relationshipStatus: "verified" },
  guardian: { alias: "青禾阿姨" },
  child: { alias: "小树", ageBand: "9_11" },
  week: { startDate: "2026-08-31", endDate: "2026-09-06", timezone: "Asia/Shanghai" },
  stats: { realWorldActivities: 0, goalAttempts: 0, activeDays: 0, usageTracking: "not_collected" },
  days: ["一", "二", "三", "四", "五", "六", "日"].map((label, index) => ({
    date: index === 0 ? "2026-08-31" : `2026-09-0${index}`,
    label,
    actionCount: 0,
  })),
  report: {
    source: "deterministic_summary",
    headline: "小树本周还没有记录现实行动",
    summary: "本周暂时没有目标尝试记录。可以先留意孩子愿意开始的一次小行动。",
  },
  privacy: {
    visibleSummary: "本周现实活动、目标尝试和必要的风险演练状态",
    hiddenDetail: "完整普通聊天",
  },
  settings: {
    bindingStatus: "verified",
    usageReminder: { status: "not_configured", minutes: null, editable: false },
    ordinaryChatVisible: false,
  },
  alerts: [
    {
      id: "synthetic-privacy-preview",
      source: "synthetic_preview",
      level: "L2",
      title: "网络隐私风险 · 需要成人关注",
      summary: "有网友向孩子索要家庭地址，建议立即了解情况并帮助孩子退出联系。",
      occurredAt: null,
      notificationStatus: "not_sent",
      acknowledgementStatus: "unavailable",
      steps: ["先陪孩子离开当前对话", "一起保留必要页面线索", "当面告诉另一位可信任大人"],
    },
  ],
} as const;

const validTicketDetail = {
  id: "019c111a-0000-4000-8000-000000000001",
  caseReference: "synthetic-risk-console-001",
  level: "L2" as const,
  primaryCategory: "bullying" as const,
  status: "open" as const,
  assigneeState: "unclaimed" as const,
  claimedAt: null,
  createdAt: "2026-09-17T01:00:00.000Z",
  updatedAt: "2026-09-17T01:00:00.000Z",
  resolution: null,
  notifications: [
    { channel: "in_app" as const, status: "not_sent" as const, attempts: 0, simulated: true as const, networkCallMade: false as const },
    { channel: "off_site_backup" as const, status: "not_sent" as const, attempts: 0, simulated: true as const, networkCallMade: false as const },
  ],
  notes: [],
  permissions: { canClaim: true, canAddNote: false, canResolve: false, canClose: false },
  notificationBoundary: { simulated: true as const, networkCallMade: false as const, readOnly: true as const },
};

describe("phase 6 exit walkthrough: no success copy before acknowledgement (6A.12)", () => {
  it("surface 1 (child risk-sent preview): the fixed preview input stays not_sent and never shows success", () => {
    expect(syntheticNotSentNoticeInput).toEqual({ notificationStatus: "not_sent" });
    expect(resolveNoticeStatus(syntheticNotSentNoticeInput)).toBe("acknowledgement_pending");
    expectNoSuccess(getNoticeStatusMessage("child", syntheticNotSentNoticeInput));
    expect(getNoticeStatusMessage("child", syntheticNotSentNoticeInput).message).toContain("当面告诉一位可信任的大人");
  });

  it("surface 2 (guardian dashboard alerts): contract-parsed alerts can only be not_sent and never show success", () => {
    const dashboard = guardianDashboardResponseSchema.parse(guardianDashboardResponse);
    expect(dashboard.alerts).toHaveLength(1);

    for (const alert of dashboard.alerts) {
      expect(alert.notificationStatus).toBe("not_sent");
      expect(alert.acknowledgementStatus).toBe("unavailable");
      expectNoSuccess(getNoticeStatusMessage("guardian", { notificationStatus: alert.notificationStatus }));
    }

    // 契约层即拒绝任何“已发送”状态，前端无从收到成功信号。
    const delivered = guardianDashboardResponseSchema.safeParse({
      ...guardianDashboardResponse,
      alerts: [{ ...guardianDashboardResponse.alerts[0], notificationStatus: "delivered" }],
    });
    expect(delivered.success).toBe(false);
  });

  it("surface 3 (risk console workbench): contract-parsed tickets show failure or pending until dual-channel acknowledgement", () => {
    const cases = [
      validTicketDetail,
      {
        ...validTicketDetail,
        status: "escalated" as const,
        notifications: [
          { ...validTicketDetail.notifications[0], status: "not_sent" as const, attempts: 0 },
          { ...validTicketDetail.notifications[1], status: "timed_out" as const, attempts: 2 },
        ],
      },
      {
        ...validTicketDetail,
        status: "waiting_for_acknowledgement" as const,
        notifications: [
          { ...validTicketDetail.notifications[0], status: "acknowledged" as const, attempts: 1 },
          { ...validTicketDetail.notifications[1], status: "delivered" as const, attempts: 1 },
        ],
      },
    ];

    for (const candidate of cases) {
      const detail = riskConsoleTicketDetailSchema.parse(candidate);
      expectNoSuccess(getNoticeStatusMessage("guardian", noticeInputFromRiskConsoleDetail(detail)));
    }

    expect(resolveNoticeStatus(noticeInputFromRiskConsoleDetail(riskConsoleTicketDetailSchema.parse(cases[1]))))
      .toBe("delivery_unavailable");
  });

  it("surface 3 only: acknowledged/resolved/closed plus dual-channel acknowledgement unlocks the local-only receipt", () => {
    for (const status of ["acknowledged", "resolved", "closed"] as const) {
      const detail = riskConsoleTicketDetailSchema.parse({
        ...validTicketDetail,
        status,
        notifications: [
          { ...validTicketDetail.notifications[0], status: "acknowledged", attempts: 1 },
          { ...validTicketDetail.notifications[1], status: "acknowledged", attempts: 1 },
        ],
      });

      const message = getNoticeStatusMessage("guardian", noticeInputFromRiskConsoleDetail(detail));
      expect(message.tone).toBe("local_acknowledged");
      expect(message.safeToShowSuccess).toBe(true);
      expect(message.message).toContain("不代表真实");
    }
  });
});
