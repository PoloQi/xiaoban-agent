import { useState, type ReactNode } from "react";

import type { ChildChatResponse } from "@xiaoban/contracts";

import "./child-risk-response.css";

type FixedSafetyResponse = Extract<ChildChatResponse, { route: "fixed_safety" }>;
type Detail = "evidence" | "adult" | null;

interface ChildRiskResponseProps {
  response: FixedSafetyResponse;
  onExitChat: () => void;
}

function RiskIcon({ name }: { name: "alert" | "arrow" | "exit" | "people" | "save" | "shield" }) {
  const paths: Record<typeof name, ReactNode> = {
    alert: <><path d="M12 3 2.8 20h18.4Z" /><path d="M12 9v4" /><path d="M12 17h.01" /></>,
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    exit: <><path d="M10 5H5v14h5" /><path d="M13 8l4 4-4 4" /><path d="M8 12h9" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3.5 20c.5-4 2.3-6 5.5-6s5 2 5.5 6" /><path d="M16 6.5a2.5 2.5 0 0 1 0 5" /><path d="M17 14c2.3.5 3.5 2.4 3.5 5" /></>,
    save: <><path d="M5 4h12l2 2v14H5Z" /><path d="M8 4v6h8V4" /><path d="M8 20v-6h8v6" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.5-2.5 8-7 10-4.5-2-7-5.5-7-10V6Z" /><path d="m9 12 2 2 4-5" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24">{paths[name]}</svg>;
}

export function ChildRiskResponse({ response, onExitChat }: ChildRiskResponseProps) {
  const [detail, setDetail] = useState<Detail>(null);

  return (
    <main className="risk-response-shell">
      <header className="risk-response-status">
        <span><RiskIcon name="shield" /></span>
        <p><strong>固定安全回应</strong><small>普通聊天已经停止</small></p>
      </header>

      <section className="risk-response-hero" aria-labelledby="risk-response-title">
        <span className="risk-response-alert"><RiskIcon name="alert" /></span>
        <p className="risk-response-kicker">先照顾好现实中的安全</p>
        <h1 id="risk-response-title">{response.title}</h1>
        <p className="risk-response-lead">你没有做错，也不需要继续在这里解释。现在先按这些步骤做：</p>
        <ol className="risk-response-steps">
          {response.steps.map((step) => <li key={step}>{step}</li>)}
        </ol>
      </section>

      <section className="risk-response-actions" aria-labelledby="risk-actions-title">
        <div className="risk-response-section-heading">
          <p>RIGHT NOW</p>
          <h2 id="risk-actions-title">现在做这三件事</h2>
        </div>

        <button className="risk-response-action" type="button" onClick={onExitChat}>
          <span className="risk-response-action-icon"><RiskIcon name="exit" /></span>
          <span><strong>1. 退出当前聊天</strong><small>不继续回复，不点击陌生链接</small></span>
          <RiskIcon name="arrow" />
        </button>

        <button
          className="risk-response-action"
          type="button"
          aria-expanded={detail === "evidence"}
          aria-controls="risk-evidence-detail"
          onClick={() => setDetail((current) => current === "evidence" ? null : "evidence")}
        >
          <span className="risk-response-action-icon"><RiskIcon name="save" /></span>
          <span><strong>2. 保存必要证据</strong><small>只保留必要截图，不转发给同学</small></span>
          <RiskIcon name="arrow" />
        </button>
        {detail === "evidence" && (
          <div className="risk-response-detail" id="risk-evidence-detail" role="status">
            可以用设备截图保留对方的账号、时间和相关消息，再直接给可信任的大人看。小伴不会读取或保存这些截图。
          </div>
        )}

        <button
          className="risk-response-action"
          type="button"
          aria-expanded={detail === "adult"}
          aria-controls="risk-adult-detail"
          onClick={() => setDetail((current) => current === "adult" ? null : "adult")}
        >
          <span className="risk-response-action-icon"><RiskIcon name="people" /></span>
          <span><strong>3. 告诉可信任的大人</strong><small>现在去找家人、老师或身边能帮助你的大人</small></span>
          <RiskIcon name="arrow" />
        </button>
        {detail === "adult" && (
          <div className="risk-response-detail" id="risk-adult-detail" role="status">
            不知道怎么开口，可以照着说：“我遇到一件让我担心的事，我需要你现在陪着我一起处理。”
          </div>
        )}
      </section>

      <aside className="risk-response-boundary">
        <RiskIcon name="alert" />
        <p><strong>本页没有自动发送通知。</strong>小伴不是紧急救援服务；如果危险正在发生，请立即离开危险并当面找身边的大人。</p>
      </aside>
    </main>
  );
}
