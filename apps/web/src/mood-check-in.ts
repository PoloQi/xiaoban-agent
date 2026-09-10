import {
  childMoodCheckInRequestSchema,
  childMoodCheckInResponseSchema,
  type ChildMood,
  type ChildMoodCheckInResponse,
} from "@xiaoban/contracts";

import { requestJson } from "./api";

export function loadChildMoodCheckIn(
  token: string,
  signal?: AbortSignal,
): Promise<ChildMoodCheckInResponse> {
  return requestJson(
    "/api/v1/child/mood-check-in",
    {
      method: "GET",
      ...(signal === undefined ? {} : { signal }),
      headers: { authorization: `Bearer ${token}` },
    },
    childMoodCheckInResponseSchema,
  );
}

export function saveChildMoodCheckIn(
  token: string,
  mood: ChildMood | null,
): Promise<ChildMoodCheckInResponse> {
  const request = childMoodCheckInRequestSchema.parse({
    requestId: crypto.randomUUID(),
    mood,
  });
  return requestJson(
    "/api/v1/child/mood-check-in",
    {
      method: "PUT",
      body: JSON.stringify(request),
      headers: { authorization: `Bearer ${token}` },
    },
    childMoodCheckInResponseSchema,
  );
}
