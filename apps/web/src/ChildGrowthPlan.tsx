import { useEffect, useState, type ReactNode } from "react";

import type { ChildGrowthPlanResponse } from "@xiaoban/contracts";

import { ApiError } from "./api";
import { loadChildGrowthPlan, recordChildGrowthAttempt } from "./growth-plan";
import "./growth-plan.css";

interface ChildGrowthPlanProps {
  token: string;
}

function GrowthIcon({ name }: { name: "activity" | "arrow" | "calendar" | "check" | "leaf" | "report" }) {
  const paths: Record<typeof name, ReactNode> = {
    activity: <><circle cx="12" cy="5" r="2" /><path d="M12 7v6M12 10 7 8M12 10l5-2M12 13l-4 8M12 13l5 8" /></>,
    arrow: <><path d="M19 12H5" /><path d="m10 7-5 5 5 5" /></>,
    calendar: <><rect x="4" y="4" width="16" height="17" rx="3" /><path d="M8 2v4M16 2v4M4 9h16" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    leaf: <><path d="M20 4C11 4 5 9 5 18c6 1 13-3 15-14Z" /><path d="M5 20c4-6 8-10 13-14" /></>,
    report: <><path d="M5 20V10M11 20V4M17 20v-7M22 20H2" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="growth-icon">{paths[name]}</svg>;
}

function weekLabel(plan: ChildGrowthPlanResponse): string {
  const format = (value: string) => {
    const [, month, day] = value.split("-");
    return `${Number(month)}月${Number(day)}日`;
  };
  return `${format(plan.week.startDate)}—${format(plan.week.endDate)}`;
}

export function ChildGrowthPlan({ token }: ChildGrowthPlanProps) {
  const [plan, setPlan] = useState<ChildGrowthPlanResponse | null>(null);
  const [view, setView] = useState<"plan" | "review">("plan");
  const [loading, setLoading] = useState(true);
  const [recording, setRecording] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    loadChildGrowthPlan(token, controller.signal)
      .then(setPlan)
      .catch((reason) => {
        if (!controller.signal.aborted) {
          setError(reason instanceof ApiError
            ? reason
            : new ApiError("DEPENDENCY_UNAVAILABLE", "成长计划暂时没有打开。", "请稍后重试。"));
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [reloadKey, token]);

  async function recordToday() {
    if (recording || plan?.goal.todayRecorded) return;
    setRecording(true);
    setError(null);
    try {
      setPlan(await recordChildGrowthAttempt(token, { source: "manual" }));
    } catch (reason) {
      setError(reason instanceof ApiError
        ? reason
        : new ApiError("DEPENDENCY_UNAVAILABLE", "这次尝试还没有记下来。", "请稍后重试。"));
    } finally {
      setRecording(false);
    }
  }

  if (loading && plan === null) {
    return <section className="growth-page growth-state" role="status"><span className="growth-loader" /><h1>正在翻开成长计划…</h1><p>只看真实记录，不给你打分。</p></section>;
  }

  if (plan === null) {
    return (
      <section className="growth-page growth-state" role="alert">
        <GrowthIcon name="calendar" />
        <h1>成长计划暂时没有打开</h1>
        <p>{error?.nextAction ?? "请稍后再试。"}</p>
        <button type="button" className="growth-secondary-button" onClick={() => setReloadKey((value) => value + 1)}>重新加载</button>
      </section>
    );
  }

  if (view === "review") {
    return (
      <section className="growth-page growth-review-page">
        <header className="growth-heading growth-heading-review">
          <button className="growth-back" type="button" onClick={() => setView("plan")} aria-label="返回成长计划"><GrowthIcon name="arrow" /></button>
          <div><p>本周回顾 · {weekLabel(plan)}</p><h1>{plan.review.headline}</h1><span>不是给你打分，只是帮你看见自己的尝试。</span></div>
        </header>

        <article className="growth-review-hero">
          <div><p>WEEKLY NOTE</p><strong>{plan.stats.goalAttempts}<small>次</small></strong><h2>走回真实生活</h2><span>{plan.review.summary}</span></div>
          <div className="growth-rings" aria-hidden="true"><GrowthIcon name="leaf" /></div>
        </article>

        <section className="growth-section">
          <div className="growth-section-title"><div><p>YOUR CHOICES</p><h2>你做过的选择</h2></div></div>
          {plan.review.choices.length > 0 ? (
            <div className="growth-choice-list">
              {plan.review.choices.map((choice) => (
                <article key={choice.kind} className="growth-choice-card">
                  <span><GrowthIcon name={choice.kind === "activity" ? "activity" : "check"} /></span>
                  <div><h3>{choice.title}</h3><p>{choice.detail}</p></div>
                  <GrowthIcon name="check" />
                </article>
              ))}
            </div>
          ) : <div className="growth-empty-choice"><p>还没有记录也没关系。</p><span>今天愿意试一次，就是开始。</span></div>}
        </section>

        <section className="growth-next-goal">
          <p>NEXT WEEK · 只选一个</p>
          <h2>{plan.review.nextGoal.title}</h2>
          <span>继续保留这个小目标，不需要一下子改变很多。</span>
          <button type="button" className="growth-primary-button" onClick={() => setView("plan")}>保留这个目标</button>
        </section>
      </section>
    );
  }

  const progress = Math.min(100, (plan.goal.attemptCount / plan.goal.targetAttempts) * 100);
  return (
    <section className="growth-page">
      <header className="growth-heading">
        <div><p>成长不是比赛 · {weekLabel(plan)}</p><h1>我的小计划</h1><span>一次只改变一点点。</span></div>
        <button className="growth-report-button" type="button" aria-label="成长回顾" onClick={() => setView("review")}><GrowthIcon name="report" /><span>成长回顾</span></button>
      </header>

      <article className="growth-goal-hero">
        <div className="growth-goal-copy"><p>THIS WEEK</p><h2>{plan.goal.title}</h2><span>替代行动：{plan.goal.alternativeAction}</span></div>
        <div className="growth-week-strip" aria-label="本周尝试记录">
          {plan.days.map((day) => <span key={day.date} className={day.attempted ? "is-done" : ""}><small>周</small><b>{day.label}</b>{day.attempted && <i><GrowthIcon name="check" /></i>}</span>)}
        </div>
      </article>

      <section className="growth-section">
        <div className="growth-section-title"><div><p>WEEKLY PROGRESS</p><h2>这周的进度</h2></div><span>不连续也没关系</span></div>
        <article className="growth-progress-card">
          <div className="growth-progress-head"><div><strong>已经尝试 {plan.goal.attemptCount} 次</strong><span>目标是{plan.goal.targetAttempts}次，不要求每天完成。</span></div><b>{plan.goal.status === "completed" ? "已完成" : plan.goal.status === "not_started" ? "待开始" : "进行中"}</b></div>
          <div className="growth-progress-track" aria-label={`完成进度${Math.round(progress)}%`}><span style={{ width: `${progress}%` }} /></div>
          {error !== null && <div className="growth-error" role="alert"><strong>{error.message}</strong><span>{error.nextAction}</span></div>}
          <button type="button" className="growth-primary-button" disabled={recording || plan.goal.todayRecorded} onClick={() => void recordToday()}>{recording ? "正在记录…" : plan.goal.todayRecorded ? "今天已经记录" : "记录今天的尝试"}</button>
        </article>
      </section>

      <section className="growth-section">
        <div className="growth-section-title"><div><p>REAL, NOT A SCORE</p><h2>过程比连续更重要</h2></div></div>
        <div className="growth-stat-grid">
          <article><strong>{plan.stats.realWorldActivities}</strong><span>现实活动</span></article>
          <article><strong>{plan.stats.goalAttempts}</strong><span>目标尝试</span></article>
          <article><strong>{plan.stats.activeDays}</strong><span>有行动的天</span></article>
        </div>
      </section>
    </section>
  );
}
