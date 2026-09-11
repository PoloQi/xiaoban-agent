import {
  childOnboardingResponseSchema,
  type ChildCompanion,
  type ChildGrade,
  type ChildInterest,
  type ChildOnboardingResponse,
  type ChildProfileUpdateRequest,
} from "@xiaoban/contracts";

import { requestJson } from "./api";

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

export type ProfileUpdateInput = Omit<ChildProfileUpdateRequest, "requestId">;

/**
 * 资料编辑：PATCH /api/v1/child/profile
 * 修改昵称/年级/兴趣/伙伴，不重置边界说明、不创建新账户、不扩张成人端。
 */
export function updateChildProfile(token: string, input: ProfileUpdateInput) {
  return requestJson(
    "/api/v1/child/profile",
    {
      method: "PATCH",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...input }),
    },
    childOnboardingResponseSchema,
  );
}

export const PROFILE_EDIT_GRADE_OPTIONS: Array<{ value: ChildGrade; label: string }> = [
  { value: "grade_4", label: "四年级" },
  { value: "grade_5", label: "五年级" },
  { value: "grade_6", label: "六年级" },
  { value: "grade_7", label: "初一" },
  { value: "grade_8", label: "初二" },
];

export const PROFILE_EDIT_INTEREST_OPTIONS: Array<{
  value: ChildInterest;
  label: string;
}> = [
  { value: "drawing", label: "画画" },
  { value: "sports", label: "运动" },
  { value: "reading", label: "阅读" },
  { value: "tidying", label: "整理" },
];

export const PROFILE_EDIT_COMPANION_OPTIONS: Array<{
  value: ChildCompanion;
  label: string;
  description: string;
}> = [
  { value: "sprout", label: "小芽", description: "温柔、慢节奏" },
  { value: "cloud", label: "小云", description: "明亮、好奇" },
  { value: "kite", label: "小风", description: "活泼、爱玩" },
];
