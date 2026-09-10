import type {
  AgeBand,
  ChildCompanion,
  ChildGrade,
  ChildInterest,
} from "@xiaoban/contracts";
import type { FormEvent, ReactNode } from "react";

import { ApiError } from "./api";
import { COMPANION_COPY, CompanionIllustration } from "./companion";
import type { OnboardingStep } from "./onboarding-flow";
import "./onboarding.css";

export type ServiceState = "checking" | "ready" | "offline";

interface SetupValue {
  ageBand: AgeBand;
  alias: string;
  grade: ChildGrade;
  interests: ChildInterest[];
}

interface ChildOnboardingProps {
  alias: string;
  companion: ChildCompanion;
  error: ApiError | null;
  grade: ChildGrade;
  interests: ChildInterest[];
  loading: boolean;
  serviceState: ServiceState;
  step: OnboardingStep;
  onAliasChange: (value: string) => void;
  onBack: () => void;
  onCompanionChange: (value: ChildCompanion) => void;
  onFinish: () => void;
  onGradeChange: (value: ChildGrade) => void;
  onInterestToggle: (value: ChildInterest) => void;
  onResume: () => void;
  onSetup: (value: SetupValue) => void;
  onStart: () => void;
}

const GRADES: Array<[ChildGrade, string, AgeBand]> = [
  ["grade_4", "四年级", "9_11"],
  ["grade_5", "五年级", "9_11"],
  ["grade_6", "六年级", "9_11"],
  ["grade_7", "初一", "12_14"],
  ["grade_8", "初二", "12_14"],
];

const INTERESTS: Array<[ChildInterest, string, ReactNode]> = [
  ["drawing", "画画", <path key="draw" d="m5 19 3.5-.8L19 7.7 16.3 5 5.8 15.5 5 19Zm9.8-12.5 2.7 2.7M4 21h16" />],
  ["sports", "运动", <><circle key="ball" cx="12" cy="12" r="8" /><path key="seam" d="M5 9c4 1 7 5 8 10M16 5c-1 4-5 7-10 8" /></>],
  ["reading", "阅读", <><path key="left" d="M4 5.5A2.5 2.5 0 0 1 6.5 3H11v16H6.5A2.5 2.5 0 0 0 4 21.5Z" /><path key="right" d="M20 5.5A2.5 2.5 0 0 0 17.5 3H13v16h4.5a2.5 2.5 0 0 1 2.5 2.5Z" /></>],
  ["tidying", "整理", <><path key="box" d="M4 8h16v12H4zM3 4h18v4H3z" /><path key="line" d="M9 12h6" /></>],
];

function Icon({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24">{children}</svg>;
}

function Progress({ step }: { step: 1 | 2 | 3 }) {
  return (
    <>
      <div className="intro-status"><span>第 {step}/3 步</span><span>仅本地合成验证</span></div>
      <div className="intro-progress" aria-label={`引导进度，第${step}步，共3步`}><span style={{ width: `${step * 33.34}%` }} /></div>
    </>
  );
}

function ErrorNotice({ error }: { error: ApiError | null }) {
  if (error === null) return null;
  return <div className="intro-error" role="alert"><strong>{error.message}</strong><span>{error.nextAction}</span></div>;
}

export function ChildOnboarding(props: ChildOnboardingProps) {
  function submitSetup(event: FormEvent) {
    event.preventDefault();
    const ageBand = GRADES.find(([value]) => value === props.grade)![2];
    props.onSetup({ alias: props.alias, grade: props.grade, interests: props.interests, ageBand });
  }

  if (props.step === "welcome") {
    return (
      <main className="intro-shell intro-welcome">
        <div className="intro-orbit intro-orbit-one" aria-hidden="true" />
        <div className="intro-orbit intro-orbit-two" aria-hidden="true" />
        <header className="intro-brand"><span><Icon><path d="M20 4C11 4 5 9 5 18c6 1 13-3 15-14Z" /><path d="M5 20c4-6 8-10 13-14" /></Icon></span><b>小伴</b></header>
        <section className="intro-welcome-copy">
          <p className="intro-eyebrow">AI 成长伙伴</p>
          <h1>陪你聊一会儿，<br />也陪你走回生活里。</h1>
          <p>无聊、想念或遇到难题时，小伴会听你说，再一起找一个现实中能做的小行动。</p>
        </section>
        <div className="intro-welcome-art"><CompanionIllustration companion="sprout" /></div>
        <section className="intro-actions">
          <ErrorNotice error={props.error} />
          <button className="intro-primary" type="button" disabled={props.loading || props.serviceState === "offline"} onClick={props.onStart}>{props.loading ? "正在准备…" : <>开始认识小伴 <span aria-hidden="true">→</span></>}</button>
          <button className="intro-quiet" type="button" disabled={props.loading || props.serviceState === "offline"} onClick={props.onResume}>{props.loading ? "正在进入…" : "直接进入"}</button>
          <p className="intro-trust"><Icon><path d="M12 3 19 6v5c0 4.5-2.5 8-7 10-4.5-2-7-5.5-7-10V6Z" /><path d="m9 12 2 2 4-5" /></Icon><span>小伴是 AI，不是真人，也可能出错。遇到危险时，请马上找身边可信任的大人。</span></p>
        </section>
      </main>
    );
  }

  return (
    <main className="intro-shell intro-step-shell">
      <section className="intro-step-card">
        <Progress step={props.step === "boundaries" ? 1 : props.step === "setup" ? 2 : 3} />

        {props.step === "boundaries" && (
          <>
            <p className="intro-eyebrow">在开始之前</p>
            <h1>我们先说好<br />三件重要的事。</h1>
            <div className="intro-boundaries">
              <article><span><Icon><path d="m12 3 1.6 5.1L19 10l-5.4 1.9L12 17l-1.6-5.1L5 10l5.4-1.9L12 3Z" /></Icon></span><div><h2>我是 AI，不是真人</h2><p>我会尽力帮助你，但也可能理解错或回答错。</p></div></article>
              <article><span><Icon><rect x="5" y="10" width="14" height="10" rx="2" /><path d="M8 10V7a4 4 0 0 1 8 0v3" /></Icon></span><div><h2>普通聊天不会全部给大人看</h2><p>但如果有人可能遇到危险，要马上找可信任的大人。</p></div></article>
              <article><span><Icon><circle cx="9" cy="8" r="3" /><circle cx="17" cy="9" r="2" /><path d="M3 20c.5-4.5 2.5-7 6-7s5.5 2.5 6 7M15 14c3 0 5 2 5.5 5" /></Icon></span><div><h2>我不会替代真实的人</h2><p>我更希望陪你找到现实活动、家人、老师或朋友。</p></div></article>
            </div>
            <div className="intro-button-stack"><button className="intro-primary" type="button" onClick={props.onStart}>我明白了，继续 <span aria-hidden="true">→</span></button><button className="intro-quiet" type="button" onClick={props.onBack}>返回</button></div>
          </>
        )}

        {props.step === "setup" && (
          <form onSubmit={submitSetup}>
            <p className="intro-eyebrow">让小伴认识你</p>
            <h1>怎么称呼你<br />会更亲切？</h1>
            <label className="intro-field"><span>昵称</span><input value={props.alias} onChange={(event) => props.onAliasChange(event.target.value)} minLength={2} maxLength={8} autoComplete="off" required aria-describedby="intro-alias-help" /><small id="intro-alias-help">用昵称就好，不需要填写真实姓名。</small></label>
            <fieldset><legend>你现在读几年级？</legend><div className="intro-choice-grid">{GRADES.map(([value, label]) => <button key={value} className={props.grade === value ? "is-selected" : ""} type="button" aria-pressed={props.grade === value} onClick={() => props.onGradeChange(value)}>{label}</button>)}</div></fieldset>
            <fieldset><legend>你平时喜欢做什么？</legend><div className="intro-choice-grid">{INTERESTS.map(([value, label, icon]) => <button key={value} className={props.interests.includes(value) ? "is-selected" : ""} type="button" aria-pressed={props.interests.includes(value)} onClick={() => props.onInterestToggle(value)}><Icon>{icon}</Icon>{label}</button>)}</div></fieldset>
            <ErrorNotice error={props.error} />
            <div className="intro-button-stack"><button className="intro-primary" disabled={props.loading || props.serviceState === "offline" || props.interests.length === 0}>{props.loading ? "正在保存…" : "下一步 →"}</button><button className="intro-quiet" type="button" onClick={props.onBack}>返回</button></div>
          </form>
        )}

        {props.step === "companion" && (
          <>
            <p className="intro-eyebrow">选择你的 AI 伙伴</p>
            <h1>你想让谁<br />陪你一起成长？</h1>
            <div className="intro-companions">{(Object.keys(COMPANION_COPY) as ChildCompanion[]).map((value) => <button key={value} className={props.companion === value ? "is-selected" : ""} type="button" aria-pressed={props.companion === value} onClick={() => props.onCompanionChange(value)}><CompanionIllustration companion={value} /><span><b>{COMPANION_COPY[value].name}</b><small>{COMPANION_COPY[value].description}</small></span><i aria-hidden="true" /></button>)}</div>
            <ErrorNotice error={props.error} />
            <div className="intro-button-stack"><button className="intro-primary" disabled={props.loading || props.serviceState === "offline"} type="button" onClick={props.onFinish}>{props.loading ? "正在准备…" : "一起出发 →"}</button><button className="intro-quiet" type="button" onClick={props.onBack}>返回</button></div>
          </>
        )}
      </section>
    </main>
  );
}
