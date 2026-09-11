import type { FastifyInstance } from "fastify";

import {
  childOnboardingCompletionRequestSchema,
  childProfileUpdateRequestSchema,
  type ChildOnboardingCompletionRequest,
  type ChildProfileUpdateRequest,
} from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { ChildOnboardingService } from "./child-onboarding-service.js";

const authorizationHeaderSchema = {
  type: "object",
  required: ["authorization"],
  properties: { authorization: { type: "string", pattern: "^Bearer .+$" } },
} as const;

const completionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["requestId", "grade", "interests", "companion"],
  properties: {
    requestId: { type: "string", format: "uuid" },
    grade: { type: "string", enum: ["grade_4", "grade_5", "grade_6", "grade_7", "grade_8"] },
    interests: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
      items: { type: "string", enum: ["drawing", "sports", "reading", "tidying"] },
    },
    companion: { type: "string", enum: ["sprout", "cloud", "kite"] },
  },
} as const;

const profileUpdateBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["requestId", "alias", "grade", "interests", "companion"],
  properties: {
    requestId: { type: "string", format: "uuid" },
    alias: {
      type: "string",
      minLength: 2,
      maxLength: 20,
      pattern: "^[\\p{L}\\p{N}·_-]+$",
    },
    grade: { type: "string", enum: ["grade_4", "grade_5", "grade_6", "grade_7", "grade_8"] },
    interests: {
      type: "array",
      minItems: 1,
      maxItems: 4,
      uniqueItems: true,
      items: { type: "string", enum: ["drawing", "sports", "reading", "tidying"] },
    },
    companion: { type: "string", enum: ["sprout", "cloud", "kite"] },
  },
} as const;

const responseSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "status", "profile"],
  properties: {
    schemaVersion: { type: "string", const: "child-onboarding-2026-08-v1" },
    status: { type: "string", enum: ["not_started", "completed"] },
    profile: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: [
            "alias",
            "ageBand",
            "grade",
            "interests",
            "companion",
            "completedAt",
            "updatedAt",
          ],
          properties: {
            alias: { type: "string", minLength: 2, maxLength: 20 },
            ageBand: { type: "string", enum: ["9_11", "12_14"] },
            grade: { type: "string", enum: ["grade_4", "grade_5", "grade_6", "grade_7", "grade_8"] },
            interests: {
              type: "array",
              minItems: 1,
              maxItems: 4,
              uniqueItems: true,
              items: { type: "string", enum: ["drawing", "sports", "reading", "tidying"] },
            },
            companion: { type: "string", enum: ["sprout", "cloud", "kite"] },
            completedAt: { type: "string", format: "date-time" },
            updatedAt: {
              anyOf: [
                { type: "string", format: "date-time" },
                { type: "null" },
              ],
            },
          },
        },
      ],
    },
  },
} as const;

function tokenFromAuthorization(value: string | undefined): string {
  if (value === undefined || !value.startsWith("Bearer ")) {
    throw new PublicAppError("UNAUTHORIZED", 401);
  }
  return value.slice(7);
}

export function registerChildOnboardingRoutes(
  app: FastifyInstance,
  service: ChildOnboardingService,
): void {
  app.get(
    "/api/v1/child/onboarding",
    { schema: { headers: authorizationHeaderSchema, response: { 200: responseSchema } } },
    async (request) => service.get(tokenFromAuthorization(request.headers.authorization)),
  );

  app.post(
    "/api/v1/child/onboarding/completion",
    {
      schema: {
        headers: authorizationHeaderSchema,
        body: completionBodySchema,
        response: { 201: responseSchema },
      },
    },
    async (request, reply) => {
      const body = childOnboardingCompletionRequestSchema.parse(request.body) as ChildOnboardingCompletionRequest;
      return reply.code(201).send(
        await service.complete(tokenFromAuthorization(request.headers.authorization), body),
      );
    },
  );

  app.patch(
    "/api/v1/child/profile",
    {
      schema: {
        headers: authorizationHeaderSchema,
        body: profileUpdateBodySchema,
        response: { 200: responseSchema },
      },
    },
    async (request, reply) => {
      // aliasSchema 含 .refine（拒绝纯数字）；fast-json-stringify 不验证 Zod refine，
      // 因此用 safeParse 让 alias 校验失败显式返回 400 INVALID_REQUEST 而不是 500。
      const parsed = childProfileUpdateRequestSchema.safeParse(request.body);
      if (!parsed.success) {
        throw new PublicAppError("INVALID_REQUEST", 400);
      }
      return reply.code(200).send(
        await service.update(tokenFromAuthorization(request.headers.authorization), parsed.data as ChildProfileUpdateRequest),
      );
    },
  );
}
