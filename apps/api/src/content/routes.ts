import type { FastifyInstance } from "fastify";
import { z, type ZodType } from "zod";

import {
  contentCommandRequestSchema,
  contentCreateItemRequestSchema,
  contentCreateVersionRequestSchema,
  contentDisableRequestSchema,
  contentReviewRequestSchema,
  contentVersionSelectionRequestSchema,
  type ContentCommandRequest,
  type ContentCreateItemRequest,
  type ContentCreateVersionRequest,
  type ContentDisableRequest,
  type ContentReviewRequest,
  type ContentVersionSelectionRequest,
} from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { ContentService } from "./service.js";

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

const authorizationHeadersSchema = {
  type: "object",
  required: ["authorization"],
  properties: {
    authorization: { type: "string", minLength: 50, maxLength: 50 },
  },
} as const;

const itemParamsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["itemId"],
  properties: { itemId: { type: "string", format: "uuid" } },
} as const;

const versionParamsJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["itemId", "versionId"],
  properties: {
    itemId: { type: "string", format: "uuid" },
    versionId: { type: "string", format: "uuid" },
  },
} as const;

const requestIdProperty = { type: "string", format: "uuid" } as const;
const sourceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "label"],
  properties: {
    kind: {
      type: "string",
      enum: ["synthetic_test", "official", "institution_reviewed", "local_pilot"],
    },
    label: { type: "string", minLength: 2, maxLength: 160 },
    url: { type: "string", format: "uri", maxLength: 512 },
  },
} as const;
const commonDraftProperties = {
  title: { type: "string", minLength: 2, maxLength: 80 },
  summary: { type: "string", minLength: 4, maxLength: 240 },
  ageBand: { type: "string", enum: ["9_11", "12_14", "both"] },
  source: sourceJsonSchema,
  validFrom: { type: "string", format: "date-time" },
  expiresAt: { type: "string", format: "date-time" },
  riskTags: {
    type: "array",
    maxItems: 6,
    items: {
      type: "string",
      enum: [
        "general_information",
        "digital_safety",
        "outdoor",
        "weather_sensitive",
        "adult_supervision",
        "materials_required",
      ],
    },
  },
} as const;
const draftJsonSchema = {
  oneOf: [
    {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "title",
        "summary",
        "ageBand",
        "source",
        "validFrom",
        "expiresAt",
        "riskTags",
        "body",
      ],
      properties: {
        type: { type: "string", const: "activity" },
        ...commonDraftProperties,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "durationMinutes",
            "location",
            "materials",
            "adultSupervision",
            "steps",
          ],
          properties: {
            durationMinutes: { type: "integer", minimum: 5, maximum: 120 },
            location: { type: "string", enum: ["indoor", "outdoor", "either"] },
            materials: {
              type: "array",
              maxItems: 8,
              items: { type: "string", minLength: 1, maxLength: 40 },
            },
            adultSupervision: {
              type: "string",
              enum: ["none", "recommended", "required"],
            },
            steps: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: { type: "string", minLength: 2, maxLength: 120 },
            },
          },
        },
      },
    },
    {
      type: "object",
      additionalProperties: false,
      required: [
        "type",
        "title",
        "summary",
        "ageBand",
        "source",
        "validFrom",
        "expiresAt",
        "riskTags",
        "body",
      ],
      properties: {
        type: { type: "string", const: "knowledge" },
        ...commonDraftProperties,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["topic", "paragraphs"],
          properties: {
            topic: { type: "string", enum: ["general_growth", "emotional_social", "digital_safety", "body_boundaries"] },
            paragraphs: {
              type: "array",
              minItems: 1,
              maxItems: 6,
              items: { type: "string", minLength: 2, maxLength: 400 },
            },
            quiz: {
              type: "object",
              additionalProperties: false,
              required: ["sceneId", "sceneLabel", "scenario", "options", "correctOptionId", "correctTitle", "incorrectTitle", "explanation", "actionSteps"],
              properties: {
                sceneId: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
                sceneLabel: { type: "string", minLength: 2, maxLength: 32 },
                scenario: { type: "string", minLength: 8, maxLength: 240 },
                options: {
                  type: "array", minItems: 3, maxItems: 3,
                  items: {
                    type: "object", additionalProperties: false, required: ["id", "text"],
                    properties: {
                      id: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,23}$" },
                      text: { type: "string", minLength: 4, maxLength: 140 },
                    },
                  },
                },
                correctOptionId: { type: "string", pattern: "^[a-z][a-z0-9_-]{0,23}$" },
                correctTitle: { type: "string", minLength: 4, maxLength: 80 },
                incorrectTitle: { type: "string", minLength: 4, maxLength: 80 },
                explanation: { type: "string", minLength: 8, maxLength: 320 },
                actionSteps: { type: "array", minItems: 1, maxItems: 4, items: { type: "string", minLength: 4, maxLength: 140 } },
              },
            },
          },
        },
      },
    },
  ],
} as const;

const reviewResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["decision", "reviewerId", "reason", "reviewedAt"],
  properties: {
    decision: { type: "string", enum: ["approved", "rejected"] },
    reviewerId: { type: "string", format: "uuid" },
    reason: { type: "string", minLength: 4, maxLength: 400 },
    reviewedAt: { type: "string", format: "date-time" },
  },
} as const;

const contentItemJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: [
    "itemId",
    "type",
    "slug",
    "lifecycleStatus",
    "activeVersionId",
    "createdAt",
    "updatedAt",
    "versions",
  ],
  properties: {
    itemId: { type: "string", format: "uuid" },
    type: { type: "string", enum: ["activity", "knowledge"] },
    slug: { type: "string", pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$" },
    lifecycleStatus: { type: "string", enum: ["draft", "published", "disabled"] },
    activeVersionId: {
      anyOf: [{ type: "string", format: "uuid" }, { type: "null" }],
    },
    createdAt: { type: "string", format: "date-time" },
    updatedAt: { type: "string", format: "date-time" },
    versions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: [
          "versionId",
          "versionNumber",
          "reviewStatus",
          "authorId",
          "createdAt",
          "draft",
          "review",
        ],
        properties: {
          versionId: { type: "string", format: "uuid" },
          versionNumber: { type: "integer", minimum: 1 },
          reviewStatus: {
            type: "string",
            enum: ["draft", "in_review", "approved", "rejected"],
          },
          authorId: { type: "string", format: "uuid" },
          createdAt: { type: "string", format: "date-time" },
          draft: draftJsonSchema,
          review: { anyOf: [reviewResponseJsonSchema, { type: "null" }] },
        },
      },
    },
  },
} as const;

const itemParamsSchema = z.object({ itemId: z.uuid() });
const versionParamsSchema = z.object({ itemId: z.uuid(), versionId: z.uuid() });

function parse<T>(schema: ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new PublicAppError("INVALID_REQUEST", 400);
  return result.data;
}

function readBearerToken(authorization: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
  if (match?.[1] === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
  return match[1];
}

export function registerContentRoutes(app: FastifyInstance, service: ContentService): void {
  app.post<{ Body: ContentCreateItemRequest }>(
    "/api/v1/internal/content/items",
    {
      schema: {
        headers: authorizationHeadersSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "slug", "draft"],
          properties: {
            requestId: requestIdProperty,
            slug: {
              type: "string",
              minLength: 3,
              maxLength: 80,
              pattern: "^[a-z0-9]+(?:-[a-z0-9]+)*$",
            },
            draft: draftJsonSchema,
          },
        },
        response: { 201: contentItemJsonSchema, "4xx": errorSchema },
      },
    },
    async (request, reply) => reply.code(201).send(await service.createItem(
      readBearerToken(request.headers.authorization),
      parse(contentCreateItemRequestSchema, request.body),
    )),
  );

  app.post<{ Body: ContentCreateVersionRequest; Params: { itemId: string } }>(
    "/api/v1/internal/content/items/:itemId/versions",
    {
      schema: {
        headers: authorizationHeadersSchema,
        params: itemParamsJsonSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "draft"],
          properties: { requestId: requestIdProperty, draft: draftJsonSchema },
        },
        response: { 201: contentItemJsonSchema, "4xx": errorSchema },
      },
    },
    async (request, reply) => {
      const params = parse(itemParamsSchema, request.params);
      return reply.code(201).send(await service.createVersion(
        readBearerToken(request.headers.authorization),
        params.itemId,
        parse(contentCreateVersionRequestSchema, request.body),
      ));
    },
  );

  app.post<{ Body: ContentCommandRequest; Params: { itemId: string; versionId: string } }>(
    "/api/v1/internal/content/items/:itemId/versions/:versionId/submission",
    {
      schema: {
        headers: authorizationHeadersSchema,
        params: versionParamsJsonSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId"],
          properties: { requestId: requestIdProperty },
        },
        response: { 200: contentItemJsonSchema, "4xx": errorSchema },
      },
    },
    async (request) => {
      const params = parse(versionParamsSchema, request.params);
      return service.submitVersion(
        readBearerToken(request.headers.authorization),
        params.itemId,
        params.versionId,
        parse(contentCommandRequestSchema, request.body),
      );
    },
  );

  app.post<{ Body: ContentReviewRequest; Params: { itemId: string; versionId: string } }>(
    "/api/v1/internal/content/items/:itemId/versions/:versionId/review",
    {
      schema: {
        headers: authorizationHeadersSchema,
        params: versionParamsJsonSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "decision", "reason"],
          properties: {
            requestId: requestIdProperty,
            decision: { type: "string", enum: ["approved", "rejected"] },
            reason: { type: "string", minLength: 4, maxLength: 400 },
          },
        },
        response: { 200: contentItemJsonSchema, "4xx": errorSchema },
      },
    },
    async (request) => {
      const params = parse(versionParamsSchema, request.params);
      return service.reviewVersion(
        readBearerToken(request.headers.authorization),
        params.itemId,
        params.versionId,
        parse(contentReviewRequestSchema, request.body),
      );
    },
  );

  for (const [path, action] of [
    ["publication", "publishVersion"],
    ["rollback", "rollbackItem"],
  ] as const) {
    app.post<{ Body: ContentVersionSelectionRequest; Params: { itemId: string } }>(
      `/api/v1/internal/content/items/:itemId/${path}`,
      {
        schema: {
          headers: authorizationHeadersSchema,
          params: itemParamsJsonSchema,
          body: {
            type: "object",
            additionalProperties: false,
            required: ["requestId", "versionId"],
            properties: {
              requestId: requestIdProperty,
              versionId: { type: "string", format: "uuid" },
            },
          },
          response: { 200: contentItemJsonSchema, "4xx": errorSchema },
        },
      },
      async (request) => {
        const params = parse(itemParamsSchema, request.params);
        const body = parse(contentVersionSelectionRequestSchema, request.body);
        return service[action](
          readBearerToken(request.headers.authorization),
          params.itemId,
          body,
        );
      },
    );
  }

  app.post<{ Body: ContentDisableRequest; Params: { itemId: string } }>(
    "/api/v1/internal/content/items/:itemId/disable",
    {
      schema: {
        headers: authorizationHeadersSchema,
        params: itemParamsJsonSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "reason"],
          properties: {
            requestId: requestIdProperty,
            reason: { type: "string", minLength: 4, maxLength: 400 },
          },
        },
        response: { 200: contentItemJsonSchema, "4xx": errorSchema },
      },
    },
    async (request) => {
      const params = parse(itemParamsSchema, request.params);
      return service.disableItem(
        readBearerToken(request.headers.authorization),
        params.itemId,
        parse(contentDisableRequestSchema, request.body),
      );
    },
  );

  app.get<{ Params: { itemId: string } }>(
    "/api/v1/internal/content/items/:itemId",
    {
      schema: {
        headers: authorizationHeadersSchema,
        params: itemParamsJsonSchema,
        response: { 200: contentItemJsonSchema, "4xx": errorSchema },
      },
    },
    async (request) => {
      const params = parse(itemParamsSchema, request.params);
      return service.getItem(
        readBearerToken(request.headers.authorization),
        params.itemId,
      );
    },
  );
}
