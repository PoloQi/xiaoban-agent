import { guardianDashboardResponseSchema } from "@xiaoban/contracts";

import { requestJson } from "./api";

export function getGuardianDashboard(token: string, signal?: AbortSignal) {
  return requestJson(
    "/api/v1/guardian/dashboard",
    {
      method: "GET",
      ...(signal === undefined ? {} : { signal }),
      headers: { authorization: `Bearer ${token}` },
    },
    guardianDashboardResponseSchema,
  );
}
