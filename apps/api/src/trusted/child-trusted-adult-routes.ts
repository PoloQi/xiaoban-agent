import type { FastifyInstance } from "fastify";

import {
  CHILD_TRUSTED_ADULTS_SCHEMA_VERSION,
  trustedAdultChannelSchema,
  trustedAdultReachabilitySchema,
  trustedAdultRelationshipSchema,
} from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { ChildTrustedAdultService } from "./child-trusted-adult-service.js";

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

const trustedAdultsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "adults", "notificationStatus"],
  properties: {
    schemaVersion: { type: "string", const: CHILD_TRUSTED_ADULTS_SCHEMA_VERSION },
    adults: {
      type: "array",
      maxItems: 6,
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "id",
          "label",
          "relationship",
          "relationshipLabel",
          "channel",
          "channelLabel",
          "reachability",
          "reachabilityLabel",
          "verifiedAt",
        ],
        properties: {
          id: { type: "string", format: "uuid" },
          label: { type: "string", minLength: 1, maxLength: 12 },
          relationship: { type: "string", enum: [...trustedAdultRelationshipSchema.options] },
          relationshipLabel: { type: "string", minLength: 1, maxLength: 12 },
          channel: { type: "string", enum: [...trustedAdultChannelSchema.options] },
          channelLabel: { type: "string", minLength: 1, maxLength: 24 },
          reachability: { type: "string", enum: [...trustedAdultReachabilitySchema.options] },
          reachabilityLabel: { type: "string", minLength: 1, maxLength: 24 },
          verifiedAt: { type: "string", format: "date-time" },
        },
      },
    },
    notificationStatus: { type: "string", const: "not_sent" },
  },
} as const;

function token(authorization: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
  if (match?.[1] === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
  return match[1];
}

export function registerChildTrustedAdultRoutes(
  app: FastifyInstance,
  service: ChildTrustedAdultService,
): void {
  app.get("/api/v1/child/trusted-adults", {
    schema: {
      headers: headersSchema,
      response: { 200: trustedAdultsJsonSchema, "4xx": errorSchema },
    },
  }, async (request) => service.list(token(request.headers.authorization)));
}
