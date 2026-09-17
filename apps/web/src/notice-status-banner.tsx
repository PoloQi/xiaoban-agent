import { getNoticeStatusMessage, type NoticeStatusAudience, type NoticeStatusInput } from "./notice-status";

interface NoticeStatusBannerProps {
  audience: NoticeStatusAudience;
  status?: NoticeStatusInput;
}

export function NoticeStatusBanner({ audience, status = {} }: NoticeStatusBannerProps) {
  const message = getNoticeStatusMessage(audience, status);

  return (
    <aside className={`notice-status notice-status--${message.tone}`} role="status" data-tone={message.tone}>
      <strong>{message.title}</strong>
      <p>{message.message}</p>
    </aside>
  );
}
