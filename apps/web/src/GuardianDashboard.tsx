import { useEffect, useState, type CSSProperties, type ReactNode } from "react";

import type { GuardianDashboardResponse } from "@xiaoban/contracts";

import { ApiError } from "./api";
import { getGuardianDashboard } from "./guardian-dashboard";
import "./guardian-dashboard.css";
import { NoticeStatusBanner } from "./notice-status-banner";
import "./notice-status.css";

type AdultTab = "overview" | "report" | "alerts" | "settings";
type AdultAlert = GuardianDashboardResponse["alerts"][number];

interface GuardianDashboardProps {
  token: string;
  onExit: () => void;
}

function AdultIcon({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24">{children}</svg>;
}

const NAVIGATION: Array<{ tab: AdultTab; label: string; icon: ReactNode }> = [
  { tab: "overview", label: "概览", icon: <><path d="M4 13h6V4H4Zm10 7h6V11h-6ZM4 20h6v-3H4Zm10-13h6V4h-6Z" /></> },
  { tab: "report", label: "周报", icon: <><path d="M6 3h12v18H6Z" /><path d="M9 8h6M9 12h6M9 16h4" /></> },
  { tab: "alerts", label: "提醒", icon: <><path d="M18 9a6 6 0 0 0-12 0c0 7-3 7-3 8h18c0-1-3-1-3-8Z" /><path d="M10 21h4" /></> },
  { tab: "settings", label: "设置", icon: <><circle cx="12" cy="12" r="3" /><path d="M19 12a7 7 0 0 0-.1-1l2-1.5-2-3.4-2.4 1A8 8 0 0 0 15 6l-.3-2.6h-4L10.4 6a8 8 0 0 0-1.5.9l-2.4-1-2 3.4 2 1.5a7 7 0 0 0 0 2.2l-2 1.5 2 3.4 2.4-1A8 8 0 0 0 10.4 18l.3 2.6h4L15 18a8 8 0 0 0 1.5-.9l2.4 1 2-3.4-2-1.5a7 7 0 0 0 .1-1Z" /></> },
];

function tabTitle(tab: AdultTab) {
  return tab === "overview" ? "本周概览" : tab === "report" ? "成长周报" : tab === "alerts" ? "风险提醒" : "监护设置";
}

function pageError(reason: unknown): ApiError {
  return reason instanceof ApiError
    ? reason
    : new ApiError("DEPENDENCY_UNAVAILABLE", "暂时没有读到监护端数据。", "请稍后重试。");
}

function PrivacyBoundary({ data }: { data: GuardianDashboardResponse }) {
  return (
    <aside className="adult-privacy-note">
      <AdultIcon><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></AdultIcon>
      <div><strong>看趋势，不翻聊天</strong><p>成人端可见：{data.privacy.visibleSummary}；不可见：{data.privacy.hiddenDetail}。</p></div>
    </aside>
  );
}

function Overview({ data, onOpenAlert }: { data: GuardianDashboardResponse; onOpenAlert: (alert: AdultAlert) => void }) {
  const maximum = Math.max(1, ...data.days.map((day) => day.actionCount));
  return (
    <>
      <section className="adult-overview-hero">
        <div className="adult-overview-copy">
          <p>WEEKLY FIELD NOTE · {data.week.startDate.slice(5)}—{data.week.endDate.slice(5)}</p>
          <h2>{data.report.headline}</h2>
          <span>{data.report.summary}</span>
        </div>
        <div className="adult-week-stamp" aria-label="只读周汇总"><strong>{data.week.startDate.slice(5).replace("-", "·")}</strong><small>只读汇总</small></div>
      </section>

      <dl className="adult-stat-grid">
        <div><dt>现实活动</dt><dd>{data.stats.realWorldActivities}<small>次</small></dd><p>来自已记录活动</p></div>
        <div><dt>目标尝试</dt><dd>{data.stats.goalAttempts}<small> / 3</small></dd><p>不要求连续完成</p></div>
        <div><dt>行动天数</dt><dd>{data.stats.activeDays}<small>天</small></dd><p>本周有记录的天数</p></div>
        <div className="is-muted"><dt>使用时长</dt><dd>—</dd><p>当前没有采集</p></div>
      </dl>

      <section className="adult-paper-card adult-action-chart" aria-labelledby="adult-action-title">
        <div className="adult-section-heading"><div><p>ACTION TRACE</p><h2 id="adult-action-title">一周行动分布</h2></div><span>按目标尝试计数</span></div>
        <div className="adult-bars">
          {data.days.map((day) => (
            <div key={day.date} aria-label={`周${day.label}${day.actionCount}次`}>
              <span><i style={{ "--adult-bar-height": `${Math.max(day.actionCount === 0 ? 5 : 22, day.actionCount / maximum * 100)}%` } as CSSProperties} /></span>
              <strong>{day.actionCount}</strong><small>{day.label}</small>
            </div>
          ))}
        </div>
      </section>

      {data.alerts[0] !== undefined && (
        <button className="adult-alert-preview" type="button" onClick={() => onOpenAlert(data.alerts[0]!)}>
          <span className="adult-alert-level">{data.alerts[0].level}</span>
          <span><small>合成风险演练 · 未发送</small><strong>{data.alerts[0].title}</strong><em>{data.alerts[0].summary}</em></span>
          <AdultIcon><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></AdultIcon>
        </button>
      )}

      <PrivacyBoundary data={data} />
      <aside className="adult-parent-tip"><span>本周陪伴提示</span><p>先问“你想让我听一听，还是一起想办法？”，让孩子决定谈话从哪里开始。</p></aside>
    </>
  );
}

function WeeklyReport({ data }: { data: GuardianDashboardResponse }) {
  return (
    <>
      <section className="adult-report-cover">
        <p>AUTO-ORGANIZED · 自动整理</p>
        <h2>{data.report.headline}</h2>
        <span>{data.report.summary}</span>
        <small>这不是 AI 诊断，也没有读取完整普通聊天。</small>
      </section>
      <section className="adult-paper-card">
        <div className="adult-section-heading"><div><p>WHAT WE CAN SEE</p><h2>本周可见事实</h2></div><span>{data.week.startDate} 至 {data.week.endDate}</span></div>
        <ul className="adult-fact-list">
          <li><strong>{data.stats.realWorldActivities}</strong><span>次现实活动记录</span></li>
          <li><strong>{data.stats.goalAttempts}</strong><span>次小目标尝试</span></li>
          <li><strong>{data.stats.activeDays}</strong><span>天留下行动记录</span></li>
        </ul>
      </section>
      <section className="adult-report-next">
        <p>NEXT CONVERSATION</p><h2>下次只聊一个小问题</h2>
        <blockquote>“这周哪一次尝试让你觉得最轻松？”</blockquote>
        <span>不评价完成多少，先听孩子怎么描述自己的选择。</span>
      </section>
      <PrivacyBoundary data={data} />
    </>
  );
}

function Alerts({ data, onOpenAlert }: { data: GuardianDashboardResponse; onOpenAlert: (alert: AdultAlert) => void }) {
  if (data.alerts.length === 0) {
    return <section className="adult-empty"><AdultIcon><path d="m5 12 4 4L19 6" /></AdultIcon><h2>目前没有提醒</h2><p>只有必要且已真实接入的风险状态才会出现在这里；普通聊天不会进入提醒列表。</p></section>;
  }
  return (
    <>
      <section className="adult-alert-intro"><p>SYNTHETIC DRILL</p><h2>先把风险详情流程跑通</h2><span>下面是本地合成演练，不代表孩子发生过真实事件。</span></section>
      <div className="adult-alert-list">
        {data.alerts.map((alert) => (
          <button key={alert.id} type="button" onClick={() => onOpenAlert(alert)}>
            <span className="adult-alert-level">{alert.level}</span>
            <span><small>合成演练 · 通知未发送</small><strong>{alert.title}</strong><em>{alert.summary}</em></span>
            <AdultIcon><path d="M5 12h14" /><path d="m14 7 5 5-5 5" /></AdultIcon>
          </button>
        ))}
      </div>
    </>
  );
}

function Settings({ data }: { data: GuardianDashboardResponse }) {
  return (
    <>
      <section className="adult-settings-lead"><p>ACCOUNT BOUNDARY</p><h2>查看绑定与隐私边界</h2><span>当前版本只读，不在这里修改权限或发送提醒。</span></section>
      <div className="adult-setting-list">
        <section><span className="adult-setting-icon"><AdultIcon><path d="M8 12h8M6 8h12v8H6z" /></AdultIcon></span><div><small>监护绑定</small><h3>{data.child.alias}</h3><p>受控邀请关系已核验</p></div><strong>已验证</strong></section>
        <section><span className="adult-setting-icon"><AdultIcon><circle cx="12" cy="12" r="8" /><path d="M12 7v5l3 2" /></AdultIcon></span><div><small>使用提醒</small><h3>尚未配置</h3><p>当前不采集使用时长，也不会发送提醒</p></div><button type="button" disabled>后续开放</button></section>
        <section><span className="adult-setting-icon"><AdultIcon><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></AdultIcon></span><div><small>普通聊天隐私</small><h3>完整内容不可见</h3><p>只展示成长行动汇总和必要的风险状态</p></div><strong>已保护</strong></section>
      </div>
      <aside className="adult-readonly-box"><strong>当前为只读监护端</strong><p>不支持可信任联系人、权限修改、真实通知、风险回执或处理工单。</p></aside>
    </>
  );
}

function AlertDetail({ alert, onBack }: { alert: AdultAlert; onBack: () => void }) {
  return (
    <main className="adult-shell adult-risk-shell">
      <header className="adult-detail-topbar"><button type="button" onClick={onBack}><AdultIcon><path d="M19 12H5" /><path d="m10 7-5 5 5 5" /></AdultIcon>返回提醒</button><span>合成演练 · 通知未发送</span></header>
      <article className="adult-risk-detail">
        <header><div><p>RISK DETAIL · SYNTHETIC</p><span className="adult-risk-badge">{alert.level}</span><h1>{alert.title}</h1><em>无真实发生时间 · 本地合成预览</em></div></header>
        <p className="adult-risk-summary">{alert.summary}</p>
        <NoticeStatusBanner audience="guardian" status={{ notificationStatus: alert.notificationStatus }} />
        <section><p>ACTION GUIDE</p><h2>可以先做这三件事</h2><ol>{alert.steps.map((step, index) => <li key={step}><span>0{index + 1}</span><strong>{step}</strong></li>)}</ol></section>
        <aside><strong>当前能力边界</strong><p>这个页面没有向任何人发送通知，也不支持“确认已读”或“正在处理”回执。按钮会在真实通知闭环接入后再开放。</p></aside>
        <button className="adult-risk-disabled" type="button" disabled>确认回执尚未接入</button>
      </article>
    </main>
  );
}

export function GuardianDashboard({ token, onExit }: GuardianDashboardProps) {
  const [data, setData] = useState<GuardianDashboardResponse | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [retryKey, setRetryKey] = useState(0);
  const [tab, setTab] = useState<AdultTab>("overview");
  const [selectedAlert, setSelectedAlert] = useState<AdultAlert | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    setError(null);
    void getGuardianDashboard(token, controller.signal)
      .then(setData)
      .catch((reason: unknown) => {
        if (!controller.signal.aborted) setError(pageError(reason));
      });
    return () => controller.abort();
  }, [token, retryKey]);

  if (selectedAlert !== null) return <AlertDetail alert={selectedAlert} onBack={() => setSelectedAlert(null)} />;

  return (
    <main className="adult-shell">
      <header className="adult-topbar">
        <a href="#adult" className="adult-brand" aria-label="小伴监护端"><span>小伴</span><div><strong>监护端</strong><small>GUARDIAN FIELD NOTES</small></div></a>
        <button type="button" onClick={onExit}>返回儿童端</button>
      </header>
      <section className="adult-page-heading">
        <div><p>{data?.guardian.alias ?? "受控监护账号"} · 只读</p><h1>{tabTitle(tab)}</h1></div>
        {data !== null && <span><i />{data.child.alias} · 已验证绑定</span>}
      </section>

      {data === null && error === null && <section className="adult-loading" role="status"><span /><p>正在整理本周手账…</p></section>}
      {error !== null && <section className="adult-load-error" role="alert"><h2>{error.message}</h2><p>{error.nextAction}</p><div><button type="button" onClick={() => setRetryKey((value) => value + 1)}>重新加载</button><button type="button" onClick={onExit}>返回儿童端</button></div></section>}
      {data !== null && error === null && (
        <div className="adult-page-body">
          {tab === "overview" ? <Overview data={data} onOpenAlert={setSelectedAlert} /> : tab === "report" ? <WeeklyReport data={data} /> : tab === "alerts" ? <Alerts data={data} onOpenAlert={setSelectedAlert} /> : <Settings data={data} />}
        </div>
      )}

      <nav className="adult-bottom-nav" aria-label="成人端主导航">
        {NAVIGATION.map((item) => <button key={item.tab} type="button" className={tab === item.tab ? "is-current" : ""} aria-current={tab === item.tab ? "page" : undefined} onClick={() => { setSelectedAlert(null); setTab(item.tab); window.scrollTo({ top: 0, behavior: "smooth" }); }}><AdultIcon>{item.icon}</AdultIcon><span>{item.label}</span></button>)}
      </nav>
    </main>
  );
}
