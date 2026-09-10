import { describe, expect, it } from "vitest";

import { getGuardianDashboard } from "./guardian-dashboard";

describe("guardian dashboard client", () => {
  it("loads the aggregate with the guardian bearer token", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; authorization: string | null }> = [];
    globalThis.fetch = (async (path, init) => {
      requests.push({
        path: String(path),
        authorization: new Headers(init?.headers).get("authorization"),
      });
      return new Response(JSON.stringify({
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
        alerts: [],
      }), { status: 200, headers: { "content-type": "application/json" } });
    }) as typeof fetch;

    try {
      await getGuardianDashboard("A".repeat(43));
      expect(requests).toEqual([{
        path: "/api/v1/guardian/dashboard",
        authorization: `Bearer ${"A".repeat(43)}`,
      }]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
