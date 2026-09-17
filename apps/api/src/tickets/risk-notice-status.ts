import {
  RISK_NOTICE_USER_STATE_SCHEMA_VERSION,
  riskNoticeStatusViewSchema,
  type RiskNoticeStatusView,
  type RiskTicketSnapshot,
} from "@xiaoban/contracts";

type Audience = RiskNoticeStatusView["audience"];

const COPY = {
  guardian: {
    unavailable: {
      headline: "通知暂时没能送达",
      message: "暂时没有确认对方已经收到，可稍后查看。",
      directAction: "如有紧急风险，请直接当面联系可信任大人。",
    },
    waiting: {
      headline: "通知尚未获得确认",
      message: "当前还没有收到查看或确认回执。",
      directAction: "可稍后查看；必要时请直接当面联系可信任大人。",
    },
  },
  child: {
    unavailable: {
      headline: "通知暂时没能送达",
      message: "小伴还不能确认大人已经看到。",
      directAction: "请直接当面告诉身边可信任的大人。",
    },
    waiting: {
      headline: "还在等待大人确认",
      message: "现在还不能显示“大人已经看到”。",
      directAction: "如果情况紧急，请直接当面告诉可信任的大人。",
    },
  },
} as const;

export function buildRiskNoticeStatusView(
  snapshot: Pick<RiskTicketSnapshot, "status" | "notifications">,
  audience: Audience,
): RiskNoticeStatusView | null {
  if (snapshot.status === "acknowledged" || snapshot.status === "resolved" || snapshot.status === "closed") {
    return null;
  }

  const deliveryBlocked = snapshot.status === "escalated" || snapshot.notifications.some(
    (notification) => notification.status === "failed" || notification.status === "timed_out",
  );
  const copy = COPY[audience][deliveryBlocked ? "unavailable" : "waiting"];

  return riskNoticeStatusViewSchema.parse({
    schemaVersion: RISK_NOTICE_USER_STATE_SCHEMA_VERSION,
    audience,
    state: deliveryBlocked ? "temporarily_unavailable" : "waiting_for_acknowledgement",
    ...copy,
    successfulDeliveryShown: false,
  });
}
