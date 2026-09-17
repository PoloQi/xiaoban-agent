import type { FastifyInstance } from "fastify";

import { RISK_CONSOLE_SCHEMA_VERSION } from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { RiskConsoleService } from "./risk-console-service.js";

const headersSchema = {
  type: "object",
  properties: { authorization: { type: "string", minLength: 1, maxLength: 120 } },
} as const;

const paramsSchema = {
  type: "object",
  required: ["ticketId"],
  additionalProperties: false,
  properties: { ticketId: { type: "string", pattern: "^[0-9a-f-]{36}$" } },
} as const;

const actionBodySchema = {
  type: "object",
  required: ["requestId"],
  additionalProperties: false,
  properties: { requestId: { type: "string", format: "uuid" } },
} as const;

const noteBodySchema = {
  type: "object",
  required: ["requestId", "note"],
  additionalProperties: false,
  properties: {
    requestId: { type: "string", format: "uuid" },
    note: { type: "string", minLength: 10, maxLength: 240, pattern: "^虚构处置：" },
  },
} as const;

const resolveBodySchema = {
  type: "object",
  required: ["requestId", "dispositionNote"],
  additionalProperties: false,
  properties: {
    requestId: { type: "string", format: "uuid" },
    dispositionNote: { type: "string", minLength: 10, maxLength: 240, pattern: "^虚构处置：" },
  },
} as const;

const errorResponses = {
  "4xx": {
    type: "object",
    additionalProperties: false,
    required: ["error"],
    properties: {
      error: {
        type: "object",
        additionalProperties: false,
        required: ["code", "message", "nextAction", "requestId"],
        properties: {
          code: {
            type: "string",
            enum: ["INVALID_REQUEST", "UNAUTHORIZED", "FORBIDDEN", "NOT_FOUND", "IDEMPOTENCY_CONFLICT", "ACCOUNT_DEACTIVATED", "INTERNAL_ERROR"],
          },
          message: { type: "string", minLength: 1 },
          nextAction: { type: "string", minLength: 1 },
          requestId: { type: "string", minLength: 1 },
        },
      },
    },
  },
} as const;

function bearerToken(authorization: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
  if (match?.[1] === undefined) throw new PublicAppError("FORBIDDEN", 403);
  return match[1];
}

export function registerRiskConsoleRoutes(
  app: FastifyInstance,
  service: RiskConsoleService,
): void {
  app.get(
    "/api/v1/risk-console/tickets",
    { schema: { headers: headersSchema, response: { 200: riskConsoleListSchema(), ...errorResponses } } },
    async (request) => service.list(bearerToken(request.headers.authorization)),
  );

  app.get(
    "/api/v1/risk-console/tickets/:ticketId",
    { schema: { params: paramsSchema, headers: headersSchema, response: { 200: riskConsoleDetailSchema(), ...errorResponses } } },
    async (request, reply) => {
      const params = request.params as { ticketId: string };
      const result = await service.detail(bearerToken(request.headers.authorization), params.ticketId);
      return reply.send(result);
    },
  );

  app.post(
    "/api/v1/risk-console/tickets/:ticketId/claim",
    { schema: { params: paramsSchema, headers: headersSchema, body: actionBodySchema, response: { 200: riskConsoleDetailSchema(), ...errorResponses } } },
    async (request) => {
      const params = request.params as { ticketId: string };
      const body = request.body as { requestId: string };
      return service.claim(bearerToken(request.headers.authorization), params.ticketId, body.requestId);
    },
  );

  app.post(
    "/api/v1/risk-console/tickets/:ticketId/notes",
    { schema: { params: paramsSchema, headers: headersSchema, body: noteBodySchema, response: { 200: riskConsoleDetailSchema(), ...errorResponses } } },
    async (request) => {
      const params = request.params as { ticketId: string };
      const body = request.body as { requestId: string; note: string };
      return service.addNote(bearerToken(request.headers.authorization), params.ticketId, body.requestId, body.note);
    },
  );

  app.post(
    "/api/v1/risk-console/tickets/:ticketId/resolve",
    { schema: { params: paramsSchema, headers: headersSchema, body: resolveBodySchema, response: { 200: riskConsoleDetailSchema(), ...errorResponses } } },
    async (request) => {
      const params = request.params as { ticketId: string };
      const body = request.body as { requestId: string; dispositionNote: string };
      return service.resolve(bearerToken(request.headers.authorization), params.ticketId, body.requestId, body.dispositionNote);
    },
  );

  app.post(
    "/api/v1/risk-console/tickets/:ticketId/close",
    { schema: { params: paramsSchema, headers: headersSchema, body: actionBodySchema, response: { 200: riskConsoleDetailSchema(), ...errorResponses } } },
    async (request) => {
      const params = request.params as { ticketId: string };
      const body = request.body as { requestId: string };
      return service.close(bearerToken(request.headers.authorization), params.ticketId, body.requestId);
    },
  );
}

// Fastify JSON schema mirrors of the Zod contracts; the service still parses
// with Zod, so these schemas only constrain the wire shape and never trust it.
function riskConsoleListSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["schemaVersion", "synthetic", "networkCallMade", "tickets"],
    properties: {
      schemaVersion: { type: "string", const: RISK_CONSOLE_SCHEMA_VERSION },
      synthetic: { type: "boolean", const: true },
      networkCallMade: { type: "boolean", const: false },
      tickets: {
        type: "array",
        maxItems: 50,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "caseReference", "level", "primaryCategory", "status", "assigneeState", "claimedAt", "createdAt", "updatedAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            caseReference: { type: "string" },
            level: { type: "string", enum: ["L2", "L3"] },
            primaryCategory: { type: "string" },
            status: { type: "string" },
            assigneeState: { type: "string", enum: ["unclaimed", "claimed_by_me", "claimed_by_other"] },
            claimedAt: { type: ["string", "null"], format: "date-time" },
            createdAt: { type: "string", format: "date-time" },
            updatedAt: { type: "string", format: "date-time" },
          },
        },
      },
    },
  } as const;
}

function riskConsoleDetailSchema() {
  return {
    type: "object",
    additionalProperties: false,
    required: ["id", "caseReference", "level", "primaryCategory", "status", "assigneeState", "claimedAt", "createdAt", "updatedAt", "resolution", "notifications", "notes", "permissions", "notificationBoundary"],
    properties: {
      id: { type: "string", format: "uuid" },
      caseReference: { type: "string" },
      level: { type: "string", enum: ["L2", "L3"] },
      primaryCategory: { type: "string" },
      status: { type: "string" },
      assigneeState: { type: "string", enum: ["unclaimed", "claimed_by_me", "claimed_by_other"] },
      claimedAt: { type: ["string", "null"], format: "date-time" },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      resolution: { type: ["string", "null"] },
      notifications: {
        type: "array",
        minItems: 2,
        maxItems: 2,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["channel", "status", "attempts", "simulated", "networkCallMade"],
          properties: {
            channel: { type: "string", enum: ["in_app", "off_site_backup"] },
            status: { type: "string" },
            attempts: { type: "integer", minimum: 0, maximum: 2 },
            simulated: { type: "boolean", const: true },
            networkCallMade: { type: "boolean", const: false },
          },
        },
      },
      notes: {
        type: "array",
        maxItems: 1000,
        items: {
          type: "object",
          additionalProperties: false,
          required: ["id", "kind", "note", "createdAt"],
          properties: {
            id: { type: "string", format: "uuid" },
            kind: { type: "string", enum: ["claimed", "disposition_note"] },
            note: { type: ["string", "null"] },
            createdAt: { type: "string", format: "date-time" },
          },
        },
      },
      permissions: {
        type: "object",
        additionalProperties: false,
        required: ["canClaim", "canAddNote", "canResolve", "canClose"],
        properties: {
          canClaim: { type: "boolean" },
          canAddNote: { type: "boolean" },
          canResolve: { type: "boolean" },
          canClose: { type: "boolean" },
        },
      },
      notificationBoundary: {
        type: "object",
        additionalProperties: false,
        required: ["simulated", "networkCallMade", "readOnly"],
        properties: {
          simulated: { type: "boolean", const: true },
          networkCallMade: { type: "boolean", const: false },
          readOnly: { type: "boolean", const: true },
        },
      },
    },
  } as const;
}
