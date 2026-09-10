import { useEffect, useState, type ReactNode } from "react";

import {
  childContentDetailSchema,
  childContentListResponseSchema,
  type ChildChatResponse,
  type ChildContentDetail,
  type ChildContentSummary,
} from "@xiaoban/contracts";

import { ApiError, requestJson } from "./api";
import {
  ACTIVITY_TARGET_OPTIONS,
  chooseEncouragement,
  formatRemainingSeconds,
  parseCustomTarget,
} from "./activity-timer";
import { ChildChat } from "./ChildChat";
import { ChildGrowthPlan } from "./ChildGrowthPlan";
import { ChildHome } from "./ChildHome";
import { ChildKnowledgeCenter } from "./ChildKnowledgeCenter";
import { ChildProfile } from "./ChildProfile";
import { ChildRiskResponse } from "./ChildRiskResponse";
import { ChildRiskSent } from "./ChildRiskSent";
import { ChildTrustedAdults } from "./ChildTrustedAdults";
import { recordChildGrowthAttempt } from "./growth-plan";
import type { CompletedChildProfile } from "./profile";
import {
  clearChildContentCache,
  readCachedContentDetail,
  readCachedContentList,
  writeCachedContentDetail,
  writeCachedContentList,
} from "./content-cache";

type ContentFilter = "all" | "activity" | "knowledge";
type ActivityFeeling = "lighter" | "same" | "rest";
type ActivityStage = "target" | "timer" | "completion";

interface ChildContentProps {
  profile: CompletedChildProfile;
  token: string;
  onExit: () => void;
  onOpenAdult?: () => Promise<void>;
}

function Icon({ name }: { name: "arrow" | "back" | "book" | "chat" | "clock" | "leaf" | "person" | "pin" | "plan" | "shield" }) {
  const paths: Record<typeof name, ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    back: <><path d="M19 12H5" /><path d="m10 7-5 5 5 5" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5Z" /></>,
    chat: <path d="M5 5h14v10H9l-4 4Z" />,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></>,
    leaf: <><path d="M20 4C11 4 5 9 5 18c6 1 13-3 15-14Z" /><path d="M5 20c4-6 8-10 13-14" /></>,
    person: <><circle cx="12" cy="8" r="3" /><path d="M6 20c.5-4.5 2.5-7 6-7s5.5 2.5 6 7" /></>,
    pin: <><path d="M12 21s6-5.5 6-11a6 6 0 1 0-12 0c0 5.5 6 11 6 11Z" /><circle cx="12" cy="10" r="2" /></>,
    plan: <><path d="M6 4h12v16H6z" /><path d="M9 8h6M9 12h6M9 16h4" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.5-2.5 8-7 10-4.5-2-7-5.5-7-10V6Z" /><path d="m9 12 2 2 4-5" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="content-icon">{paths[name]}</svg>;
}

function readableError(error: ApiError | null) {
  if (error === null) return null;
  return <div className="content-error" role="alert"><strong>{error.message}</strong><span>{error.nextAction}</span></div>;
}

function contentError(reason: unknown): ApiError {
  if (
    reason instanceof ApiError &&
    ["UNAUTHORIZED", "FORBIDDEN", "ACCOUNT_DEACTIVATED"].includes(reason.code)
  ) {
    return reason;
  }
  return new ApiError(
    "DEPENDENCY_UNAVAILABLE",
    "内容暂时没有打开。",
    "不用一直等待，可以稍后再试。",
  );
}

function isAccessError(reason: unknown): boolean {
  return reason instanceof ApiError
    && ["UNAUTHORIZED", "FORBIDDEN", "ACCOUNT_DEACTIVATED"].includes(reason.code);
}

function locationLabel(value: "indoor" | "outdoor" | "either") {
  return value === "indoor" ? "室内" : value === "outdoor" ? "户外" : "室内或户外";
}

function movementLabel(value: "move" | "quiet") {
  return value === "move" ? "想动一动" : "安静做点事";
}

function supervisionLabel(value: "none" | "recommended" | "required") {
  return value === "required" ? "需要成人陪同" : value === "recommended" ? "建议成人在旁" : "可以自己完成";
}

function topicLabel(value: "general_growth" | "emotional_social" | "digital_safety" | "body_boundaries") {
  if (value === "digital_safety") return "网络安全";
  if (value === "emotional_social") return "心情与相处";
  if (value === "body_boundaries") return "身体与边界";
  return "成长小知识";
}

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

function ContentCard({ item, onOpen }: { item: ChildContentSummary; onOpen: () => void }) {
  return (
    <button className={`field-card field-card-${item.type}`} type="button" onClick={onOpen}>
      <span className="field-card-mark"><Icon name={item.type === "activity" ? "leaf" : "book"} /></span>
      <span className="field-card-copy">
        <span className="field-card-type">{item.type === "activity" ? "现实活动" : topicLabel(item.topic)}</span>
        <strong>{item.title}</strong>
        <span className="field-card-summary">{item.summary}</span>
        <span className="field-card-meta">
          {item.type === "activity" ? `${movementLabel(item.movement)} · ${item.durationMinutes}分钟 · ${locationLabel(item.location)}` : "短短几段 · 慢慢读"}
        </span>
      </span>
      <span className="field-card-arrow"><Icon name="arrow" /></span>
    </button>
  );
}

export function ChildContent({ profile, token, onExit, onOpenAdult }: ChildContentProps) {
  const { ageBand: childAgeBand, alias: childAlias, companion } = profile;
  const [tab, setTab] = useState<"chat" | "content" | "growth" | "profile">("chat");
  const [chatView, setChatView] = useState<"home" | "chat">("home");
  const [chatMode, setChatMode] = useState<"bored" | "help" | undefined>();
  const [chatKey, setChatKey] = useState(0);
  const [filter, setFilter] = useState<ContentFilter>("all");
  const [movementFilter, setMovementFilter] = useState<"all" | "move" | "quiet">("all");
  const [items, setItems] = useState<ChildContentSummary[]>([]);
  const [detail, setDetail] = useState<ChildContentDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [recordingActivity, setRecordingActivity] = useState(false);
  const [activityRecordError, setActivityRecordError] = useState<ApiError | null>(null);
  const [activityStage, setActivityStage] = useState<ActivityStage | null>(null);
  const [targetMinutes, setTargetMinutes] = useState(5);
  const [customMinutes, setCustomMinutes] = useState("");
  const [remainingSeconds, setRemainingSeconds] = useState(0);
  const [timerRunning, setTimerRunning] = useState(false);
  const [encouragement, setEncouragement] = useState("");
  const [safetyResponse, setSafetyResponse] = useState<Extract<ChildChatResponse, { route: "fixed_safety" }> | null>(null);
  const [riskSentOpen, setRiskSentOpen] = useState(false);
  const [knowledgeOrigin, setKnowledgeOrigin] = useState<"home" | "profile" | null>(null);
  const [trustedOrigin, setTrustedOrigin] = useState<"home" | "profile" | "risk" | null>(null);
  const visibleItems = items
    .filter((item) => filter === "all" || item.type === filter)
    .filter((item) => {
      if (movementFilter === "all") return true;
      return item.type === "activity" && item.movement === movementFilter;
    });

  function selectFilter(value: ContentFilter) {
    setFilter(value);
    setMovementFilter("all");
  }

  useEffect(() => {
    if (!timerRunning || activityStage !== "timer") return;
    const timer = window.setInterval(() => {
      setRemainingSeconds((value) => {
        if (value <= 1) {
          window.clearInterval(timer);
          setTimerRunning(false);
          setActivityStage("completion");
          return 0;
        }
        return value - 1;
      });
    }, 1_000);
    return () => window.clearInterval(timer);
  }, [activityStage, timerRunning]);

  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const result = await requestJson(
          "/api/v1/child/content?type=all&limit=20&offset=0",
          {
            method: "GET",
            signal: controller.signal,
            headers: { authorization: `Bearer ${token}` },
          },
          childContentListResponseSchema,
        );
        setItems(result.items);
        setCachedAt(null);
        writeCachedContentList(childAgeBand, result);
      } catch (reason) {
        if (!controller.signal.aborted) {
          if (isAccessError(reason)) {
            clearChildContentCache();
            setError(contentError(reason));
          } else {
            const cached = readCachedContentList(childAgeBand);
            if (cached === null) {
              setError(contentError(reason));
            } else {
              setItems(cached.value.items);
              setCachedAt(cached.cachedAt);
            }
          }
        }
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    return () => controller.abort();
  }, [childAgeBand, reloadKey, token]);

  async function openDetail(slug: string) {
    setLoading(true);
    setError(null);
    try {
      const result = await requestJson(
        `/api/v1/child/content/${slug}`,
        { method: "GET", headers: { authorization: `Bearer ${token}` } },
        childContentDetailSchema,
      );
      setDetail(result);
      setCachedAt(null);
      writeCachedContentDetail(childAgeBand, result);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      if (isAccessError(reason)) {
        clearChildContentCache();
        setError(contentError(reason));
      } else {
        const summary = items.find((item) => item.slug === slug);
        const cached = summary === undefined
          ? null
          : readCachedContentDetail(childAgeBand, slug, summary.revision);
        if (cached === null) {
          setError(contentError(reason));
        } else {
          setDetail(cached.value);
          setCachedAt(cached.cachedAt);
          window.scrollTo({ top: 0, behavior: "smooth" });
        }
      }
    } finally {
      setLoading(false);
    }
  }

  function beginActivityTimer(minutes: number) {
    setTargetMinutes(minutes);
    setRemainingSeconds(minutes * 60);
    setEncouragement(chooseEncouragement());
    setTimerRunning(true);
    setActivityStage("timer");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeActivityFlow() {
    setActivityStage(null);
    setTimerRunning(false);
    setRemainingSeconds(0);
    setCustomMinutes("");
    setActivityRecordError(null);
  }

  async function finishActivity(activitySlug: string, feeling?: ActivityFeeling) {
    setRecordingActivity(true);
    setActivityRecordError(null);
    try {
      await recordChildGrowthAttempt(token, {
        source: "activity",
        activitySlug,
        targetMinutes,
        ...(feeling === undefined ? {} : { feeling }),
      });
      closeActivityFlow();
      setDetail(null);
      setTab("growth");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      setActivityRecordError(contentError(reason));
    } finally {
      setRecordingActivity(false);
    }
  }

  function openChat(mode?: "bored" | "help") {
    setChatMode(mode);
    setChatKey((value) => value + 1);
    setChatView("chat");
    setTab("chat");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openActivitiesFromChat(movement: "move" | "quiet") {
    setDetail(null);
    setFilter("activity");
    setMovementFilter(movement);
    setChatView("home");
    setTab("content");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openHome() {
    setDetail(null);
    setKnowledgeOrigin(null);
    setChatView("home");
    setTab("chat");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openKnowledge(origin: "home" | "profile") {
    setDetail(null);
    setKnowledgeOrigin(origin);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeKnowledge() {
    const origin = knowledgeOrigin;
    setKnowledgeOrigin(null);
    if (origin === "profile") setTab("profile");
    else {
      setChatView("home");
      setTab("chat");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function openTrusted(origin: "home" | "profile" | "risk") {
    setDetail(null);
    setTrustedOrigin(origin);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function closeTrusted() {
    const origin = trustedOrigin;
    setTrustedOrigin(null);
    if (origin === "profile") setTab("profile");
    else if (origin === "home") {
      setChatView("home");
      setTab("chat");
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (riskSentOpen) {
    return (
      <ChildRiskSent
        onBackHome={() => {
          setRiskSentOpen(false);
          setTrustedOrigin(null);
          setSafetyResponse(null);
          setChatView("home");
          setTab("chat");
          window.scrollTo({ top: 0 });
        }}
        {...(onOpenAdult === undefined ? {} : {
          onOpenAdultPreview: () => void onOpenAdult(),
        })}
      />
    );
  }

  if (trustedOrigin !== null) {
    return (
      <ChildTrustedAdults
        token={token}
        onBack={closeTrusted}
        backLabel={trustedOrigin === "profile" ? "返回我的" : trustedOrigin === "risk" ? "返回安全指引" : "返回儿童首页"}
        {...(trustedOrigin === "risk" ? { onConfirmToldAdult: () => setRiskSentOpen(true) } : {})}
      />
    );
  }

  if (safetyResponse !== null) {
    return (
      <ChildRiskResponse
        response={safetyResponse}
        onExitChat={() => {
          setSafetyResponse(null);
          setChatView("home");
          setTab("chat");
          window.scrollTo({ top: 0 });
        }}
        onOpenTrusted={() => openTrusted("risk")}
      />
    );
  }

  if (knowledgeOrigin !== null) {
    return (
      <ChildKnowledgeCenter
        ageBand={childAgeBand}
        token={token}
        onBack={closeKnowledge}
        backLabel={knowledgeOrigin === "profile" ? "返回我的" : "返回儿童首页"}
      />
    );
  }

  if (tab === "content" && detail !== null) {
    if (detail.type === "activity" && activityStage !== null) {
      const parsedCustomMinutes = parseCustomTarget(customMinutes);
      return (
        <main className="content-shell activity-flow-shell">
          <header className="content-topbar">
            <button className="round-action" type="button" onClick={closeActivityFlow} aria-label="退出活动计时"><Icon name="back" /></button>
            <span className="content-topbar-title">{detail.title}</span>
            <span className="reviewed-mark"><Icon name="shield" />人工审核</span>
          </header>

          {activityStage === "target" ? (
            <section className="activity-target-panel">
              <p className="detail-kicker">CHOOSE A SMALL GOAL</p>
              <h1>这次想坚持多久？</h1>
              <p>活动建议用时 {detail.durationMinutes} 分钟。你可以按自己的状态选一个小目标。</p>
              <div className="activity-target-options" aria-label="目标时间">
                {ACTIVITY_TARGET_OPTIONS.map((minutes) => (
                  <button type="button" key={minutes} onClick={() => beginActivityTimer(minutes)}>
                    <strong>{minutes}</strong><span>分钟</span>
                  </button>
                ))}
              </div>
              <div className="activity-custom-target">
                <label htmlFor="activity-custom-minutes">自定义分钟数</label>
                <div>
                  <input
                    id="activity-custom-minutes"
                    type="number"
                    inputMode="numeric"
                    min="1"
                    max="120"
                    value={customMinutes}
                    onChange={(event) => setCustomMinutes(event.target.value)}
                    placeholder="1—120"
                  />
                  <button type="button" disabled={parsedCustomMinutes === null} onClick={() => parsedCustomMinutes !== null && beginActivityTimer(parsedCustomMinutes)}>开始</button>
                </div>
                {customMinutes !== "" && parsedCustomMinutes === null && <p role="alert">请输入 1 到 120 之间的整数分钟。</p>}
              </div>
              <button className="activity-quiet-exit" type="button" onClick={closeActivityFlow}>先不开始，返回活动详情</button>
            </section>
          ) : activityStage === "timer" ? (
            <section className="activity-timer-panel">
              <p className="detail-kicker">YOUR OWN PACE</p>
              <h1>{formatRemainingSeconds(remainingSeconds)}</h1>
              <p className="activity-timer-status" role="status">{timerRunning ? `正在进行 ${targetMinutes} 分钟目标` : "计时已暂停"}</p>
              <blockquote>{encouragement}</blockquote>
              <div className="activity-timer-actions">
                <button type="button" onClick={() => setTimerRunning((value) => !value)}>{timerRunning ? "暂停" : "继续"}</button>
                <button type="button" onClick={() => { setTimerRunning(false); setActivityStage("completion"); }}>我已经完成</button>
              </div>
              <button className="activity-quiet-exit" type="button" onClick={closeActivityFlow}>先退出，不算失败</button>
            </section>
          ) : (
            <section className="activity-completion-panel">
              <p className="detail-kicker">A REAL-WORLD STEP</p>
              <h1>做完以后，感觉怎么样？</h1>
              <p>你完成了一个 {targetMinutes} 分钟的小目标。感觉可以跳过，不影响这次记录。</p>
              {activityRecordError !== null && readableError(activityRecordError)}
              <div className="activity-feeling-options">
                <button type="button" disabled={recordingActivity} onClick={() => void finishActivity(detail.slug, "lighter")}>轻松一点</button>
                <button type="button" disabled={recordingActivity} onClick={() => void finishActivity(detail.slug, "same")}>差不多</button>
                <button type="button" disabled={recordingActivity} onClick={() => void finishActivity(detail.slug, "rest")}>还想休息</button>
              </div>
              <button className="activity-skip-feeling" type="button" disabled={recordingActivity} onClick={() => void finishActivity(detail.slug)}>{recordingActivity ? "正在记录…" : "跳过感觉，记录这次尝试"}</button>
            </section>
          )}
        </main>
      );
    }
    return (
      <main className="content-shell content-detail-shell">
        <header className="content-topbar">
          <button className="round-action" type="button" onClick={() => setDetail(null)} aria-label="返回内容列表"><Icon name="back" /></button>
          <span className="content-topbar-title">山野观察手册</span>
          <span className="reviewed-mark"><Icon name="shield" />人工审核</span>
        </header>

        {cachedAt !== null && (
          <div className="content-cache-notice" role="status">
            网络暂时不稳定，正在显示最近保存的审核内容。
          </div>
        )}

        <article className={`content-detail content-detail-${detail.type}`}>
          <div className="detail-index" aria-hidden="true">{detail.type === "activity" ? "ACTION" : "NOTE"}</div>
          <p className="detail-kicker">{detail.type === "activity" ? "离开屏幕的一件小事" : topicLabel(detail.topic)}</p>
          <h1>{detail.title}</h1>
          <p className="detail-lead">{detail.summary}</p>
          <div className="detail-facts">
            {detail.type === "activity" ? (
              <>
                <span><Icon name="leaf" />{movementLabel(detail.movement)}</span>
                <span><Icon name="clock" />{detail.durationMinutes}分钟</span>
                <span><Icon name="pin" />{locationLabel(detail.location)}</span>
                <span><Icon name="person" />{supervisionLabel(detail.adultSupervision)}</span>
              </>
            ) : <span><Icon name="book" />读完随时可以停下来</span>}
          </div>

          {detail.type === "activity" ? (
            <section className="detail-body">
              <div className="detail-section-heading"><span>HOW TO</span><h2>跟着步骤做</h2></div>
              {detail.materials.length > 0 && <p className="materials-note"><strong>准备：</strong>{detail.materials.join("、")}</p>}
              <ol className="field-steps">{detail.steps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></li>)}</ol>
              <div className="activity-complete-action">
                {activityRecordError !== null && readableError(activityRecordError)}
                <button type="button" onClick={() => { setTargetMinutes(detail.durationMinutes); setActivityStage("target"); window.scrollTo({ top: 0, behavior: "smooth" }); }}>开始活动</button>
                <p>先选一个目标时间。退出计时不算失败，完成后才会记录。</p>
              </div>
            </section>
          ) : (
            <section className="detail-body reading-body">
              <div className="detail-section-heading"><span>READ SLOWLY</span><h2>慢慢读一读</h2></div>
              {detail.paragraphs.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
            </section>
          )}

          <footer className="detail-source">
            <Icon name="shield" />
            <span><strong>{detail.reviewLabel} · 审核于{dateLabel(detail.reviewedAt)}</strong>来源：{detail.sourceLabel} · 有效至{dateLabel(detail.expiresAt)}</span>
          </footer>
        </article>
        <button className="back-to-list" type="button" onClick={() => setDetail(null)}><Icon name="back" />返回活动与知识</button>
      </main>
    );
  }

  return (
    <main className="content-shell content-list-shell">
      <header className="content-topbar">
        <a className="content-brand" href="#content" aria-label="小伴内容首页"><Icon name="leaf" /><span><strong>小伴</strong><small>{tab === "chat" ? "陪我聊" : tab === "growth" ? "成长计划" : tab === "profile" ? "我的" : "活动与知识"}</small></span></a>
        <button className="exit-content" type="button" onClick={onExit}>退出儿童内容</button>
      </header>

      {tab === "profile" ? <ChildProfile profile={profile} onOpenKnowledge={() => openKnowledge("profile")} onOpenTrusted={() => openTrusted("profile")} {...(onOpenAdult === undefined ? {} : { onOpenAdult })} /> : tab === "growth" ? <ChildGrowthPlan token={token} /> : tab === "content" ? (
        <>
          <section className="content-hero">
            <div>
              <p className="detail-kicker">给 {childAlias} 的今日手册</p>
              <h1>从屏幕里走出来，<em>去看真实世界。</em></h1>
              <p>这里只有人工审核过、适合你年龄的活动和知识。</p>
            </div>
            <div className="hero-orbit" aria-hidden="true"><Icon name="leaf" /><span>01</span><small>FIELD<br />NOTES</small></div>
          </section>

          <section className="content-library" aria-live="polite">
            <div className="library-heading"><div><p>EXPLORE</p><h2>今天想看什么？</h2></div><span>{loading ? "正在整理" : error === null ? `${visibleItems.length} 项可看` : "暂时不可用"}</span></div>
            <div className="content-filters" aria-label="内容分类">
              {([ ["all", "都看看"], ["activity", "现实活动"], ["knowledge", "成长知识"] ] as const).map(([value, label]) => (
                <button key={value} className={filter === value ? "is-active" : ""} type="button" aria-pressed={filter === value} onClick={() => selectFilter(value)}>{label}</button>
              ))}
            </div>

            {filter === "activity" && (
              <div className="content-subfilters" aria-label="活动方式">
                {([ ["all", "都看看"], ["move", "想动一动"], ["quiet", "安静做点事"] ] as const).map(([value, label]) => (
                  <button key={value} className={movementFilter === value ? "is-active" : ""} type="button" aria-pressed={movementFilter === value} onClick={() => setMovementFilter(value)}>{label}</button>
                ))}
              </div>
            )}

            {cachedAt !== null && (
              <div className="content-cache-notice" role="status">
                网络暂时不稳定，正在显示最近保存的审核内容。
              </div>
            )}
            {readableError(error)}
            {error !== null && <button className="retry-content" type="button" onClick={() => setReloadKey((value) => value + 1)}>重新加载</button>}
            {loading && <div className="content-loading" role="status"><span /><span /><span /><p>正在翻开经过审核的内容…</p></div>}
            {!loading && error === null && visibleItems.length === 0 && <div className="content-empty"><Icon name="book" /><h3>这一页暂时是空的</h3><p>可以换个分类看看，或者稍后再来。</p></div>}
            {!loading && error === null && visibleItems.length > 0 && <div className="field-card-list">{visibleItems.map((item) => <ContentCard key={item.slug} item={item} onOpen={() => void openDetail(item.slug)} />)}</div>}
          </section>

          <aside className="real-world-note"><Icon name="person" /><p><strong>遇到困难，不用只看屏幕。</strong>可以随时停下来，去找身边可信任的大人。</p></aside>
        </>
      ) : chatView === "home" ? (
        <ChildHome
          alias={childAlias}
          companion={companion}
          token={token}
          onOpenChat={openChat}
          onOpenContent={() => {
            setDetail(null);
            selectFilter("activity");
            setTab("content");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
          onOpenKnowledge={() => openKnowledge("home")}
          onOpenTrusted={() => openTrusted("home")}
          onOpenGrowth={() => {
            setDetail(null);
            setTab("growth");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        />
      ) : (
        <ChildChat
          key={chatKey}
          token={token}
          childAlias={childAlias}
          companion={companion}
          {...(chatMode === undefined ? {} : { initialMode: chatMode })}
          onBack={openHome}
          onSafetyResponse={setSafetyResponse}
          onOpenActivities={openActivitiesFromChat}
        />
      )}

      {!(tab === "chat" && chatView === "chat") && <nav className="child-bottom-nav" aria-label="儿童端主导航">
        <button type="button" className={tab === "chat" ? "is-current" : ""} aria-current={tab === "chat" ? "page" : undefined} onClick={openHome}><Icon name="chat" /><span>陪我聊</span></button>
        <button type="button" className={tab === "content" ? "is-current" : ""} aria-current={tab === "content" ? "page" : undefined} onClick={() => setTab("content")}><Icon name="leaf" /><span>去做点事</span></button>
        <button type="button" className={tab === "growth" ? "is-current" : ""} aria-current={tab === "growth" ? "page" : undefined} onClick={() => { setDetail(null); setTab("growth"); }}><Icon name="plan" /><span>成长计划</span></button>
        <button type="button" className={tab === "profile" ? "is-current" : ""} aria-current={tab === "profile" ? "page" : undefined} onClick={() => { setDetail(null); setTab("profile"); }}><Icon name="person" /><span>我的</span></button>
      </nav>}
    </main>
  );
}
