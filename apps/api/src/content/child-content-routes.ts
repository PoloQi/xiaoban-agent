import type { FastifyInstance } from "fastify";
import { z, type ZodType } from "zod";

import {
  childContentListQuerySchema,
  contentSlugSchema,
  type ChildContentListQuery,
} from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { ChildContentService } from "./child-content-service.js";

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

const summaryBase = {
  revision: { type: "string", pattern: "^[a-f0-9]{16}$" },
  slug: { type: "string" },
  title: { type: "string" },
  summary: { type: "string" },
  sourceLabel: { type: "string" },
  expiresAt: { type: "string", format: "date-time" },
} as const;

const activitySummarySchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "type", "revision", "slug", "title", "summary", "sourceLabel", "expiresAt",
    "durationMinutes", "location", "adultSupervision",
  ],
  properties: {
    ...summaryBase,
    type: { type: "string", const: "activity" },
    durationMinutes: { type: "integer" },
    location: { type: "string", enum: ["indoor", "outdoor", "either"] },
    adultSupervision: {
      type: "string",
      enum: ["none", "recommended", "required"],
    },
  },
} as const;

const knowledgeSummarySchema = {
  type: "object",
  additionalProperties: false,
  required: ["type", "revision", "slug", "title", "summary", "sourceLabel", "expiresAt", "topic", "hasQuiz"],
  properties: {
    ...summaryBase,
    type: { type: "string", const: "knowledge" },
    topic: { type: "string", enum: ["general_growth", "emotional_social", "digital_safety", "body_boundaries"] },
    hasQuiz: { type: "boolean" },
  },
} as const;

const contentSummarySchema = { oneOf: [activitySummarySchema, knowledgeSummarySchema] } as const;
export const childContentDetailJsonSchema = {
  oneOf: [
    {
      ...activitySummarySchema,
      required: [...activitySummarySchema.required, "reviewLabel", "reviewedAt", "materials", "steps"],
      properties: {
        ...activitySummarySchema.properties,
        reviewLabel: { type: "string", const: "小伴内容审核组" },
        reviewedAt: { type: "string", format: "date-time" },
        materials: { type: "array", items: { type: "string" } },
        steps: { type: "array", items: { type: "string" } },
      },
    },
    {
      ...knowledgeSummarySchema,
      required: [...knowledgeSummarySchema.required, "reviewLabel", "reviewedAt", "paragraphs", "quiz"],
      properties: {
        ...knowledgeSummarySchema.properties,
        reviewLabel: { type: "string", const: "小伴内容审核组" },
        reviewedAt: { type: "string", format: "date-time" },
        paragraphs: { type: "array", items: { type: "string" } },
        quiz: {
          anyOf: [
            { type: "null" },
            {
              type: "object",
              additionalProperties: false,
              required: ["sceneId", "sceneLabel", "scenario", "options", "correctOptionId", "correctTitle", "incorrectTitle", "explanation", "actionSteps"],
              properties: {
                sceneId: { type: "string" }, sceneLabel: { type: "string" }, scenario: { type: "string" },
                options: {
                  type: "array", minItems: 3, maxItems: 3,
                  items: {
                    type: "object", additionalProperties: false, required: ["id", "text"],
                    properties: { id: { type: "string" }, text: { type: "string" } },
                  },
                },
                correctOptionId: { type: "string" }, correctTitle: { type: "string" },
                incorrectTitle: { type: "string" }, explanation: { type: "string" },
                actionSteps: { type: "array", items: { type: "string" } },
              },
            },
          ],
        },
      },
    },
  ],
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

export function registerChildContentRoutes(
  app: FastifyInstance,
  service: ChildContentService,
): void {
  app.get<{ Querystring: ChildContentListQuery }>(
    "/api/v1/child/content",
    {
      schema: {
        headers: headersSchema,
        querystring: {
          type: "object",
          additionalProperties: false,
          properties: {
            type: { type: "string", enum: ["all", "activity", "knowledge"], default: "all" },
            limit: { type: "integer", minimum: 1, maximum: 20, default: 12 },
            offset: { type: "integer", minimum: 0, maximum: 1000, default: 0 },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["items", "catalogRevision", "pagination"],
            properties: {
              items: { type: "array", items: contentSummarySchema },
              catalogRevision: { type: "string", pattern: "^[a-f0-9]{16}$" },
              pagination: {
                type: "object",
                additionalProperties: false,
                required: ["limit", "offset", "total"],
                properties: {
                  limit: { type: "integer" },
                  offset: { type: "integer" },
                  total: { type: "integer" },
                },
              },
            },
          },
          "4xx": errorSchema,
        },
      },
    },
    async (request) => service.list(
      token(request.headers.authorization),
      parse(childContentListQuerySchema, request.query),
    ),
  );

  app.get<{ Params: { slug: string } }>(
    "/api/v1/child/content/:slug",
    {
      schema: {
        headers: headersSchema,
        params: {
          type: "object",
          additionalProperties: false,
          required: ["slug"],
          properties: {
            slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
          },
        },
        response: { 200: childContentDetailJsonSchema, "4xx": errorSchema },
      },
    },
    async (request) => service.get(
      token(request.headers.authorization),
      parse(z.object({ slug: contentSlugSchema }), request.params).slug,
    ),
  );
}
