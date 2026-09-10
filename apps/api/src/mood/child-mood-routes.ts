import type { FastifyInstance } from "fastify";
import type { ZodType } from "zod";

import {
  CHILD_MOOD_CHECK_IN_SCHEMA_VERSION,
  childMoodCheckInRequestSchema,
  type ChildMoodCheckInRequest,
} from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { ChildMoodService } from "./child-mood-service.js";

const moods = ["happy", "calm", "bored", "sad", "angry", "worried"] as const;
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
        code: { type: "string" }, message: { type: "string" },
        nextAction: { type: "string" }, requestId: { type: "string" },
      },
    },
  },
} as const;
const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "date", "mood", "updatedAt"],
  properties: {
    schemaVersion: { type: "string", const: CHILD_MOOD_CHECK_IN_SCHEMA_VERSION },
    date: { type: "string", format: "date" },
    mood: { anyOf: [{ type: "string", enum: moods }, { type: "null" }] },
    updatedAt: { anyOf: [{ type: "string", format: "date-time" }, { type: "null" }] },
  },
} as const;

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new PublicAppError("INVALID_REQUEST", 400);
  return result.data;
}

function token(authorization: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
  if (match?.[1] === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
  return match[1];
}

export function registerChildMoodRoutes(app: FastifyInstance, service: ChildMoodService): void {
  app.get("/api/v1/child/mood-check-in", {
    schema: { headers: headersSchema, response: { 200: responseSchema, "4xx": errorSchema } },
  }, async (request) => service.get(token(request.headers.authorization)));

  app.put<{ Body: ChildMoodCheckInRequest }>("/api/v1/child/mood-check-in", {
    schema: {
      headers: headersSchema,
      body: {
        type: "object", additionalProperties: false, required: ["requestId", "mood"],
        properties: {
          requestId: { type: "string", format: "uuid" },
          mood: { anyOf: [{ type: "string", enum: moods }, { type: "null" }] },
        },
      },
      response: { 200: responseSchema, "4xx": errorSchema },
    },
  }, async (request) => service.save(
    token(request.headers.authorization),
    parse(childMoodCheckInRequestSchema, request.body),
  ));
}
