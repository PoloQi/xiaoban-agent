import type { FastifyInstance } from "fastify";
import type { ZodType } from "zod";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
  childActivationRequestSchema,
  consentWithdrawalRequestSchema,
  guardianConfirmationRequestSchema,
  invitationPreviewRequestSchema,
  type ChildActivationRequest,
  type ConsentWithdrawalRequest,
  type GuardianConfirmationRequest,
  type InvitationPreviewRequest,
} from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { EnrollmentService } from "./service.js";

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

const childSchema = {
  type: "object",
  additionalProperties: false,
  required: ["alias", "ageBand", "minorMode"],
  properties: {
    alias: { type: "string" },
    ageBand: { type: "string", enum: ["9_11", "12_14"] },
    minorMode: { type: "boolean", const: true },
  },
} as const;

const guardianChildSchema = {
  type: "object",
  additionalProperties: false,
  required: ["alias", "ageBand", "minorMode", "status"],
  properties: {
    ...childSchema.properties,
    status: { type: "string", enum: ["active", "deactivated"] },
  },
} as const;

const authorizationHeadersSchema = {
  type: "object",
  required: ["authorization"],
  properties: {
    authorization: { type: "string", minLength: 50, maxLength: 50 },
  },
} as const;

function parseBody<T>(schema: ZodType<T>, body: unknown): T {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new PublicAppError("INVALID_REQUEST", 400);
  }
  return result.data;
}

function readBearerToken(authorization: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
  if (match?.[1] === undefined) {
    throw new PublicAppError("UNAUTHORIZED", 401);
  }
  return match[1];
}

export function registerEnrollmentRoutes(
  app: FastifyInstance,
  service: EnrollmentService,
): void {
  app.post<{ Body: InvitationPreviewRequest }>(
    "/api/v1/enrollments/preview",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: ["invitationCode"],
          properties: { invitationCode: { type: "string", minLength: 8, maxLength: 128 } },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["invitation", "policy"],
            properties: {
              invitation: {
                type: "object",
                additionalProperties: false,
                required: ["siteName", "batchName", "expiresAt", "verificationMethod"],
                properties: {
                  siteName: { type: "string" },
                  batchName: { type: "string" },
                  expiresAt: { type: "string", format: "date-time" },
                  verificationMethod: {
                    type: "string",
                    const: "controlled_site_invite",
                  },
                },
              },
              policy: {
                type: "object",
                additionalProperties: false,
                required: ["version", "summary"],
                properties: {
                  version: { type: "string", const: GUARDIAN_CONSENT_VERSION },
                  summary: {
                    type: "array",
                    minItems: 3,
                    maxItems: 6,
                    items: { type: "string" },
                  },
                },
              },
            },
          },
          "4xx": errorSchema,
        },
      },
    },
    async (request) => {
      const body = parseBody(invitationPreviewRequestSchema, request.body);
      return service.previewInvitation(body.invitationCode);
    },
  );

  app.post<{ Body: GuardianConfirmationRequest }>(
    "/api/v1/enrollments/guardian-confirmation",
    {
      schema: {
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "requestId",
            "invitationCode",
            "guardianAlias",
            "policyVersion",
            "consentAccepted",
            "guardianSessionToken",
          ],
          properties: {
            requestId: { type: "string", format: "uuid" },
            invitationCode: { type: "string", minLength: 8, maxLength: 128 },
            guardianAlias: { type: "string", minLength: 2, maxLength: 20 },
            policyVersion: { type: "string", const: GUARDIAN_CONSENT_VERSION },
            consentAccepted: { type: "boolean" },
            guardianSessionToken: {
              type: "string",
              minLength: 43,
              maxLength: 43,
              pattern: "^[A-Za-z0-9_-]+$",
            },
          },
        },
        response: {
          201: {
            type: "object",
            additionalProperties: false,
            required: ["enrollmentId", "status", "policyVersion", "nextAction"],
            properties: {
              enrollmentId: { type: "string", format: "uuid" },
              status: { type: "string", const: "guardian_confirmed" },
              policyVersion: { type: "string", const: GUARDIAN_CONSENT_VERSION },
              nextAction: { type: "string", const: "child_notice" },
            },
          },
          "4xx": errorSchema,
        },
      },
    },
    async (request, reply) => {
      const body = parseBody(guardianConfirmationRequestSchema, request.body);
      return reply.code(201).send(await service.confirmGuardian(body));
    },
  );

  app.post<{ Body: ChildActivationRequest }>(
    "/api/v1/enrollments/child-activation",
    {
      schema: {
        headers: authorizationHeadersSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: [
            "requestId",
            "childAlias",
            "ageBand",
            "childNoticeVersion",
            "noticeAccepted",
            "childSessionToken",
          ],
          properties: {
            requestId: { type: "string", format: "uuid" },
            childAlias: { type: "string", minLength: 2, maxLength: 20 },
            ageBand: { type: "string", enum: ["9_11", "12_14"] },
            childNoticeVersion: { type: "string", const: CHILD_NOTICE_VERSION },
            noticeAccepted: { type: "boolean" },
            childSessionToken: {
              type: "string",
              minLength: 43,
              maxLength: 43,
              pattern: "^[A-Za-z0-9_-]+$",
            },
          },
        },
        response: {
          201: {
            type: "object",
            additionalProperties: false,
            required: ["enrollmentId", "status", "child", "childNoticeVersion"],
            properties: {
              enrollmentId: { type: "string", format: "uuid" },
              status: { type: "string", const: "active" },
              child: childSchema,
              childNoticeVersion: { type: "string", const: CHILD_NOTICE_VERSION },
            },
          },
          "4xx": errorSchema,
        },
      },
    },
    async (request, reply) => {
      const token = readBearerToken(request.headers.authorization);
      const body = parseBody(childActivationRequestSchema, request.body);
      return reply.code(201).send(await service.activateChild(token, body));
    },
  );

  app.get(
    "/api/v1/guardian/enrollment",
    {
      schema: {
        headers: authorizationHeadersSchema,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["enrollmentId", "status", "consent", "child"],
            properties: {
              enrollmentId: { type: "string", format: "uuid" },
              status: {
                type: "string",
                enum: ["guardian_confirmed", "active", "withdrawn"],
              },
              consent: {
                type: "object",
                additionalProperties: false,
                required: ["status", "policyVersion", "grantedAt", "withdrawnAt"],
                properties: {
                  status: { type: "string", enum: ["active", "withdrawn"] },
                  policyVersion: { type: "string", const: GUARDIAN_CONSENT_VERSION },
                  grantedAt: { type: "string", format: "date-time" },
                  withdrawnAt: {
                    anyOf: [
                      { type: "string", format: "date-time" },
                      { type: "null" },
                    ],
                  },
                },
              },
              child: { anyOf: [guardianChildSchema, { type: "null" }] },
            },
          },
          "4xx": errorSchema,
        },
      },
    },
    async (request) =>
      service.getGuardianEnrollment(readBearerToken(request.headers.authorization)),
  );

  app.post<{ Body: ConsentWithdrawalRequest }>(
    "/api/v1/guardian/consent/withdrawal",
    {
      schema: {
        headers: authorizationHeadersSchema,
        body: {
          type: "object",
          additionalProperties: false,
          required: ["requestId", "reasonCode", "confirmed"],
          properties: {
            requestId: { type: "string", format: "uuid" },
            reasonCode: {
              type: "string",
              enum: ["guardian_choice", "pilot_exit", "privacy_request"],
            },
            confirmed: { type: "boolean" },
          },
        },
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["status", "childStatus", "effectiveAt"],
            properties: {
              status: { type: "string", const: "withdrawn" },
              childStatus: { type: "string", const: "deactivated" },
              effectiveAt: { type: "string", format: "date-time" },
            },
          },
          "4xx": errorSchema,
        },
      },
    },
    async (request) => {
      const token = readBearerToken(request.headers.authorization);
      const body = parseBody(consentWithdrawalRequestSchema, request.body);
      return service.withdrawConsent(token, body);
    },
  );

  app.get(
    "/api/v1/child/mode",
    {
      schema: {
        headers: authorizationHeadersSchema,
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["status", "child", "boundaries"],
            properties: {
              status: { type: "string", const: "active" },
              child: childSchema,
              boundaries: {
                type: "object",
                additionalProperties: false,
                required: ["aiIdentity", "privacy", "help"],
                properties: {
                  aiIdentity: { type: "string", const: "AI成长助手" },
                  privacy: {
                    type: "string",
                    const: "不向监护人展示完整普通聊天",
                  },
                  help: {
                    type: "string",
                    const: "遇到困难可以随时找可信任成年人",
                  },
                },
              },
            },
          },
          "4xx": errorSchema,
        },
      },
    },
    async (request) => service.getChildMode(readBearerToken(request.headers.authorization)),
  );
}
