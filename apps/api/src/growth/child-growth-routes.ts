import type { FastifyInstance } from "fastify";
import type { ZodType } from "zod";

import {
  CHILD_GROWTH_GOAL_LIST_SCHEMA_VERSION,
  CHILD_GROWTH_PLAN_SCHEMA_VERSION,
  childGrowthAttemptRequestSchema,
  childGrowthGoalKeySchema,
  childGrowthGoalUpdateRequestSchema,
  type ChildGrowthAttemptRequest,
  type ChildGrowthGoalUpdateRequest,
} from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { ChildGrowthService } from "./child-growth-service.js";

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

const goalKeyEnumValues = childGrowthGoalKeySchema.options;

const growthPlanJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "week", "goal", "days", "stats", "review"],
  properties: {
    schemaVersion: { type: "string", const: CHILD_GROWTH_PLAN_SCHEMA_VERSION },
    week: {
      type: "object",
      additionalProperties: false,
      required: ["startDate", "endDate", "timezone"],
      properties: {
        startDate: { type: "string", format: "date" },
        endDate: { type: "string", format: "date" },
        timezone: { type: "string", const: "Asia/Shanghai" },
      },
    },
    goal: {
      type: "object",
      additionalProperties: false,
      required: ["key", "title", "alternativeAction", "targetAttempts", "attemptCount", "status", "todayRecorded"],
      properties: {
        key: { type: "string", enum: goalKeyEnumValues },
        title: { type: "string" },
        alternativeAction: { type: "string" },
        targetAttempts: { type: "integer", const: 3 },
        attemptCount: { type: "integer", minimum: 0 },
        status: { type: "string", enum: ["not_started", "in_progress", "completed"] },
        todayRecorded: { type: "boolean" },
      },
    },
    days: {
      type: "array",
      minItems: 7,
      maxItems: 7,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["date", "label", "attempted"],
        properties: {
          date: { type: "string", format: "date" },
          label: { type: "string", enum: ["一", "二", "三", "四", "五", "六", "日"] },
          attempted: { type: "boolean" },
        },
      },
    },
    stats: {
      type: "object",
      additionalProperties: false,
      required: ["realWorldActivities", "goalAttempts", "activeDays"],
      properties: {
        realWorldActivities: { type: "integer", minimum: 0 },
        goalAttempts: { type: "integer", minimum: 0 },
        activeDays: { type: "integer", minimum: 0, maximum: 7 },
      },
    },
    review: {
      type: "object",
      additionalProperties: false,
      required: ["headline", "summary", "choices", "nextGoal"],
      properties: {
        headline: { type: "string" },
        summary: { type: "string" },
        choices: {
          type: "array",
          maxItems: 12,
          items: {
            type: "object",
            additionalProperties: false,
            required: ["kind", "title", "detail"],
            properties: {
              kind: { type: "string", enum: ["activity", "self_report"] },
              title: { type: "string" },
              detail: { type: "string" },
            },
          },
        },
        nextGoal: {
          type: "object",
          additionalProperties: false,
          required: ["key", "title"],
          properties: {
            key: { type: "string", enum: goalKeyEnumValues },
            title: { type: "string" },
          },
        },
      },
    },
  },
} as const;

const goalListJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "currentKey", "goals"],
  properties: {
    schemaVersion: { type: "string", const: CHILD_GROWTH_GOAL_LIST_SCHEMA_VERSION },
    currentKey: { type: "string", enum: goalKeyEnumValues },
    goals: {
      type: "array",
      minItems: 3,
      maxItems: 10,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["key", "title", "alternativeAction", "description"],
        properties: {
          key: { type: "string", enum: goalKeyEnumValues },
          title: { type: "string" },
          alternativeAction: { type: "string" },
          description: { type: "string" },
        },
      },
    },
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

export function registerChildGrowthRoutes(
  app: FastifyInstance,
  service: ChildGrowthService,
): void {
  app.get(
    "/api/v1/child/growth-plan",
    {
      schema: {
        headers: headersSchema,
        response: { 200: growthPlanJsonSchema, "4xx": errorSchema },
      },
    },
    async (request) => service.get(token(request.headers.authorization)),
  );

  app.get(
    "/api/v1/child/growth-goals",
    {
      schema: {
        headers: headersSchema,
        response: { 200: goalListJsonSchema, "4xx": errorSchema },
      },
    },
    async (request) => service.listGoals(token(request.headers.authorization)),
  );

  app.patch<{ Body: ChildGrowthGoalUpdateRequest }>(
    "/api/v1/child/growth-goal",
    {
      schema: {
        headers: headersSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "goalKey"],
          properties: {
            requestId: { type: "string", format: "uuid" },
            goalKey: { type: "string", enum: goalKeyEnumValues },
          },
        },
        response: { 200: goalListJsonSchema, "4xx": errorSchema },
      },
    },
    async (request, reply) => reply.code(200).send(await service.updateGoal(
      token(request.headers.authorization),
      parse(childGrowthGoalUpdateRequestSchema, request.body),
    )),
  );

  app.post<{ Body: ChildGrowthAttemptRequest }>(
    "/api/v1/child/growth-attempts",
    {
      schema: {
        headers: headersSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "source"],
          properties: {
            requestId: { type: "string", format: "uuid" },
            source: { type: "string", enum: ["manual", "activity"] },
            activitySlug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
            targetMinutes: { type: "integer", minimum: 1, maximum: 120 },
            feeling: { type: "string", enum: ["lighter", "same", "rest"] },
          },
        },
        response: { 201: growthPlanJsonSchema, "4xx": errorSchema },
      },
    },
    async (request, reply) => reply.code(201).send(await service.record(
      token(request.headers.authorization),
      parse(childGrowthAttemptRequestSchema, request.body),
    )),
  );
}
