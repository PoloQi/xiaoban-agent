import {
  riskConsoleTicketDetailSchema,
  riskConsoleTicketListResponseSchema,
  type RiskConsoleTicketDetail,
  type RiskConsoleTicketListResponse,
} from "@xiaoban/contracts";

import { requestJson } from "./api";

const BASE = "/api/v1/risk-console/tickets";

function headers(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

function postAction<T>(
  token: string,
  path: string,
  body: Record<string, unknown>,
): Promise<T> {
  return requestJson(
    `${BASE}/${path}`,
    { method: "POST", headers: headers(token), body: JSON.stringify(body) },
    riskConsoleTicketDetailSchema as never,
  ) as Promise<T>;
}

export function listRiskTickets(
  token: string,
  signal: AbortSignal,
): Promise<RiskConsoleTicketListResponse> {
  return requestJson(
    BASE,
    { method: "GET", headers: headers(token), signal },
    riskConsoleTicketListResponseSchema,
  );
}

export function getRiskTicket(
  token: string,
  ticketId: string,
  signal: AbortSignal,
): Promise<RiskConsoleTicketDetail> {
  return requestJson(
    `${BASE}/${ticketId}`,
    { method: "GET", headers: headers(token), signal },
    riskConsoleTicketDetailSchema,
  );
}

export function claimRiskTicket(
  token: string,
  ticketId: string,
  requestId: string,
): Promise<RiskConsoleTicketDetail> {
  return postAction<RiskConsoleTicketDetail>(token, `${ticketId}/claim`, { requestId });
}

export function addRiskTicketNote(
  token: string,
  ticketId: string,
  requestId: string,
  note: string,
): Promise<RiskConsoleTicketDetail> {
  return postAction<RiskConsoleTicketDetail>(token, `${ticketId}/notes`, { requestId, note });
}

export function resolveRiskTicket(
  token: string,
  ticketId: string,
  requestId: string,
  dispositionNote: string,
): Promise<RiskConsoleTicketDetail> {
  return postAction<RiskConsoleTicketDetail>(token, `${ticketId}/resolve`, { requestId, dispositionNote });
}

export function closeRiskTicket(
  token: string,
  ticketId: string,
  requestId: string,
): Promise<RiskConsoleTicketDetail> {
  return postAction<RiskConsoleTicketDetail>(token, `${ticketId}/close`, { requestId });
}