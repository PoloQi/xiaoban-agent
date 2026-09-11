import { useEffect, useRef, useState, type FormEvent } from "react";

import type { ChatTurn, ChildChatResponse, ChildCompanion } from "@xiaoban/contracts";

import { sendChildChat } from "./child-chat";
import { COMPANION_COPY, CompanionIllustration } from "./companion";
import "./child-chat.css";

interface ChildChatProps {
  token: string;
  childAlias: string;
  companion: ChildCompanion;
  initialMode?: "bored" | "help";
  onBack: () => void;
  onSafetyResponse: (response: Extract<ChildChatResponse, { route: "fixed_safety" }>) => void;
  onOpenActivities: (movement: "move" | "quiet") => void;
  onOpenTrustedAdult?: () => void;
}

interface Message {
  role: "child" | "assistant";
  text: string;
}

type ActivityRecommendation = Extract<ChildChatResponse, { route: "activity_recommendations" }>;

const DEFAULT_QUICK_REPLIES = ["我今天有点不开心", "给我讲个故事吧", "陪我随便聊聊"];

const helpMessage = (companionName: string) =>
  `遇到困难时，记得找身边可信任的大人，比如家人或老师。${companionName}在这里陪你，但真正能帮你的人就在你身边。`;
const BORED_PROMPT = "我现在有点无聊，想找件不刷视频的小事做。";

function movementLabel(value: "move" | "quiet") {
  return value === "move" ? "想动一动" : "安静做点事";
}

function locationLabel(value: "indoor" | "outdoor" | "either") {
  return value === "indoor" ? "室内" : value === "outdoor" ? "户外" : "室内或户外";
}

export function ChildChat({ token, childAlias, companion, initialMode, onBack, onSafetyResponse, onOpenActivities, onOpenTrustedAdult }: ChildChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMode === "help"
    ? [{ role: "assistant", text: helpMessage(COMPANION_COPY[companion].name) }]
    : []);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWait, setShowWait] = useState(false);
  const [quickReplies, setQuickReplies] = useState<string[]>(DEFAULT_QUICK_REPLIES);
  const [recommendation, setRecommendation] = useState<ActivityRecommendation | null>(null);
  const [voiceNotice, setVoiceNotice] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);
  const waitTimerRef = useRef<number | null>(null);
  const voiceNoticeTimerRef = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const initialPromptSentRef = useRef(false);
  const companionName = COMPANION_COPY[companion].name;

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      if (waitTimerRef.current !== null) window.clearTimeout(waitTimerRef.current);
      if (voiceNoticeTimerRef.current !== null) window.clearTimeout(voiceNoticeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    transcriptRef.current?.scrollTo({
      top: transcriptRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages, showWait, error]);

  async function send(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0 || sending) return;
    setDraft("");
    setError(null);
    setRecommendation(null);

    const history: ChatTurn[] = messages.slice(-8).map(({ role, text }) => ({ role, text }));
    setMessages((previous) => [...previous, { role: "child", text: trimmed }]);
    setSending(true);

    const controller = new AbortController();
    controllerRef.current = controller;
    waitTimerRef.current = window.setTimeout(() => setShowWait(true), 300);

    try {
      const response = await sendChildChat(token, trimmed, history, controller.signal);
      if (response.route === "fixed_safety") {
        onSafetyResponse(response);
        return;
      }
      if (response.route === "lonely_connection") {
        setMessages((previous) => [...previous, { role: "assistant", text: response.reply }]);
        setQuickReplies(response.suggestedReplies ?? []);
        onOpenTrustedAdult?.();
        return;
      }
      setMessages((previous) => [...previous, { role: "assistant", text: response.reply }]);
      if (response.route === "activity_recommendations") {
        setRecommendation(response);
        setQuickReplies([]);
      } else {
        setQuickReplies(response.suggestedReplies ?? []);
      }
    } catch (reason) {
      if (!controller.signal.aborted) {
        setError("现在回答不了，你可以稍后再试，或者去找身边可信任的大人。");
      }
    } finally {
      if (controllerRef.current === controller) controllerRef.current = null;
      if (waitTimerRef.current !== null) {
        window.clearTimeout(waitTimerRef.current);
        waitTimerRef.current = null;
      }
      setShowWait(false);
      setSending(false);
    }
  }

  useEffect(() => {
    if (initialMode !== "bored" || initialPromptSentRef.current) return;
    const timer = window.setTimeout(() => {
      if (initialPromptSentRef.current) return;
      initialPromptSentRef.current = true;
      void send(BORED_PROMPT);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [initialMode]);

  function handleSubmit(event: FormEvent) {
    event.preventDefault();
    void send(draft);
  }

  function handleVoiceClick() {
    setVoiceNotice("语音暂未开放，试着打字告诉我吧。");
    if (voiceNoticeTimerRef.current !== null) window.clearTimeout(voiceNoticeTimerRef.current);
    voiceNoticeTimerRef.current = window.setTimeout(() => {
      setVoiceNotice(null);
      voiceNoticeTimerRef.current = null;
    }, 3000);
  }

  return (
    <div className="child-chat">
      <button className="child-chat-back" type="button" onClick={onBack}>
        <svg aria-hidden="true" viewBox="0 0 24 24"><path d="M19 12H5" /><path d="m10 7-5 5 5 5" /></svg>
        返回陪我聊首页
      </button>
      <section className="child-chat-transcript" ref={transcriptRef} aria-live="polite">
        <div className="child-chat-greeting">
          <CompanionIllustration companion={companion} />
          <div><p>嗨 {childAlias}，我是{companionName}。</p>
          <p>今天想跟我聊点什么？</p></div>
        </div>

        {messages.map((message, index) => (
          <div key={index} className={`child-chat-message child-chat-message-${message.role}`}>
            <span className="child-chat-speaker">
              {message.role === "assistant" ? companionName : childAlias}
            </span>
            <div className="child-chat-bubble">{message.text}</div>
          </div>
        ))}

        {recommendation !== null && (
          <section className="child-chat-recommendations" aria-label="推荐活动">
            <p className="child-chat-recommendations-kicker">{movementLabel(recommendation.movement)}</p>
            <div className="child-chat-recommendation-list">
              {recommendation.activities.map((activity) => (
                <button
                  key={activity.slug}
                  className="child-chat-recommendation-card"
                  type="button"
                  onClick={() => onOpenActivities(recommendation.movement)}
                >
                  <strong>{activity.title}</strong>
                  <span>{movementLabel(activity.movement)} · {activity.durationMinutes}分钟 · {locationLabel(activity.location)}</span>
                </button>
              ))}
            </div>
            <button
              className="child-chat-recommendation-primary"
              type="button"
              onClick={() => onOpenActivities(recommendation.movement)}
            >
              去看看活动
            </button>
          </section>
        )}

        {showWait && (
          <div className="child-chat-wait" role="status">
            正在陪你想…
          </div>
        )}
        {error !== null && (
          <div className="child-chat-error" role="alert">
            {error}
          </div>
        )}
      </section>

      <footer className="child-chat-composer">
        {quickReplies.length > 0 && (
          <div className="child-chat-quick-replies" aria-label="快捷回复">
            {quickReplies.map((reply) => (
              <button key={reply} type="button" onClick={() => void send(reply)} disabled={sending}>
                {reply}
              </button>
            ))}
          </div>
        )}

        <form className="child-chat-input-row" onSubmit={handleSubmit}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="想说什么都可以"
            maxLength={700}
            aria-label={`输入想对${companionName}说的话`}
          />
          <button
            className="child-chat-voice"
            type="button"
            onClick={handleVoiceClick}
            aria-label="语音输入（暂未开放）"
            title="语音输入暂未开放"
          >
            <svg aria-hidden="true" viewBox="0 0 24 24"><rect x="9" y="2" width="6" height="12" rx="3" /><path d="M5 10a7 7 0 0 0 14 0M12 17v5M9 22h6" /></svg>
          </button>
          <button
            className="child-chat-help"
            type="button"
            onClick={() => setMessages((previous) => [...previous, { role: "assistant", text: helpMessage(companionName) }])}
          >
            找人帮助
          </button>
          <button
            className="child-chat-send"
            type="submit"
            disabled={sending || draft.trim().length === 0}
          >
            发送
          </button>
        </form>

        {voiceNotice !== null && (
          <div className="child-chat-voice-notice" role="status" aria-live="polite">
            {voiceNotice}
          </div>
        )}

        <p className="child-chat-note">{companionName}是 AI，不是真人。遇到困难请找身边可信任的大人。</p>
      </footer>
    </div>
  );
}
