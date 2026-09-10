import {
  childTrustedAdultsResponseSchema,
  type ChildTrustedAdultsResponse,
} from "@xiaoban/contracts";

import { requestJson } from "./api";

export function loadChildTrustedAdults(
  token: string,
  signal?: AbortSignal,
): Promise<ChildTrustedAdultsResponse> {
  return requestJson(
    "/api/v1/child/trusted-adults",
    {
      method: "GET",
      ...(signal === undefined ? {} : { signal }),
      headers: { authorization: `Bearer ${token}` },
    },
    childTrustedAdultsResponseSchema,
  );
}
