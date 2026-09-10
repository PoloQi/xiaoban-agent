import { childModeResponseSchema } from "@xiaoban/contracts";
import {
  localTestAccountSessionResponseSchema,
  localTestGuardianSessionResponseSchema,
  type LocalTestAccountSessionRequest,
} from "@xiaoban/contracts/local-test-account";

import { requestJson } from "./api";

export async function createLocalTestAccountSession(
  input: LocalTestAccountSessionRequest,
) {
  const session = await requestJson(
    "/api/v1/dev/test-account/session",
    { method: "POST", body: JSON.stringify(input) },
    localTestAccountSessionResponseSchema,
  );
  const mode = await requestJson(
    "/api/v1/child/mode",
    {
      method: "GET",
      headers: { authorization: `Bearer ${session.childSessionToken}` },
    },
    childModeResponseSchema,
  );
  return { mode, token: session.childSessionToken };
}

export async function resumeLocalTestAccountSession() {
  const session = await requestJson(
    "/api/v1/dev/test-account/session/resume",
    { method: "POST", body: "{}" },
    localTestAccountSessionResponseSchema,
  );
  const mode = await requestJson(
    "/api/v1/child/mode",
    {
      method: "GET",
      headers: { authorization: `Bearer ${session.childSessionToken}` },
    },
    childModeResponseSchema,
  );
  return { mode, token: session.childSessionToken };
}

export async function createLocalTestGuardianSession() {
  const session = await requestJson(
    "/api/v1/dev/test-account/guardian-session",
    { method: "POST", body: "{}" },
    localTestGuardianSessionResponseSchema,
  );
  return { account: session.account, token: session.guardianSessionToken };
}
