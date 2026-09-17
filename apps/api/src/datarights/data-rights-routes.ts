import type { FastifyInstance } from "fastify";

import { DATA_RIGHTS_SCHEMA_VERSION } from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { DataRightsService } from "./data-rights-service.js";

const headersSchema = {
  type: "object",
  required: ["authorization"],
  properties: { authorization: { type: "string", minLength: 50, maxLength: 50 } },
} as const;

const errorSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "nextAction", "requestId"],
      properties: {
        code: { type: "string" },
        message: { type: "string" },
        nextAction: { type: "string" },
        requestId: { type: "string" },
      },
    },
  },
} as const;

function bearerToken(authorization: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
  if (match?.[1] === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
  return match[1];
}

export function registerDataRightsRoutes(
  app: FastifyInstance,
  service: DataRightsService,
): void {
  app.post(
    "/api/v1/guardian/data-rights/requests",
    {
      schema: {
        headers: headersSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "requestType", "reasonCode", "confirmed"],
          properties: {
            requestId: { type: "string", format: "uuid" },
            requestType: { type: "string", enum: ["delete", "export"] },
            reasonCode: {
              type: "string",
              enum: ["privacy_request", "guardian_choice", "pilot_exit"],
            },
            confirmed: { type: "boolean" },
          },
        },
        response: {
          201: {
            type: "object",
            additionalProperties: false,
            required: [
              "schemaVersion",
              "requestId",
              "requestType",
              "status",
              "childStatus",
              "queuedForManualProcessing",
              "effectiveAt",
            ],
            properties: {
              schemaVersion: { type: "string", const: DATA_RIGHTS_SCHEMA_VERSION },
              requestId: { type: "string", format: "uuid" },
              requestType: { type: "string", enum: ["delete", "export"] },
              status: { type: "string", enum: ["received", "queued", "processing", "completed"] },
              childStatus: { type: "string", enum: ["active", "deactivated"] },
              queuedForManualProcessing: { type: "boolean" },
              effectiveAt: {
                anyOf: [{ type: "string", format: "date-time" }, { type: "null" }],
              },
            },
          },
          "4xx": errorSchema,
        },
      },
    },
    async (request, reply) => {
      const token = bearerToken(request.headers.authorization);
      return reply.code(201).send(await service.submitRequest(token, request.body));
    },
  );
}
