import type { FastifyInstance } from "fastify";

import type { LocalTestAccountSessionRequest } from "@xiaoban/contracts/local-test-account";

import type { LocalTestAccountSessionIssuer } from "./local-test-account.js";

const localTestAccountSessionBodySchema = {
  type: "object",
  additionalProperties: false,
  required: ["alias", "ageBand"],
  properties: {
    alias: { type: "string", minLength: 2, maxLength: 20 },
    ageBand: { type: "string", enum: ["9_11", "12_14"] },
  },
} as const;

const localTestAccountSessionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "account", "childSessionToken"],
  properties: {
    schemaVersion: {
      type: "string",
      const: "local-test-account-session-2026-08-v1",
    },
    account: {
      type: "object",
      additionalProperties: false,
      required: ["alias", "ageBand", "minorMode"],
      properties: {
        alias: { type: "string", minLength: 2, maxLength: 20 },
        ageBand: { type: "string", enum: ["9_11", "12_14"] },
        minorMode: { type: "boolean", const: true },
      },
    },
    childSessionToken: {
      type: "string",
      minLength: 43,
      maxLength: 43,
      pattern: "^[A-Za-z0-9_-]+$",
    },
  },
} as const;

const localTestGuardianSessionSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "account", "guardianSessionToken"],
  properties: {
    schemaVersion: { type: "string", const: "local-test-guardian-session-2026-09-v1" },
    account: {
      type: "object",
      additionalProperties: false,
      required: ["alias", "relationshipStatus", "synthetic"],
      properties: {
        alias: { type: "string", minLength: 2, maxLength: 20 },
        relationshipStatus: { type: "string", const: "verified" },
        synthetic: { type: "boolean", const: true },
      },
    },
    guardianSessionToken: {
      type: "string",
      minLength: 43,
      maxLength: 43,
      pattern: "^[A-Za-z0-9_-]+$",
    },
  },
} as const;

export function registerLocalTestAccountRoutes(
  app: FastifyInstance,
  service: LocalTestAccountSessionIssuer,
): void {
  app.post(
    "/api/v1/dev/test-account/session",
    {
      schema: {
        body: localTestAccountSessionBodySchema,
        response: { 201: localTestAccountSessionSchema },
      },
    },
    async (request, reply) => {
      const body = request.body as LocalTestAccountSessionRequest;
      return reply.code(201).send(await service.createSession(body));
    },
  );

  app.post(
    "/api/v1/dev/test-account/session/resume",
    {
      schema: {
        response: { 201: localTestAccountSessionSchema },
      },
    },
    async (_request, reply) => reply.code(201).send(await service.resumeSession()),
  );

  app.post(
    "/api/v1/dev/test-account/guardian-session",
    {
      schema: { response: { 201: localTestGuardianSessionSchema } },
    },
    async (_request, reply) => reply.code(201).send(await service.createGuardianSession()),
  );
}
