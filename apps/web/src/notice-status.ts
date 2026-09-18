import type { RiskNotificationStatus, RiskTicketStatus } from "@xiaoban/contracts";

export type NoticeStatusAudience = "child" | "guardian";

export type NoticeStatusTone = "delivery_unavailable" | "acknowledgement_pending" | "local_acknowledged";

export interface NoticeStatusInput {
  ticketStatus?: RiskTicketStatus;
  notificationStatus?: RiskNotificationStatus;
  channelStatuses?: readonly RiskNotificationStatus[];
}

export interface NoticeStatusMessage {
  tone: NoticeStatusTone;
  safeToShowSuccess: boolean;
  title: string;
  message: string;
}

const unavailableTitle = "暂时没能送达";
const pendingTitle = "还没有收到确认";

function faceToFaceLine(audience: NoticeStatusAudience): string {
  return audience === "child"
    ? "请直接当面告诉一位可信任的大人。"
    : "可稍后查看；如有紧急风险，请直接当面联系可信任大人。";
}

export function noticeInputFromRiskConsoleDetail(detail: {
  status: RiskTicketStatus;
  notifications: readonly { status: RiskNotificationStatus }[];
}): NoticeStatusInput {
  return {
    ticketStatus: detail.status,
    channelStatuses: detail.notifications.map((item) => item.status),
  };
}

export function resolveNoticeStatus(input: NoticeStatusInput = {}): NoticeStatusTone {
  const statuses = input.channelStatuses
    ?? (input.notificationStatus === undefined ? [] : [input.notificationStatus]);

  if (input.ticketStatus === "escalated"
    || statuses.includes("failed")
    || statuses.includes("timed_out")) {
    return "delivery_unavailable";
  }

  if (statuses.length === 2
    && statuses.every((status) => status === "acknowledged")
    && (input.ticketStatus === "acknowledged"
      || input.ticketStatus === "resolved"
      || input.ticketStatus === "closed")) {
    return "local_acknowledged";
  }

  return "acknowledgement_pending";
}

export function getNoticeStatusMessage(
  audience: NoticeStatusAudience,
  input: NoticeStatusInput = {},
): NoticeStatusMessage {
  const tone = resolveNoticeStatus(input);

  if (tone === "delivery_unavailable") {
    return {
      tone,
      safeToShowSuccess: false,
      title: unavailableTitle,
      message: `通知暂时没能送达。${faceToFaceLine(audience)}`,
    };
  }

  if (tone === "acknowledgement_pending") {
    return {
      tone,
      safeToShowSuccess: false,
      title: pendingTitle,
      message: `目前还不能确认大人已经看到。${faceToFaceLine(audience)}`,
    };
  }

  return {
    tone,
    safeToShowSuccess: true,
    title: "本地演练回执已记录",
    message: "这是无网络本地演练状态，不代表真实短信、邮件或站外消息已送达。",
  };
}
