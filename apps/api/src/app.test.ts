import { afterEach, describe, expect, it } from "vitest";

import {
  errorResponseSchema,
  healthResponseSchema,
  readinessResponseSchema,
} from "@xiaoban/contracts";
import {
  localTestAccountSessionResponseSchema,
  localTestGuardianSessionResponseSchema,
} from "@xiaoban/contracts/local-test-account";

import { buildApp } from "./app.js";

const openApps: ReturnType<typeof buildApp>[] = [];

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

describe("GET /api/v1/readiness", () => {
  it("returns ready only after the database probe succeeds", async () => {
    const app = buildApp({ probeDatabase: async () => undefined });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1/readiness" });

    expect(response.statusCode).toBe(200);
    expect(readinessResponseSchema.safeParse(response.json()).success).toBe(true);
  });

  it("returns a public 503 without dependency details", async () => {
    const privateMarker = "private-database-diagnostic";
    const app = buildApp({
      probeDatabase: async () => {
        throw new Error(privateMarker);
      },
    });
    openApps.push(app);

    const response = await app.inject({ method: "GET", url: "/api/v1/readiness" });

    expect(response.statusCode).toBe(503);
    expect(errorResponseSchema.safeParse(response.json()).success).toBe(true);
    expect(response.json().error.code).toBe("DEPENDENCY_UNAVAILABLE");
    expect(response.body).not.toContain(privateMarker);
  });
});

describe("GET /api/v1/health", () => {
  it("returns a response matching the shared contract", async () => {
    const app = buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/health",
    });

    expect(response.statusCode).toBe(200);
    expect(healthResponseSchema.safeParse(response.json()).success).toBe(true);
    expect(response.headers["x-request-id"]).toBeTypeOf("string");
  });
});

describe("public error responses", () => {
  it("returns the shared contract for an unknown route", async () => {
    const app = buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/does-not-exist",
    });
    const body = response.json();

    expect(response.statusCode).toBe(404);
    expect(errorResponseSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe("ROUTE_NOT_FOUND");
    expect(body.error.requestId).toBe(response.headers["x-request-id"]);
  });

  it("normalizes request validation errors", async () => {
    const app = buildApp();
    openApps.push(app);
    app.post(
      "/api/v1/test-only-validation",
      {
        schema: {
          body: {
            type: "object",
            additionalProperties: false,
            required: ["name"],
            properties: { name: { type: "string", minLength: 1 } },
          },
        },
      },
      async () => ({ ok: true }),
    );

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/test-only-validation",
      payload: {},
    });
    const body = response.json();

    expect(response.statusCode).toBe(400);
    expect(errorResponseSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe("INVALID_REQUEST");
  });

  it("does not expose an internal exception message", async () => {
    const privateMarker = "private-diagnostic-marker";
    const app = buildApp();
    openApps.push(app);
    app.get("/api/v1/test-only-error", async () => {
      throw new Error(privateMarker);
    });

    const response = await app.inject({
      method: "GET",
      url: "/api/v1/test-only-error",
    });
    const body = response.json();

    expect(response.statusCode).toBe(500);
    expect(errorResponseSchema.safeParse(body).success).toBe(true);
    expect(body.error.code).toBe("INTERNAL_ERROR");
    expect(response.body).not.toContain(privateMarker);
  });
});

describe("local test account route registration", () => {
  it("is absent unless a development-only issuer is explicitly provided", async () => {
    const app = buildApp();
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/dev/test-account/session",
    });

    expect(response.statusCode).toBe(404);
  });

  it("returns a versioned synthetic session when explicitly enabled", async () => {
    const app = buildApp({
      localTestAccountService: {
        createSession: async (input) => ({
          schemaVersion: "local-test-account-session-2026-08-v1",
          account: { alias: input.alias, ageBand: input.ageBand, minorMode: true },
          childSessionToken: "d".repeat(43),
        }),
        createGuardianSession: async () => ({
          schemaVersion: "local-test-guardian-session-2026-09-v1",
          account: {
            alias: "青禾测试监护人",
            relationshipStatus: "verified",
            synthetic: true,
          },
          guardianSessionToken: "g".repeat(43),
        }),
        resumeSession: async () => ({
          schemaVersion: "local-test-account-session-2026-08-v1",
          account: { alias: "小树", ageBand: "9_11", minorMode: true },
          childSessionToken: "e".repeat(43),
        }),
      },
    });
    openApps.push(app);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/dev/test-account/session",
      payload: { alias: "小树", ageBand: "9_11" },
    });

    expect(response.statusCode).toBe(201);
    expect(localTestAccountSessionResponseSchema.safeParse(response.json()).success).toBe(true);

    const resumed = await app.inject({
      method: "POST",
      url: "/api/v1/dev/test-account/session/resume",
    });
    expect(resumed.statusCode).toBe(201);
    expect(localTestAccountSessionResponseSchema.safeParse(resumed.json()).success).toBe(true);

    const guardian = await app.inject({
      method: "POST",
      url: "/api/v1/dev/test-account/guardian-session",
    });
    expect(guardian.statusCode).toBe(201);
    expect(localTestGuardianSessionResponseSchema.safeParse(guardian.json()).success).toBe(true);
  });
});
