import type { ReactNode } from "react";

import "./child-risk-sent.css";
import { NoticeStatusBanner } from "./notice-status-banner";

interface ChildRiskSentProps {
  onBackHome: () => void;
  onOpenAdultPreview?: () => void;
}

function RiskSentIcon({ name }: { name: "check" | "home" | "people" | "shield" }) {
  const paths: Record<typeof name, ReactNode> = {
    check: <path d="m5 12 5 5 9-10" />,
    home: <><path d="M4 11 12 4l8 7" /><path d="M6 10v9h5v-6h2v6h5v-9" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6" /><path d="M16 6.5a2.5 2.5 0 0 1 0 5" /><path d="M17 14c2.3.5 3.5 2.4 3.5 5" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.5-2.5 8-7 10-4.5-2-7-5.5-7-10V6Z" /><path d="m9 12 2 2 4-5" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

const NOTIFICATION_PREVIEW = {
  title: "网络隐私风险 · 需要成人关注",
  timestamp: "刚刚",
  body: "有网友向孩子索要家庭地址。建议立即了解情况，保存必要证据，并帮助孩子退出联系。",
} as const;

export function ChildRiskSent({ onBackHome, onOpenAdultPreview }: ChildRiskSentProps) {
  return (
    <main className="risk-sent-shell">
      <header className="risk-sent-status">
        <span><RiskSentIcon name="check" /></span>
        <p><strong>演示通知已生成</strong><small>原型保留 · 未真实发送</small></p>
      </header>

      <section className="risk-sent-hero" aria-labelledby="risk-sent-title">
        <span className="risk-sent-badge"><RiskSentIcon name="people" /></span>
        <p className="risk-sent-kicker">求助已完成</p>
        <h1 id="risk-sent-title">你已经迈出了<br />求助的一步</h1>
        <p className="risk-sent-lead">告诉身边一位可信任的大人，本身就是这次最重要的一步。剩下的事，我们先一起慢慢来。</p>
      </section>

      <section className="risk-sent-preview" aria-labelledby="risk-sent-preview-title">
        <div className="risk-sent-preview-heading">
          <p>NOTIFICATION PREVIEW</p>
          <h2 id="risk-sent-preview-title">通知内容预览</h2>
        </div>
        <NoticeStatusBanner audience="child" status={{ notificationStatus: "not_sent" }} />
        <article className="risk-sent-preview-card">
          <header>
            <strong>{NOTIFICATION_PREVIEW.title}</strong>
            <small>{NOTIFICATION_PREVIEW.timestamp}</small>
          </header>
          <p>{NOTIFICATION_PREVIEW.body}</p>
          <span className="risk-sent-preview-tag">演示通知 · 未真实发送</span>
        </article>
      </section>

      <aside className="risk-sent-boundary">
        <RiskSentIcon name="shield" />
        <p>
          <strong>本页没有自动发送通知。</strong>
          小伴不会替你联系家人或老师；真实产品必须等大人确认后，才会向你显示「有人正在帮助你」。
          小伴不是紧急救援服务；如果危险正在发生，请立刻离开危险，并当面找身边的大人。
        </p>
      </aside>

      <section className="risk-sent-actions">
        <button className="risk-sent-action risk-sent-action--primary" type="button" onClick={onBackHome}>
          <RiskSentIcon name="home" />
          <span><strong>我知道了，回到首页</strong><small>普通聊天已停止，可以先休息一会儿</small></span>
        </button>
        {onOpenAdultPreview !== undefined && (
          <button className="risk-sent-action risk-sent-action--quiet" type="button" onClick={onOpenAdultPreview}>
            <RiskSentIcon name="people" />
            <span><strong>看看监护端会怎么处理</strong><small>只读预览，监护端独立账号登录</small></span>
          </button>
        )}
      </section>
    </main>
  );
}
