import { useCallback, useEffect, useState } from "react";

import type { RiskConsoleTicketDetail, RiskConsoleTicketListItem } from "@xiaoban/contracts";

import { ApiError, createSessionToken } from "./api";
import { GuardianDashboard } from "./GuardianDashboard";
import {
  addRiskTicketNote,
  claimRiskTicket,
  closeRiskTicket,
  getRiskTicket,
  listRiskTickets,
  resolveRiskTicket,
} from "./risk-console";
import "./risk-console.css";

type View = "dashboard" | "list" | "detail";

interface RiskConsoleProps {
  token: string;
  onExit: () => void;
}

function consoleError(reason: unknown): ApiError {
  return reason instanceof ApiError
    ? reason
    : new ApiError("DEPENDENCY_UNAVAILABLE", "暂时读不到风险工单。", "请稍后重试。");
}

function levelLabel(level: string): string {
  return level === "L3" ? "L3 立即关注" : "L2 需要处理";
}

function statusLabel(status: string): string {
  switch (status) {
    case "open": return "待接单";
    case "waiting_for_acknowledgement": return "等待确认";
    case "escalated": return "已升级";
    case "acknowledged": return "已确认";
    case "resolved": return "已解决";
    case "closed": return "已关闭";
    default: return status;
  }
}

function assigneeLabel(state: RiskConsoleTicketListItem["assigneeState"]): string {
  switch (state) {
    case "claimed_by_me": return "我已接单";
    case "claimed_by_other": return "其他监护人已接";
    default: return "未接单";
  }
}

function categoryLabel(category: string): string {
  switch (category) {
    case "bullying": return "疑似欺凌";
    case "abuse_exploitation": return "疑似侵害或利用";
    case "fraud_privacy": return "诈骗或隐私风险";
    case "dangerous_imitation": return "危险模仿";
    case "self_harm": return "自我伤害风险";
    case "harm_to_others": return "伤害他人风险";
    case "active_danger": return "正在发生的危险";
    case "persistent_distress": return "持续难过";
    default: return "一般风险";
  }
}

function NotificationState({ detail }: { detail: RiskConsoleTicketDetail }) {
  return (
    <section className="rc-notifications" aria-label="通知与回执状态（只读）">
      <div className="rc-section-title"><p>NOTIFICATION STATUS</p><h2>通知状态（只读）</h2></div>
      <p className="rc-boundary">本地合成回执：未真实发送、未真实送达（simulated · networkCallMade:false），工作台不会重发任何通知。</p>
      <ul>
        {detail.notifications.map((item) => (
          <li key={item.channel}>
            <span className="rc-channel">{item.channel === "in_app" ? "站内提醒" : "站外备用通道"}</span>
            <span className="rc-nstatus">{statusLabel(item.status)}</span>
            <span className="rc-attempts">尝试 {item.attempts} 次</span>
            <em>模拟 · 无网络调用</em>
          </li>
        ))}
      </ul>
    </section>
  );
}

function TicketDetail({
  token, ticketId, onBack,
}: { token: string; ticketId: string; onBack: () => void }) {
  const [detail, setDetail] = useState<RiskConsoleTicketDetail | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [disposition, setDisposition] = useState("");
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    getRiskTicket(token, ticketId, controller.signal)
      .then(setDetail)
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(consoleError(reason)); });
    return () => controller.abort();
  }, [token, ticketId, retryKey]);

  const run = useCallback(async (action: () => Promise<RiskConsoleTicketDetail>) => {
    setBusy(true);
    setError(null);
    try {
      setDetail(await action());
    } catch (reason) {
      setError(consoleError(reason));
    } finally {
      setBusy(false);
    }
  }, []);

  if (error !== null && detail === null) {
    return (
      <section className="rc-panel rc-error" role="alert">
        <h2>{error.message}</h2><p>{error.nextAction}</p>
        <div><button type="button" onClick={() => setRetryKey((v) => v + 1)}>重新加载</button><button type="button" onClick={onBack}>返回列表</button></div>
      </section>
    );
  }
  if (detail === null) {
    return <section className="rc-panel rc-loading" role="status"><span /><p>正在打开工单…</p></section>;
  }

  const ensurePrefix = (value: string) => value.startsWith("虚构处置：") ? value : `虚构处置：${value}`;

  return (
    <section className="rc-panel">
      <button className="rc-back" type="button" onClick={onBack}>返回工单列表</button>
      <header className="rc-detail-head">
        <p>RISK TICKET · SYNTHETIC</p>
        <div><span className={`rc-level rc-level-${detail.level.toLowerCase()}`}>{levelLabel(detail.level)}</span><span className="rc-status">{statusLabel(detail.status)}</span></div>
        <h2>{categoryLabel(detail.primaryCategory)}</h2>
        <em>{assigneeLabel(detail.assigneeState)} · 工单 {detail.caseReference}</em>
        <p className="rc-summary">仅展示风险等级、类别与必要处置信息；普通完整聊天、原始提示与供应商内容均不可见。</p>
      </header>

      {error !== null && <p className="rc-inline-error" role="alert">{error.message} {error.nextAction}</p>}

      <div className="rc-actions">
        <button type="button" disabled={busy || !detail.permissions.canClaim} onClick={() => void run(() => claimRiskTicket(token, detail.id, createSessionToken()))}>接单</button>
        <button type="button" disabled={busy || !detail.permissions.canClose} onClick={() => void run(() => closeRiskTicket(token, detail.id, createSessionToken()))}>关闭工单</button>
      </div>

      <NotificationState detail={detail} />

      <section className="rc-notes">
        <div className="rc-section-title"><p>HANDLING LOG</p><h2>处置记录（追加保存）</h2></div>
        <ol>
          {detail.notes.map((item) => (
            <li key={item.id}>
              <span>{item.kind === "claimed" ? "已接单" : "处置说明"}</span>
              {item.note !== null && <strong>{item.note}</strong>}
              <em>{new Date(item.createdAt).toLocaleString("zh-CN", { timeZone: "Asia/Shanghai" })}</em>
            </li>
          ))}
          {detail.notes.length === 0 && <li className="rc-empty-note">还没有处置记录。</li>}
        </ol>
        {detail.permissions.canAddNote && (
          <form onSubmit={(event) => {
            event.preventDefault();
            const value = ensurePrefix(note.trim());
            if (value.length < 10) return;
            void run(async () => {
              const next = await addRiskTicketNote(token, detail.id, createSessionToken(), value);
              setNote("");
              return next;
            });
          }}>
            <label htmlFor="rc-note">追加处置说明</label>
            <textarea id="rc-note" value={note} maxLength={240} minLength={4} required onChange={(event) => setNote(event.target.value)} placeholder="记录已采取的现实步骤（会自动加“虚构处置：”前缀）" />
            <button type="submit" disabled={busy || note.trim().length < 4}>追加记录</button>
          </form>
        )}
      </section>

      {detail.permissions.canResolve && (
        <section className="rc-resolve">
          <div className="rc-section-title"><p>RESOLVE</p><h2>标记解决</h2></div>
          <form onSubmit={(event) => {
            event.preventDefault();
            const value = ensurePrefix(disposition.trim());
            if (value.length < 10) return;
            void run(async () => {
              const next = await resolveRiskTicket(token, detail.id, createSessionToken(), value);
              setDisposition("");
              return next;
            });
          }}>
            <label htmlFor="rc-resolution">处置结果（必填）</label>
            <textarea id="rc-resolution" value={disposition} maxLength={240} minLength={4} required onChange={(event) => setDisposition(event.target.value)} placeholder="关闭前填写处置结果（会自动加“虚构处置：”前缀）" />
            <button type="submit" disabled={busy || disposition.trim().length < 4}>标记为已解决</button>
          </form>
        </section>
      )}

      {detail.status === "closed" && <p className="rc-closed-note">工单已关闭，处置记录只读保留，不能再追加。</p>}
    </section>
  );
}

function TicketList({ token, onOpen }: { token: string; onOpen: (id: string) => void }) {
  const [tickets, setTickets] = useState<RiskConsoleTicketListItem[]>([]);
  const [error, setError] = useState<ApiError | null>(null);
  const [retryKey, setRetryKey] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    listRiskTickets(token, controller.signal)
      .then((result) => setTickets(result.tickets))
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(consoleError(reason)); });
    return () => controller.abort();
  }, [token, retryKey]);

  if (error !== null) {
    return (
      <section className="rc-panel rc-error" role="alert">
        <h2>{error.message}</h2><p>{error.nextAction}</p>
        <button type="button" onClick={() => setRetryKey((v) => v + 1)}>重新加载</button>
      </section>
    );
  }

  return (
    <section className="rc-panel">
      <div className="rc-list-head">
        <div><p>RISK WORKBENCH · SYNTHETIC</p><h1>风险工单工作台</h1></div>
        <span className="rc-synthetic-tag">合成 · 无真实通知</span>
      </div>
      <p className="rc-boundary">这里只显示风险摘要与处置状态，不显示普通完整聊天；通知与回执为本地模拟，networkCallMade 为 false，不能重发。</p>
      {tickets.length === 0 && <p className="rc-empty">当前没有需要处理的本户风险工单。</p>}
      <ul className="rc-ticket-list">
        {tickets.map((ticket) => (
          <li key={ticket.id}>
            <button type="button" onClick={() => onOpen(ticket.id)}>
              <span className={`rc-level rc-level-${ticket.level.toLowerCase()}`}>{levelLabel(ticket.level)}</span>
              <span className="rc-ticket-main"><strong>{statusLabel(ticket.status)}</strong><em>{categoryLabel(ticket.primaryCategory)}</em></span>
              <span className="rc-assignee">{assigneeLabel(ticket.assigneeState)}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function RiskConsole({ token, onExit }: RiskConsoleProps) {
  const [view, setView] = useState<View>("dashboard");
  const [ticketId, setTicketId] = useState<string | null>(null);

  const goList = () => { setTicketId(null); setView("list"); window.scrollTo({ top: 0, behavior: "smooth" }); };

  if (view === "dashboard") {
    return (
      <div className="rc-root rc-root-dashboard">
        <GuardianDashboard token={token} onExit={onExit} />
        <button className="rc-dashboard-entry" type="button" onClick={goList}>
          <span>打开风险工单工作台</span>
          <small>合成工单 · 无真实通知</small>
        </button>
      </div>
    );
  }

  return (
    <div className="rc-root">
      <header className="rc-topbar">
        <div className="rc-brand"><span>小伴</span><div><strong>风险工作台</strong><small>RISK CONSOLE</small></div></div>
        <div className="rc-switch" role="tablist" aria-label="工作台区域切换">
          <button type="button" role="tab" aria-selected={view === "list"} className={view === "list" ? "is-current" : ""} onClick={goList}>工单列表</button>
          <button type="button" role="tab" aria-selected={false} onClick={() => setView("dashboard")}>监护主页</button>
        </div>
        <button type="button" className="rc-exit" onClick={onExit}>返回儿童端</button>
      </header>

      {view === "list" && <TicketList token={token} onOpen={(id) => { setTicketId(id); setView("detail"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />}
      {view === "detail" && ticketId !== null && (
        <TicketDetail token={token} ticketId={ticketId} onBack={goList} />
      )}
    </div>
  );
}
