import {
  childGrowthAttemptRequestSchema,
  childGrowthPlanResponseSchema,
  type ChildGrowthAttemptRequest,
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
