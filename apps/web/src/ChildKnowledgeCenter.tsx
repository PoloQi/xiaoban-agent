import { useEffect, useState, type ReactNode } from "react";

import {
  childContentDetailSchema,
  childContentListResponseSchema,
  type AgeBand,
  type ChildContentDetail,
  type ChildContentSummary,
} from "@xiaoban/contracts";

import { ApiError, requestJson } from "./api";
import {
  clearChildContentCache,
  readCachedContentDetail,
  readCachedContentList,
  writeCachedContentDetail,
} from "./content-cache";
import "./child-knowledge.css";

type KnowledgeSummary = Extract<ChildContentSummary, { type: "knowledge" }>;
type KnowledgeDetail = Extract<ChildContentDetail, { type: "knowledge" }>;
type PracticeTopic = "emotional_social" | "digital_safety" | "body_boundaries";

interface ChildKnowledgeCenterProps {
  ageBand: AgeBand;
  token: string;
  onBack: () => void;
  backLabel: string;
}

const TOPICS: Record<PracticeTopic, { eyebrow: string; name: string; description: string; icon: "heart" | "shield" | "person" }> = {
  emotional_social: {
    eyebrow: "FEELINGS & FRIENDS",
    name: "心情与相处",
    description: "孤单、冲突、被排斥时可以怎么做",
    icon: "heart",
  },
  digital_safety: {
    eyebrow: "ONLINE SAFETY",
    name: "网络与人身安全",
    description: "隐私、诈骗、陌生网友和危险挑战",
    icon: "shield",
  },
  body_boundaries: {
    eyebrow: "BODY BOUNDARIES",
    name: "身体与边界保护",
    description: "认识身体边界，学会拒绝和求助",
    icon: "person",
  },
};
const TOPIC_ORDER = Object.keys(TOPICS) as PracticeTopic[];

function KnowledgeIcon({ name }: { name: "arrow" | "back" | "book" | "check" | "heart" | "person" | "shield" }) {
  const paths: Record<typeof name, ReactNode> = {
    arrow: <><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></>,
    back: <><path d="M19 12H5" /><path d="m10 7-5 5 5 5" /></>,
    book: <><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5A2.5 2.5 0 0 1 20 21.5Z" /></>,
    check: <path d="m5 12 4 4L19 6" />,
    heart: <path d="M12 20S4 15.5 4 9.5A4.5 4.5 0 0 1 12 6a4.5 4.5 0 0 1 8 3.5C20 15.5 12 20 12 20Z" />,
    person: <><circle cx="12" cy="8" r="3" /><path d="M6 20c.5-4.5 2.5-7 6-7s5.5 2.5 6 7" /></>,
    shield: <><path d="M12 3 19 6v5c0 4.5-2.5 8-7 10-4.5-2-7-5.5-7-10V6Z" /><path d="m9 12 2 2 4-5" /></>,
  };
  return <svg aria-hidden="true" viewBox="0 0 24 24" className="knowledge-icon">{paths[name]}</svg>;
}

function isAccessError(reason: unknown): boolean {
  return reason instanceof ApiError
    && ["UNAUTHORIZED", "FORBIDDEN", "ACCOUNT_DEACTIVATED"].includes(reason.code);
}

function knowledgeError(reason: unknown, message: string): ApiError {
  if (reason instanceof ApiError && isAccessError(reason)) return reason;
  return new ApiError("DEPENDENCY_UNAVAILABLE", message, "可以稍后再试，或者返回儿童首页。");
}

function reviewDate(value: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

export function ChildKnowledgeCenter({ ageBand, token, onBack, backLabel }: ChildKnowledgeCenterProps) {
  const [items, setItems] = useState<KnowledgeSummary[]>([]);
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [answer, setAnswer] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<ApiError | null>(null);
  const [cachedAt, setCachedAt] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError(null);
    requestJson(
      "/api/v1/child/content?type=knowledge&limit=20&offset=0",
      {
        method: "GET",
        signal: controller.signal,
        headers: { authorization: `Bearer ${token}` },
      },
      childContentListResponseSchema,
    ).then((result) => {
      setItems(result.items.filter((item): item is KnowledgeSummary => item.type === "knowledge"));
      setCachedAt(null);
    }).catch((reason) => {
      if (controller.signal.aborted) return;
      if (isAccessError(reason)) {
        clearChildContentCache();
        setError(knowledgeError(reason, "安全成长小站暂时没有打开。"));
        return;
      }
      const cached = readCachedContentList(ageBand);
      if (cached === null) {
        setError(knowledgeError(reason, "安全成长小站暂时没有打开。"));
      } else {
        setItems(cached.value.items.filter((item): item is KnowledgeSummary => item.type === "knowledge"));
        setCachedAt(cached.cachedAt);
      }
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [ageBand, reloadKey, token]);

  const practiceItems = items
    .filter((item): item is KnowledgeSummary & { topic: PracticeTopic } => item.hasQuiz && item.topic in TOPICS)
    .sort((left, right) => TOPIC_ORDER.indexOf(left.topic) - TOPIC_ORDER.indexOf(right.topic));

  async function openPractice(item: KnowledgeSummary) {
    setLoading(true);
    setError(null);
    setAnswer(null);
    try {
      const result = await requestJson(
        `/api/v1/child/content/${item.slug}`,
        { method: "GET", headers: { authorization: `Bearer ${token}` } },
        childContentDetailSchema,
      );
      if (result.type !== "knowledge" || result.quiz === null) {
        throw new Error("Knowledge practice is unavailable.");
      }
      setDetail(result);
      setCachedAt(null);
      writeCachedContentDetail(ageBand, result);
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      if (isAccessError(reason)) {
        clearChildContentCache();
        setError(knowledgeError(reason, "这道练习暂时没有打开。"));
      } else {
        const cached = readCachedContentDetail(ageBand, item.slug, item.revision);
        if (cached?.value.type === "knowledge" && cached.value.quiz !== null) {
          setDetail(cached.value);
          setCachedAt(cached.cachedAt);
          window.scrollTo({ top: 0, behavior: "smooth" });
        } else {
          setError(knowledgeError(reason, "这道练习暂时没有打开。"));
        }
      }
    } finally {
      setLoading(false);
    }
  }

  function returnToCenter() {
    setDetail(null);
    setAnswer(null);
    setError(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (detail !== null && detail.quiz !== null) {
    const quiz = detail.quiz;
    const correct = answer === quiz.correctOptionId;
    return (
      <main className="knowledge-shell knowledge-quiz-shell">
        <header className="knowledge-topbar">
          <button type="button" onClick={returnToCenter}><KnowledgeIcon name="back" />返回知识中心</button>
          <div><p>情景小练习</p><strong>先自己想一想，再看原因</strong></div>
          <span>{ageBand === "9_11" ? "9—11岁" : "12—14岁"}</span>
        </header>

        {cachedAt !== null && <div className="knowledge-cache-note" role="status">网络暂时不稳定，正在显示最近保存的审核内容。</div>}

        <article className="knowledge-scene">
          <p>{quiz.sceneLabel}</p>
          <h1>{quiz.scenario}</h1>
          <span>{TOPICS[detail.topic as PracticeTopic]?.name ?? detail.title}</span>
        </article>

        <section className="knowledge-answer-section" aria-labelledby="knowledge-question">
          <div className="knowledge-section-title"><p>YOUR CHOICE</p><h2 id="knowledge-question">你会怎么做？</h2></div>
          <div className="knowledge-options">
            {quiz.options.map((option, index) => {
              const selected = answer === option.id;
              return (
                <button
                  key={option.id}
                  type="button"
                  className={selected ? (correct ? "is-correct" : "is-wrong") : ""}
                  aria-pressed={selected}
                  onClick={() => setAnswer(option.id)}
                >
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  <strong>{option.text}</strong>
                  {selected && <KnowledgeIcon name={correct ? "check" : "arrow"} />}
                </button>
              );
            })}
          </div>
        </section>

        {answer !== null && (
          <section className={`knowledge-feedback ${correct ? "is-correct" : "is-wrong"}`} role="status" aria-live="polite">
            <div><KnowledgeIcon name={correct ? "check" : "shield"} /></div>
            <article>
              <p>{correct ? "更安全的选择" : "再想一步"}</p>
              <h2>{correct ? quiz.correctTitle : quiz.incorrectTitle}</h2>
              <span>{quiz.explanation}</span>
              <h3>可以这样行动</h3>
              <ol>{quiz.actionSteps.map((step) => <li key={step}>{step}</li>)}</ol>
            </article>
          </section>
        )}

        <footer className="knowledge-review-note">
          <KnowledgeIcon name="shield" />
          <span><strong>{detail.reviewLabel} · {reviewDate(detail.reviewedAt)}</strong>来源：{detail.sourceLabel}；练习结果只在当前页面显示，不计分、不保存。</span>
        </footer>
        <div className="knowledge-actions">
          <button type="button" className="knowledge-primary" disabled={answer === null} onClick={returnToCenter}>再选一个话题<KnowledgeIcon name="arrow" /></button>
          <button type="button" className="knowledge-quiet" onClick={onBack}>{backLabel}</button>
        </div>
      </main>
    );
  }

  return (
    <main className="knowledge-shell">
      <header className="knowledge-topbar knowledge-center-topbar">
        <button type="button" onClick={onBack}><KnowledgeIcon name="back" />返回</button>
        <div><p>内容经人工审核</p><strong>安全成长小站</strong></div>
        <span>{ageBand === "9_11" ? "9—11岁" : "12—14岁"}</span>
      </header>

      <section className="knowledge-hero">
        <div><p>LEARN TO PROTECT YOURSELF</p><h1>学会保护自己</h1><span>选择一个今天想了解的话题。没有考试，也不会给你打分。</span></div>
        <KnowledgeIcon name="book" />
      </section>

      {cachedAt !== null && <div className="knowledge-cache-note" role="status">网络暂时不稳定，正在显示最近保存的审核内容。</div>}
      {error !== null && <div className="knowledge-error" role="alert"><strong>{error.message}</strong><span>{error.nextAction}</span><button type="button" onClick={() => setReloadKey((value) => value + 1)}>重新加载</button></div>}
      {loading && detail === null && <div className="knowledge-loading" role="status"><span /><span /><span /><p>正在整理适合你年龄的练习…</p></div>}
      {!loading && error === null && practiceItems.length === 0 && <div className="knowledge-empty"><KnowledgeIcon name="book" /><h2>练习还在准备中</h2><p>目前没有适合你年龄且审核有效的情景练习。</p></div>}
      {!loading && error === null && practiceItems.length > 0 && (
        <section className="knowledge-topic-list" aria-label="知识话题">
          {practiceItems.map((item, index) => {
            const topic = TOPICS[item.topic];
            return (
              <button key={item.slug} type="button" onClick={() => void openPractice(item)}>
                <span className="knowledge-topic-index">0{index + 1}</span>
                <span className="knowledge-topic-icon"><KnowledgeIcon name={topic.icon} /></span>
                <span className="knowledge-topic-copy"><small>{topic.eyebrow}</small><strong>{topic.name}</strong><span>{item.summary || topic.description}</span><b>{item.sourceLabel} · 可练习</b></span>
                <KnowledgeIcon name="arrow" />
              </button>
            );
          })}
        </section>
      )}

      <aside className="knowledge-boundary"><KnowledgeIcon name="shield" /><p><strong>知识可以帮你想清楚下一步，但不能替代真人帮助。</strong>遇到正在发生的危险或让你不舒服的事，请离开不安全的位置，并告诉身边可信任的大人。</p></aside>
    </main>
  );
}
