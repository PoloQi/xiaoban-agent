import type { FastifyInstance } from "fastify";

import {
  CHILD_CHAT_SCHEMA_VERSION,
  childChatRequestSchema,
  childChatResponseSchema,
  type ChildChatRequest,
} from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { ChildChatService } from "./child-chat-service.js";

const requestJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["requestId", "text"],
  properties: {
    requestId: { type: "string", format: "uuid" },
    text: { type: "string", minLength: 1, maxLength: 700 },
    history: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["role", "text"],
        properties: {
          role: { type: "string", enum: ["child", "assistant"] },
          text: { type: "string", minLength: 1, maxLength: 800 },
        },
      },
    },
  },
} as const;

const responseJsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: ["schemaVersion", "requestId", "route", "reply"],
      properties: {
        schemaVersion: { type: "string", const: CHILD_CHAT_SCHEMA_VERSION },
        requestId: { type: "string", format: "uuid" },
        route: { type: "string", const: "reply" },
        reply: { type: "string", minLength: 1, maxLength: 800 },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "schemaVersion",
        "requestId",
        "route",
        "level",
        "title",
        "steps",
        "notificationStatus",
      ],
      properties: {
        schemaVersion: { type: "string", const: CHILD_CHAT_SCHEMA_VERSION },
        requestId: { type: "string", format: "uuid" },
        route: { type: "string", const: "fixed_safety" },
        level: { type: "string", enum: ["L2", "L3"] },
        title: { type: "string", minLength: 2, maxLength: 40 },
        steps: {
          type: "array",
          minItems: 2,
          maxItems: 4,
          items: { type: "string", minLength: 4, maxLength: 120 },
        },
        notificationStatus: { type: "string", const: "not_sent" },
      },
    },
  ],
} as const;

const errorJsonSchema = {
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

function token(authorization: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
  if (match?.[1] === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
  return match[1];
}

export function registerChildChatRoutes(
  app: FastifyInstance,
  service: ChildChatService,
): void {
  app.post<{ Body: ChildChatRequest }>(
    "/api/v1/child/chat",
    {
      validatorCompiler: () => (data) => {
        const parsed = childChatRequestSchema.safeParse(data);
        if (parsed.success) return { value: parsed.data };
        return {
          error: Object.assign(new Error("INVALID_REQUEST"), { validation: [] }),
        };
      },
      schema: {
        body: requestJsonSchema,
        response: { 200: responseJsonSchema, "4xx": errorJsonSchema },
      },
    },
    async (request) => {
      const parsed = childChatRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new PublicAppError("INVALID_REQUEST", 400);
      }
      return childChatResponseSchema.parse(
        await service.chat(token(request.headers.authorization), parsed.data),
      );
    },
  );
}
