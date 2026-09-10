import { useEffect, useState, type ReactNode } from "react";

import type { ChildCompanion, ChildGrowthPlanResponse, ChildMood } from "@xiaoban/contracts";

import { ApiError } from "./api";
import { COMPANION_COPY, CompanionIllustration } from "./companion";
import { loadChildGrowthPlan } from "./growth-plan";
import { loadChildMoodCheckIn, saveChildMoodCheckIn } from "./mood-check-in";
import "./child-home.css";

interface ChildHomeProps {
  alias: string;
  companion: ChildCompanion;
  token: string;
  onOpenChat: (mode?: "bored" | "help") => void;
  onOpenContent: () => void;
  onOpenKnowledge: () => void;
  onOpenGrowth: () => void;
  onOpenTrusted: () => void;
}

const MOODS: ReadonlyArray<{ value: ChildMood; label: string }> = [
  { value: "happy", label: "开心" },
  { value: "calm", label: "平静" },
  { value: "bored", label: "无聊" },
  { value: "sad", label: "难过" },
  { value: "angry", label: "生气" },
  { value: "worried", label: "担心" },
];

function HomeIcon({ name }: { name: "arrow" | "book" | "chat" | "help" | "leaf" }) {
  const paths: Record<typeof name, ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21.5Z" /></>,
    chat: <path d="M5 5h14v10H9l-4 4Z" />,
    help: <><path d="M12 21s7-4.4 7-11V5l-7-2-7 2v5c0 6.6 7 11 7 11Z" /><path d="M9.5 9a2.6 2.6 0 0 1 5 .8c0 1.8-2.5 2-2.5 3.7M12 17h.01" /></>,
    leaf: <><path d="M20 4C11 4 5 9 5 18c6 1 13-3 15-14Z" /><path d="M5 20c4-6 8-10 13-14" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="home-icon">{paths[name]}</svg>;
}

function MoodFace({ mood }: { mood: ChildMood }) {
  const mouth = mood === "happy"
    ? "M7 13c1.8 3 8.2 3 10 0"
    : mood === "calm" ? "M8 15h8"
      : mood === "bored" ? "M9 15h6"
        : mood === "sad" || mood === "worried" ? "M8 16c2-3 6-3 8 0"
          : "M8 15c2 1.2 6 1.2 8 0";
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="mood-face">
      <circle cx="12" cy="12" r="9" />
      {mood === "angry" ? <><path d="m7.5 9 3 1M16.5 9l-3 1" /></> : <><path d="M8.5 9.5h.01M15.5 9.5h.01" /></>}
      <path d={mouth} />
    </svg>
  );
}

function serviceError(reason: unknown, message: string): ApiError {
  return reason instanceof ApiError
    ? reason
    : new ApiError("DEPENDENCY_UNAVAILABLE", message, "请稍后再试。");
}

export function ChildHome({ alias, companion, token, onOpenChat, onOpenContent, onOpenKnowledge, onOpenGrowth, onOpenTrusted }: ChildHomeProps) {
  const [mood, setMood] = useState<ChildMood | null>(null);
  const [moodLoading, setMoodLoading] = useState(true);
  const [moodSaving, setMoodSaving] = useState<ChildMood | "clear" | null>(null);
  const [moodError, setMoodError] = useState<ApiError | null>(null);
  const [plan, setPlan] = useState<ChildGrowthPlanResponse | null>(null);
  const [planError, setPlanError] = useState<ApiError | null>(null);
  const companionName = COMPANION_COPY[companion].name;

  useEffect(() => {
    const controller = new AbortController();
    Promise.allSettled([
      loadChildMoodCheckIn(token, controller.signal),
      loadChildGrowthPlan(token, controller.signal),
    ]).then(([moodResult, planResult]) => {
      if (controller.signal.aborted) return;
      if (moodResult.status === "fulfilled") setMood(moodResult.value.mood);
      else setMoodError(serviceError(moodResult.reason, "今天的签到暂时没有打开。"));
      if (planResult.status === "fulfilled") setPlan(planResult.value);
      else setPlanError(serviceError(planResult.reason, "今日小计划暂时没有打开。"));
      setMoodLoading(false);
    });
    return () => controller.abort();
  }, [token]);

  async function chooseMood(nextMood: ChildMood) {
    if (moodSaving !== null) return;
    const value = mood === nextMood ? null : nextMood;
    setMoodSaving(value ?? "clear");
    setMoodError(null);
    try {
      const result = await saveChildMoodCheckIn(token, value);
      setMood(result.mood);
      if (result.mood === "bored") onOpenChat("bored");
    } catch (reason) {
      setMoodError(serviceError(reason, "这次签到还没有记下来。"));
    } finally {
      setMoodSaving(null);
    }
  }

  const progress = plan === null
    ? 0
    : Math.min(100, (plan.goal.attemptCount / plan.goal.targetAttempts) * 100);

  return (
    <div className="child-home">
      <section className="home-hero">
        <div className="home-hero-copy">
          <p className="home-eyebrow">TODAY · 和自己打个招呼</p>
          <h1>嗨，{alias}。</h1>
          <p>{companionName}在这里。你可以聊一聊，也可以去做一件屏幕外的小事。</p>
          <button type="button" onClick={() => onOpenChat()}><HomeIcon name="chat" />开始聊天<HomeIcon name="arrow" /></button>
        </div>
        <CompanionIllustration companion={companion} className="home-companion" />
      </section>

      <section className="home-section home-mood-section" aria-labelledby="mood-heading">
        <div className="home-section-heading">
          <div><p>MOOD CHECK-IN</p><h2 id="mood-heading">现在的心情像什么？</h2></div>
          <span>{mood === null ? "可以跳过" : "已记下今天"}</span>
        </div>
        <div className="mood-grid" aria-busy={moodLoading || moodSaving !== null}>
          {MOODS.map((item) => (
            <button
              key={item.value}
              type="button"
              className={mood === item.value ? "is-selected" : ""}
              aria-pressed={mood === item.value}
              disabled={moodLoading || moodSaving !== null}
              onClick={() => void chooseMood(item.value)}
            >
              <MoodFace mood={item.value} />
              <span>{moodSaving === item.value ? "正在记…" : item.label}</span>
            </button>
          ))}
        </div>
        {moodLoading && <p className="home-status" role="status">正在看看今天有没有签到…</p>}
        {moodError !== null && <div className="home-inline-error" role="alert"><strong>{moodError.message}</strong><span>{moodError.nextAction}</span></div>}
        {mood !== null && !moodLoading && <button className="clear-mood" type="button" disabled={moodSaving !== null} onClick={() => void chooseMood(mood)}>清除今天的签到</button>}
      </section>

      <section className="home-section" aria-labelledby="quick-heading">
        <div className="home-section-heading"><div><p>QUICK START</p><h2 id="quick-heading">现在想做什么？</h2></div></div>
        <div className="home-quick-grid">
          <button type="button" onClick={() => onOpenChat()}><span><HomeIcon name="chat" /></span><strong>聊一聊</strong><small>把现在想说的告诉{companionName}</small><HomeIcon name="arrow" /></button>
          <button type="button" onClick={onOpenContent}><span><HomeIcon name="leaf" /></span><strong>找点事做</strong><small>离开屏幕，做一件现实小事</small><HomeIcon name="arrow" /></button>
          <button type="button" onClick={onOpenKnowledge}><span><HomeIcon name="book" /></span><strong>学会保护自己</strong><small>进入知识中心和情景小练习</small><HomeIcon name="arrow" /></button>
          <button type="button" onClick={onOpenTrusted}><span><HomeIcon name="help" /></span><strong>我需要帮助</strong><small>看看现在可以找哪位可信任的大人</small><HomeIcon name="arrow" /></button>
        </div>
      </section>

      <section className="home-section home-plan-section" aria-labelledby="plan-heading">
        <div className="home-section-heading"><div><p>TODAY'S SMALL PLAN</p><h2 id="plan-heading">今日小计划</h2></div><span>一周只选一个</span></div>
        {plan === null ? (
          <div className="home-plan-state" role={planError === null ? "status" : "alert"}>
            <strong>{planError === null ? "正在读取真实进度…" : planError.message}</strong>
            <span>{planError?.nextAction ?? "不会用虚构数字代替。"}</span>
          </div>
        ) : (
          <button className="home-plan-card" type="button" onClick={onOpenGrowth}>
            <div className="home-plan-copy"><span>本周目标</span><strong>{plan.goal.title}</strong><small>{plan.goal.alternativeAction}</small></div>
            <div className="home-plan-progress">
              <strong>{plan.goal.attemptCount}<small> / {plan.goal.targetAttempts} 次</small></strong>
              <span className="home-plan-track" aria-label={`本周完成进度${Math.round(progress)}%`}><i style={{ width: `${progress}%` }} /></span>
              <b>{plan.goal.todayRecorded ? "今天已记录" : "查看计划"}<HomeIcon name="arrow" /></b>
            </div>
          </button>
        )}
      </section>
    </div>
  );
}
