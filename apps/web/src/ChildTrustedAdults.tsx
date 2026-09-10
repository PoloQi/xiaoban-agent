import { useEffect, useState, type ReactNode } from "react";

import {
  TRUSTED_ADULT_OPENING_LINE,
  type ChildTrustedAdult,
  type ChildTrustedAdultsResponse,
} from "@xiaoban/contracts";

import { ApiError } from "./api";
import { loadChildTrustedAdults } from "./trusted-adults";
import "./child-trusted-adults.css";

interface ChildTrustedAdultsProps {
  token: string;
  onBack: () => void;
  backLabel: string;
  onConfirmToldAdult?: () => void;
}

function TrustedIcon({ name }: { name: "back" | "people" | "talk" | "copy" | "check" | "shield" }) {
  const paths: Record<typeof name, ReactNode> = {
    back: <><path d="M19 12H5" /><path d="m10 7-5 5 5 5" /></>,
    people: <><circle cx="9" cy="8" r="3" /><path d="M3 20c.4-4.3 2.3-6.8 6-6.8s5.6 2.5 6 6.8" /><path d="M16 6.5a3 3 0 0 1 0 5.6M17.5 20c-.2-2.2-.7-3.9-1.6-5" /></>,
    talk: <><path d="M5 5h14v10H9l-4 4Z" /><path d="M9 9h6M9 12h4" /></>,
    copy: <><rect x="9" y="9" width="11" height="11" rx="2" /><path d="M15 9V6a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></>,
    check: <path d="m5 12 5 5 9-10" />,
    shield: <><path d="M12 3 19 6v5c0 4.5-2.5 8-7 10-4.5-2-7-5.5-7-10V6Z" /><path d="m9 12 2 2 4-5" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="trusted-icon">{paths[name]}</svg>;
}

function readableError(error: ApiError) {
  return <div className="trusted-error" role="alert"><strong>{error.message}</strong><span>{error.nextAction}</span></div>;
}

function trustedError(reason: unknown): ApiError {
  return reason instanceof ApiError
    ? reason
    : new ApiError("DEPENDENCY_UNAVAILABLE", "名单暂时没有打开。", "不用一直等，可以稍后再试。");
}

function AdultCard({ adult }: { adult: ChildTrustedAdult }) {
  const initial = adult.label.slice(0, 1);
  return (
    <article className="trusted-card" aria-label={`${adult.label}，${adult.relationshipLabel}`}>
      <span className="trusted-avatar" aria-hidden="true">{initial}</span>
      <div className="trusted-card-copy">
        <strong>{adult.label}</strong>
        <small>{adult.relationshipLabel} · {adult.channelLabel}</small>
        <span className={`trusted-reach trusted-reach-${adult.reachability}`}>
          <span className="trusted-reach-mark" aria-hidden="true">
            {adult.reachability === "available_now" ? <TrustedIcon name="check" /> : null}
          </span>
          {adult.reachabilityLabel}
        </span>
      </div>
      <button className="trusted-contact" type="button" disabled aria-disabled="true">
        <TrustedIcon name="talk" />
        <span>联系{adult.label}</span>
      </button>
    </article>
  );
}

export function ChildTrustedAdults({ token, onBack, backLabel, onConfirmToldAdult }: ChildTrustedAdultsProps) {
  const [data, setData] = useState<ChildTrustedAdultsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadChildTrustedAdults(token, controller.signal)
      .then((result) => {
        if (!controller.signal.aborted) setData(result);
      })
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(trustedError(reason));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey, token]);

  async function copyOpeningLine() {
    try {
      await navigator.clipboard.writeText(TRUSTED_ADULT_OPENING_LINE);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  }

  const adults = data?.adults ?? [];

  return (
    <section className="trusted-shell" aria-labelledby="trusted-title">
      <header className="trusted-topbar">
        <button type="button" onClick={onBack}><TrustedIcon name="back" />{backLabel}</button>
        <div>
          <p>REAL PEOPLE · 真人帮助</p>
          <strong id="trusted-title">找可信任的大人</strong>
        </div>
        <span><TrustedIcon name="shield" />已核验</span>
      </header>

      <div className="trusted-hero">
        <p>你不需要一个人扛着</p>
        <h1>选择你现在<br /><em>愿意联系的人。</em></h1>
        <span>这里只显示经过家人确认的大人。找不到人时，也可以直接告诉身边的老师。</span>
      </div>

      <section className="trusted-list" aria-live="polite" aria-busy={loading}>
        <div className="trusted-list-heading">
          <div><p>VERIFIED ADULTS</p><h2>可以找的人</h2></div>
          <span>{loading ? "正在核对" : error !== null ? "暂时不可用" : `${adults.length} 位`}</span>
        </div>

        {loading && <div className="trusted-loading" role="status"><span /><span /><span /><p>正在核对经过验证的大人…</p></div>}
        {!loading && error !== null && (
          <>
            {readableError(error)}
            <button className="trusted-retry" type="button" onClick={() => setReloadKey((value) => value + 1)}>重新加载</button>
          </>
        )}
        {!loading && error === null && adults.length === 0 && (
          <div className="trusted-empty">
            <TrustedIcon name="people" />
            <h3>现在还没有经过确认的大人</h3>
            <p>可以先告诉身边的家人或老师，或者稍后请大人帮你确认。</p>
          </div>
        )}
        {!loading && error === null && adults.length > 0 && (
          <div className="trusted-cards">{adults.map((adult) => <AdultCard key={adult.id} adult={adult} />)}</div>
        )}
      </section>

      <article className="trusted-script">
        <div className="trusted-script-heading"><p>HOW TO START</p><h2>不知道怎么开口？</h2></div>
        <p className="trusted-script-line">“{TRUSTED_ADULT_OPENING_LINE}”</p>
        <button className="trusted-copy" type="button" onClick={() => void copyOpeningLine()}>
          <TrustedIcon name={copied ? "check" : "copy"} />
          {copied ? "已经复制，可以照着读" : "复制这句话"}
        </button>
        <span className="trusted-script-hint" role="status">{copied ? "去找一位大人，把这句话读给他听。" : "可以先照着念，不用自己组织语言。"}</span>
      </article>

      <aside className="trusted-boundary">
        <TrustedIcon name="shield" />
        <p><strong>这一版只帮你找到人。</strong>联系按钮不会真的拨号、发短信或发消息，小伴也不会替你通知任何人。请自己去找对方当面说，或请老师陪你联系家人。</p>
      </aside>

      {onConfirmToldAdult !== undefined && (
        <button
          className="trusted-confirm"
          type="button"
          onClick={onConfirmToldAdult}
          aria-label="我已告诉身边的大人，进入完成页"
        >
          <TrustedIcon name="check" />
          <span><strong>我已告诉他/她</strong><small>你已经迈出了求助的一步</small></span>
        </button>
      )}

      <button className="trusted-back" type="button" onClick={onBack}><TrustedIcon name="back" />{backLabel}</button>
    </section>
  );
}
