import { useEffect, useState } from "react";

import {
  childModeResponseSchema,
  readinessResponseSchema,
  type AgeBand,
  type ChildCompanion,
  type ChildGrade,
  type ChildInterest,
  type ChildModeResponse,
  type ChildOnboardingResponse,
} from "@xiaoban/contracts";

import { ApiError, requestJson } from "./api";
import { ChildOnboarding, type ServiceState } from "./ChildOnboarding";
import { ChildContent } from "./ChildContent";
import { GuardianDashboard } from "./GuardianDashboard";
import { clearChildContentCache } from "./content-cache";
import { completeChildOnboarding, getChildOnboarding } from "./onboarding";
import { advanceOnboarding, type OnboardingStep } from "./onboarding-flow";

type AppStep = "loading" | OnboardingStep | "content" | "adult";

const CHILD_SESSION_KEY = "xiaoban.child.session";
const CHILD_MODE_SNAPSHOT_KEY = "xiaoban.child.mode-snapshot.v1";
const ONBOARDING_DRAFT_KEY = "xiaoban.child.onboarding-draft.v1";

interface OnboardingDraft {
  grade: ChildGrade;
  interests: ChildInterest[];
}

function readChildModeSnapshot(): ChildModeResponse | null {
  try {
    const raw = sessionStorage.getItem(CHILD_MODE_SNAPSHOT_KEY);
    if (raw === null) return null;
    const result = childModeResponseSchema.safeParse(JSON.parse(raw));
    return result.success ? result.data : null;
  } catch {
    return null;
  }
}

function readOnboardingDraft(): OnboardingDraft | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(ONBOARDING_DRAFT_KEY) ?? "null") as Partial<OnboardingDraft> | null;
    const grades = ["grade_4", "grade_5", "grade_6", "grade_7", "grade_8"];
    const validInterests = ["drawing", "sports", "reading", "tidying"];
    if (
      value === null
      || !grades.includes(value.grade ?? "")
      || !Array.isArray(value.interests)
      || value.interests.length === 0
      || value.interests.some((item) => !validInterests.includes(item))
    ) return null;
    return value as OnboardingDraft;
  } catch {
    return null;
  }
}

function storeChildModeSnapshot(mode: ChildModeResponse): void {
  sessionStorage.setItem(CHILD_MODE_SNAPSHOT_KEY, JSON.stringify(mode));
}

function clearChildSession(): void {
  sessionStorage.removeItem(CHILD_SESSION_KEY);
  sessionStorage.removeItem(CHILD_MODE_SNAPSHOT_KEY);
  sessionStorage.removeItem(ONBOARDING_DRAFT_KEY);
  clearChildContentCache();
}

function isAccessError(reason: unknown): boolean {
  return reason instanceof ApiError
    && ["UNAUTHORIZED", "FORBIDDEN", "ACCOUNT_DEACTIVATED"].includes(reason.code);
}

function publicError(reason: unknown): ApiError {
  return reason instanceof ApiError
    ? reason
    : new ApiError("INTERNAL_ERROR", "暂时无法完成。", "请稍后重试。");
}

function defaultGrade(ageBand: AgeBand): ChildGrade {
  return ageBand === "9_11" ? "grade_5" : "grade_7";
}

async function loadLocalTestAccount() {
  if (!import.meta.env.DEV) {
    throw new ApiError("FORBIDDEN", "本地合成入口不可用。", "请从正式邀请流程进入。");
  }
  return import("./local-test-account");
}

export function App() {
  const [step, setStep] = useState<AppStep>("loading");
  const [serviceState, setServiceState] = useState<ServiceState>("checking");
  const [childToken, setChildToken] = useState<string | null>(null);
  const [guardianToken, setGuardianToken] = useState<string | null>(null);
  const [childAlias, setChildAlias] = useState("");
  const [grade, setGrade] = useState<ChildGrade>("grade_5");
  const [interests, setInterests] = useState<ChildInterest[]>(["drawing", "sports"]);
  const [companion, setCompanion] = useState<ChildCompanion>("sprout");
  const [childMode, setChildMode] = useState<ChildModeResponse | null>(null);
  const [onboarding, setOnboarding] = useState<ChildOnboardingResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    async function initialize() {
      try {
        await requestJson(
          "/api/v1/readiness",
          { method: "GET", signal: controller.signal },
          readinessResponseSchema,
        );
        setServiceState("ready");
      } catch {
        if (!controller.signal.aborted) setServiceState("offline");
      }

      const storedChildToken = sessionStorage.getItem(CHILD_SESSION_KEY);
      if (storedChildToken === null || controller.signal.aborted) {
        setStep("welcome");
        return;
      }
      try {
        const [mode, profile] = await Promise.all([
          requestJson(
            "/api/v1/child/mode",
            {
              method: "GET",
              signal: controller.signal,
              headers: { authorization: `Bearer ${storedChildToken}` },
            },
            childModeResponseSchema,
          ),
          getChildOnboarding(storedChildToken, controller.signal),
        ]);
        storeChildModeSnapshot(mode);
        setChildToken(storedChildToken);
        setChildMode(mode);
        setChildAlias(mode.child.alias);
        setOnboarding(profile);
        if (profile.status === "completed") {
          setCompanion(profile.profile.companion);
          setStep("content");
          return;
        }
        const draft = readOnboardingDraft();
        if (draft !== null) {
          setGrade(draft.grade);
          setInterests(draft.interests);
          setStep("companion");
        } else {
          setGrade(defaultGrade(mode.child.ageBand));
          setStep("setup");
        }
      } catch (reason) {
        const snapshot = isAccessError(reason) ? null : readChildModeSnapshot();
        if (snapshot !== null) {
          setChildToken(storedChildToken);
          setChildMode(snapshot);
          setChildAlias(snapshot.child.alias);
          setStep("setup");
          return;
        }
        clearChildSession();
        setStep("welcome");
      }
    }
    void initialize();
    return () => controller.abort();
  }, []);

  async function handleSetup(input: { ageBand: AgeBand; alias: string; grade: ChildGrade; interests: ChildInterest[] }) {
    setLoading(true);
    setError(null);
    try {
      const { createLocalTestAccountSession } = await loadLocalTestAccount();
      const { mode, token } = await createLocalTestAccountSession({ alias: input.alias, ageBand: input.ageBand });
      clearChildSession();
      sessionStorage.setItem(CHILD_SESSION_KEY, token);
      storeChildModeSnapshot(mode);
      sessionStorage.setItem(ONBOARDING_DRAFT_KEY, JSON.stringify({ grade: input.grade, interests: input.interests }));
      setChildToken(token);
      setChildMode(mode);
      setChildAlias(mode.child.alias);
      setGrade(input.grade);
      setInterests(input.interests);
      setStep("companion");
    } catch (reason) {
      setError(publicError(reason));
    } finally {
      setLoading(false);
    }
  }

  async function handleResume() {
    setLoading(true);
    setError(null);
    try {
      const { resumeLocalTestAccountSession } = await loadLocalTestAccount();
      const { mode, token } = await resumeLocalTestAccountSession();
      const profile = await getChildOnboarding(token);
      clearChildSession();
      sessionStorage.setItem(CHILD_SESSION_KEY, token);
      storeChildModeSnapshot(mode);
      setChildToken(token);
      setChildMode(mode);
      setChildAlias(mode.child.alias);
      setOnboarding(profile);
      if (profile.status === "completed") {
        setCompanion(profile.profile.companion);
        setStep("content");
      } else {
        setGrade(defaultGrade(mode.child.ageBand));
        setStep("boundaries");
      }
    } catch (reason) {
      setError(publicError(reason));
    } finally {
      setLoading(false);
    }
  }

  async function handleFinish() {
    if (childToken === null) {
      setError(new ApiError("UNAUTHORIZED", "登录状态无效。", "请返回资料页重新进入。"));
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const result = await completeChildOnboarding(childToken, { grade, interests, companion });
      if (result.status !== "completed") {
        throw new ApiError("INTERNAL_ERROR", "资料没有保存完整。", "请稍后重试。");
      }
      sessionStorage.removeItem(ONBOARDING_DRAFT_KEY);
      setOnboarding(result);
      setStep("content");
    } catch (reason) {
      setError(publicError(reason));
    } finally {
      setLoading(false);
    }
  }

  async function handleOpenAdult() {
    try {
      const { createLocalTestGuardianSession } = await loadLocalTestAccount();
      const session = await createLocalTestGuardianSession();
      setGuardianToken(session.token);
      setStep("adult");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (reason) {
      throw publicError(reason);
    }
  }

  if (step === "loading") {
    return <main className="intro-shell intro-step-shell"><section className="intro-step-card" role="status"><p className="intro-eyebrow">小伴</p><h1>正在翻开<br />你的成长手账…</h1></section></main>;
  }

  if (step === "content" && childMode !== null && childToken !== null && onboarding?.status === "completed") {
    return (
      <ChildContent
        profile={onboarding.profile}
        token={childToken}
        {...(import.meta.env.DEV ? { onOpenAdult: handleOpenAdult } : {})}
        onExit={() => {
          clearChildSession();
          setChildToken(null);
          setChildMode(null);
          setOnboarding(null);
          setStep("welcome");
        }}
      />
    );
  }

  if (step === "adult" && guardianToken !== null) {
    return <GuardianDashboard token={guardianToken} onExit={() => { setGuardianToken(null); setStep("content"); window.scrollTo({ top: 0, behavior: "smooth" }); }} />;
  }

  if (step === "adult") {
    return <main className="intro-shell intro-step-shell"><section className="intro-step-card" role="status"><p className="intro-eyebrow">小伴 · 监护端</p><h1>正在核验<br />监护身份…</h1></section></main>;
  }

  if (step === "content") {
    return <main className="intro-shell intro-step-shell"><section className="intro-step-card" role="status"><p className="intro-eyebrow">小伴</p><h1>正在恢复<br />你的成长手账…</h1></section></main>;
  }

  return (
    <ChildOnboarding
      alias={childAlias}
      companion={companion}
      error={error}
      grade={grade}
      interests={interests}
      loading={loading}
      serviceState={serviceState}
      step={step}
      onAliasChange={setChildAlias}
      onBack={() => {
        setError(null);
        setStep(step === "boundaries" ? "welcome" : step === "setup" ? "boundaries" : "setup");
      }}
      onCompanionChange={setCompanion}
      onFinish={() => void handleFinish()}
      onGradeChange={setGrade}
      onInterestToggle={(value) => setInterests((current) => current.includes(value)
        ? current.filter((item) => item !== value)
        : [...current, value])}
      onResume={() => void handleResume()}
      onSetup={(value) => void handleSetup(value)}
      onStart={() => {
        setError(null);
        setStep(advanceOnboarding(step));
      }}
    />
  );
}
