import { useEffect, useState, type FormEvent, type ReactNode } from "react";

import {
  type ChildCompanion,
  type ChildGrade,
  type ChildInterest,
} from "@xiaoban/contracts";

import { ApiError } from "./api";
import { COMPANION_COPY, CompanionIllustration } from "./companion";
import {
  PROFILE_EDIT_COMPANION_OPTIONS,
  PROFILE_EDIT_GRADE_OPTIONS,
  PROFILE_EDIT_INTEREST_OPTIONS,
  updateChildProfile,
  type CompletedChildProfile,
} from "./profile";

interface ChildProfileEditProps {
  profile: CompletedChildProfile;
  token: string;
  onClose: () => void;
  onSaved: (next: CompletedChildProfile) => void;
}

interface EditState {
  alias: string;
  grade: ChildGrade;
  interests: ChildInterest[];
  companion: ChildCompanion;
}

function FieldIcon({ children }: { children: ReactNode }) {
  return <svg aria-hidden="true" viewBox="0 0 24 24">{children}</svg>;
}

export function ChildProfileEdit({ profile, token, onClose, onSaved }: ChildProfileEditProps) {
  const [state, setState] = useState<EditState>({
    alias: profile.alias,
    grade: profile.grade,
    interests: profile.interests,
    companion: profile.companion,
  });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [closed, setClosed] = useState(false);

  useEffect(() => {
    if (closed) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape" && !submitting) onClose();
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [closed, submitting, onClose]);

  // ageBand 决定可选年级：与后端 gradeMatchesAgeBand 共用约束
  const allowedGrades: ChildGrade[] = profile.ageBand === "9_11"
    ? ["grade_4", "grade_5", "grade_6"]
    : ["grade_7", "grade_8"];

  const aliasTrimmed = state.alias.trim();
  const aliasValid = aliasTrimmed.length >= 2 && aliasTrimmed.length <= 8;
  const interestsValid = state.interests.length >= 1 && state.interests.length <= 4;
  const gradeInBand = allowedGrades.includes(state.grade);
  const canSubmit = !submitting && aliasValid && interestsValid && gradeInBand;

  function toggleInterest(value: ChildInterest) {
    setState((current) => ({
      ...current,
      interests: current.interests.includes(value)
        ? current.interests.filter((item) => item !== value)
        : [...current.interests, value],
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      const response = await updateChildProfile(token, {
        alias: aliasTrimmed,
        grade: state.grade,
        interests: state.interests,
        companion: state.companion,
      });
      if (response.status !== "completed" || response.profile === null) {
        throw new ApiError("INTERNAL_ERROR", "资料没有保存完整。", "请稍后重试。");
      }
      setClosed(true);
      onSaved(response.profile);
    } catch (reason) {
      setError(reason instanceof ApiError
        ? reason
        : new ApiError("INTERNAL_ERROR", "暂时无法保存。", "请稍后重试。"));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="child-profile-edit-backdrop"
      role="dialog"
      aria-modal="true"
      aria-labelledby="child-profile-edit-title"
    >
      <form className="child-profile-edit" onSubmit={submit}>
        <header className="child-profile-edit-heading">
          <div>
            <p>PROFILE · EDIT</p>
            <h2 id="child-profile-edit-title">修改我的资料</h2>
          </div>
          <button
            type="button"
            className="child-profile-edit-close"
            aria-label="关闭"
            onClick={() => { if (!submitting) onClose(); }}
            disabled={submitting}
          >
            <FieldIcon><path d="M6 6l12 12M18 6L6 18" /></FieldIcon>
          </button>
        </header>

        <p className="child-profile-edit-hint">
          这里改的是你自己的资料。不会重新看边界说明，也不会影响你已绑定的可信任大人。
        </p>

        <label className="child-profile-edit-field">
          <span>昵称</span>
          <input
            value={state.alias}
            onChange={(event) => setState((current) => ({ ...current, alias: event.target.value }))}
            minLength={2}
            maxLength={8}
            autoComplete="off"
            required
            aria-describedby="child-profile-edit-alias-help"
          />
          <small id="child-profile-edit-alias-help">2—8 个字符，用昵称就好，不需要填写真实姓名或电话号码。</small>
        </label>

        <fieldset className="child-profile-edit-fieldset">
          <legend>你现在读几年级？</legend>
          <div className="child-profile-edit-choices">
            {PROFILE_EDIT_GRADE_OPTIONS.map(({ value, label }) => {
              const disabled = !allowedGrades.includes(value);
              return (
                <button
                  key={value}
                  type="button"
                  className={state.grade === value ? "is-selected" : ""}
                  aria-pressed={state.grade === value}
                  disabled={disabled}
                  onClick={() => setState((current) => ({ ...current, grade: value }))}
                >
                  {label}
                </button>
              );
            })}
          </div>
          <small>只能选择适合你年龄段的年级。</small>
        </fieldset>

        <fieldset className="child-profile-edit-fieldset">
          <legend>你平时喜欢做什么？</legend>
          <div className="child-profile-edit-choices">
            {PROFILE_EDIT_INTEREST_OPTIONS.map(({ value, label }) => (
              <button
                key={value}
                type="button"
                className={state.interests.includes(value) ? "is-selected" : ""}
                aria-pressed={state.interests.includes(value)}
                onClick={() => toggleInterest(value)}
              >
                {label}
              </button>
            ))}
          </div>
          <small>至少选 1 项，至多 4 项。</small>
        </fieldset>

        <fieldset className="child-profile-edit-fieldset">
          <legend>换一个伙伴陪你</legend>
          <div className="child-profile-edit-companions">
            {(Object.keys(COMPANION_COPY) as ChildCompanion[]).map((value) => {
              const copy = COMPANION_COPY[value];
              return (
                <button
                  key={value}
                  type="button"
                  className={state.companion === value ? "is-selected" : ""}
                  aria-pressed={state.companion === value}
                  onClick={() => setState((current) => ({ ...current, companion: value }))}
                >
                  <CompanionIllustration companion={value} />
                  <span><b>{copy.name}</b><small>{copy.description}</small></span>
                </button>
              );
            })}
          </div>
        </fieldset>

        {error !== null && (
          <div className="child-profile-edit-error" role="alert">
            <strong>{error.message}</strong>
            <span>{error.nextAction}</span>
          </div>
        )}

        <footer className="child-profile-edit-actions">
          <button
            type="button"
            className="child-profile-edit-cancel"
            onClick={() => { if (!submitting) onClose(); }}
            disabled={submitting}
          >
            取消
          </button>
          <button
            type="submit"
            className="child-profile-edit-save"
            disabled={!canSubmit}
          >
            {submitting ? "正在保存…" : "保存"}
          </button>
        </footer>
      </form>
    </div>
  );
}
