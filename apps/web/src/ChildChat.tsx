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
}

interface Message {
  role: "child" | "assistant";
  text: string;
}

const QUICK_REPLIES = ["我今天有点不开心", "给我讲个故事吧", "陪我随便聊聊"] as const;

const helpMessage = (companionName: string) =>
  `遇到困难时，记得找身边可信任的大人，比如家人或老师。${companionName}在这里陪你，但真正能帮你的人就在你身边。`;
const BORED_PROMPT = "我现在有点无聊，想找件不刷视频的小事做。";

export function ChildChat({ token, childAlias, companion, initialMode, onBack, onSafetyResponse }: ChildChatProps) {
  const [messages, setMessages] = useState<Message[]>(initialMode === "help"
    ? [{ role: "assistant", text: helpMessage(COMPANION_COPY[companion].name) }]
    : []);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWait, setShowWait] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const waitTimerRef = useRef<number | null>(null);
  const transcriptRef = useRef<HTMLDivElement | null>(null);
  const initialPromptSentRef = useRef(false);
  const companionName = COMPANION_COPY[companion].name;

  useEffect(() => {
    return () => {
      controllerRef.current?.abort();
      if (waitTimerRef.current !== null) window.clearTimeout(waitTimerRef.current);
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
      setMessages((previous) => [...previous, { role: "assistant", text: response.reply }]);
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
        <div className="child-chat-quick-replies" aria-label="快捷回复">
          {QUICK_REPLIES.map((reply) => (
            <button key={reply} type="button" onClick={() => void send(reply)} disabled={sending}>
              {reply}
            </button>
          ))}
        </div>

        <form className="child-chat-input-row" onSubmit={handleSubmit}>
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="想说什么都可以"
            maxLength={700}
            aria-label={`输入想对${companionName}说的话`}
          />
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

        <p className="child-chat-note">{companionName}是 AI，不是真人。遇到困难请找身边可信任的大人。</p>
      </footer>
    </div>
  );
}
