import "./notice-status.css";

export type NoticeStatusVariant = "unavailable" | "waiting";
export type NoticeStatusAudience = "guardian" | "child";

interface NoticeStatusProps {
  variant: NoticeStatusVariant;
  audience: NoticeStatusAudience;
}

const CONTENT = {
  unavailable: {
    guardian: {
      headline: "通知暂时没能送达",
      message: "暂时没有确认对方已经收到，可稍后查看。",
      action: "如有紧急风险，请直接当面联系可信任大人。",
    },
    child: {
      headline: "通知暂时没能送达",
      message: "小伴还不能确认大人已经看到。",
      action: "请直接当面告诉身边可信任的大人。",
    },
  },
  waiting: {
    guardian: {
      headline: "通知尚未获得确认",
      message: "当前还没有收到查看或确认回执。",
      action: "可稍后查看；必要时请直接当面联系可信任大人。",
    },
    child: {
      headline: "还在等待大人确认",
      message: "现在还不能显示“大人已经看到”。",
      action: "如果情况紧急，请直接当面告诉可信任的大人。",
    },
  },
} as const;

export function selectNoticeContent(variant: NoticeStatusVariant, audience: NoticeStatusAudience) {
  return CONTENT[variant][audience];
}

export function NoticeStatus({ variant, audience }: NoticeStatusProps) {
  const content = selectNoticeContent(variant, audience);
  return (
    <aside className={`notice-status notice-status--${variant}`} role="status">
      <svg aria-hidden="true" viewBox="0 0 24 24">
        <path d="M12 4 4 18h16L12 4Z" />
        <path d="M12 9v5" />
        <path d="M12 17.5h.01" />
      </svg>
      <div>
        <strong>{content.headline}</strong>
        <p>{content.message}</p>
        <span>{content.action}</span>
      </div>
    </aside>
  );
}
