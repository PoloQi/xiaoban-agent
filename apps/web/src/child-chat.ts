import {
  childChatRequestSchema,
  childChatResponseSchema,
  type ChatTurn,
  type ChildChatResponse,
} from "@xiaoban/contracts";

import { requestJson } from "./api";

export async function sendChildChat(
  token: string,
  text: string,
  history: ChatTurn[],
  signal: AbortSignal,
): Promise<ChildChatResponse> {
  const request = childChatRequestSchema.parse({
    requestId: crypto.randomUUID(),
    text,
    history,
  });
  return requestJson(
    "/api/v1/child/chat",
    {
      method: "POST",
      body: JSON.stringify(request),
      signal,
      headers: { authorization: `Bearer ${token}` },
    },
    childChatResponseSchema,
  );
}
