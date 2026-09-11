import {
  childGrowthAttemptRequestSchema,
  childGrowthGoalListResponseSchema,
  childGrowthPlanResponseSchema,
  type ChildGrowthAttemptRequest,
  type ChildGrowthGoalListResponse,
  type ChildGrowthPlanResponse,
} from "@xiaoban/contracts";

import { requestJson } from "./api";

export async function loadChildGrowthPlan(
  token: string,
  signal?: AbortSignal,
): Promise<ChildGrowthPlanResponse> {
  return requestJson(
    "/api/v1/child/growth-plan",
    {
      method: "GET",
      ...(signal === undefined ? {} : { signal }),
      headers: { authorization: `Bearer ${token}` },
    },
    childGrowthPlanResponseSchema,
  );
}

export async function recordChildGrowthAttempt(
  token: string,
  input: { source: "manual" } | {
    source: "activity";
    activitySlug: string;
    targetMinutes: number;
    feeling?: "lighter" | "same" | "rest";
  },
): Promise<ChildGrowthPlanResponse> {
  const request = childGrowthAttemptRequestSchema.parse({
    requestId: crypto.randomUUID(),
    ...input,
  });
  return requestJson(
    "/api/v1/child/growth-attempts",
    {
      method: "POST",
      body: JSON.stringify(request),
      headers: { authorization: `Bearer ${token}` },
    },
    childGrowthPlanResponseSchema,
  );
}

export async function loadChildGrowthGoals(
  token: string,
): Promise<ChildGrowthGoalListResponse> {
  return requestJson(
    "/api/v1/child/growth-goals",
    {
      method: "GET",
      headers: { authorization: `Bearer ${token}` },
    },
    childGrowthGoalListResponseSchema,
  );
}

export async function updateChildGrowthGoal(
  token: string,
  goalKey: ChildGrowthGoalListResponse["currentKey"],
): Promise<ChildGrowthGoalListResponse> {
  return requestJson(
    "/api/v1/child/growth-goal",
    {
      method: "PATCH",
      body: JSON.stringify({ requestId: crypto.randomUUID(), goalKey }),
      headers: { authorization: `Bearer ${token}` },
    },
    childGrowthGoalListResponseSchema,
  );
}
