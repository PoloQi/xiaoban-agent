import type { ChildOnboardingResponse } from "@xiaoban/contracts";

export type CompletedChildProfile = Extract<
  ChildOnboardingResponse,
  { status: "completed" }
>["profile"];

const GRADE_LABELS: Record<CompletedChildProfile["grade"], string> = {
  grade_4: "四年级",
  grade_5: "五年级",
  grade_6: "六年级",
  grade_7: "初一",
  grade_8: "初二",
};

const INTEREST_LABELS: Record<CompletedChildProfile["interests"][number], string> = {
  drawing: "画画",
  sports: "运动",
  reading: "阅读",
  tidying: "整理",
};

export function childProfileLabels(profile: CompletedChildProfile) {
  return {
    grade: GRADE_LABELS[profile.grade],
    interests: profile.interests.map((interest) => INTEREST_LABELS[interest]),
  };
}
