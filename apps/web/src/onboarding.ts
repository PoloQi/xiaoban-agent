import {
  childOnboardingResponseSchema,
  type ChildOnboardingCompletionRequest,
} from "@xiaoban/contracts";

import { requestJson } from "./api";

export function getChildOnboarding(token: string, signal?: AbortSignal) {
  return requestJson(
    "/api/v1/child/onboarding",
    {
      method: "GET",
      ...(signal === undefined ? {} : { signal }),
      headers: { authorization: `Bearer ${token}` },
    },
    childOnboardingResponseSchema,
  );
}

export function completeChildOnboarding(
  token: string,
  input: Omit<ChildOnboardingCompletionRequest, "requestId">,
) {
  return requestJson(
    "/api/v1/child/onboarding/completion",
    {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
      body: JSON.stringify({ requestId: crypto.randomUUID(), ...input }),
    },
    childOnboardingResponseSchema,
  );
}
