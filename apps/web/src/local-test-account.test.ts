import { describe, expect, it } from "vitest";

import {
  createLocalTestAccountSession,
  createLocalTestGuardianSession,
  resumeLocalTestAccountSession,
} from "./local-test-account";

describe("local test account client", () => {
  it("sends the alias and age band before loading the child mode", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; method: string | undefined; body: unknown }> = [];
    const token = "A".repeat(43);

    globalThis.fetch = (async (path, init) => {
      requests.push({
        path: String(path),
        method: init?.method,
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      const response = String(path).endsWith("/session")
        ? {
            schemaVersion: "local-test-account-session-2026-08-v1",
            account: { alias: "小树", ageBand: "9_11", minorMode: true },
            childSessionToken: token,
          }
        : {
            status: "active",
            child: { alias: "小树", ageBand: "9_11", minorMode: true },
            boundaries: {
              aiIdentity: "AI成长助手",
              privacy: "不向监护人展示完整普通聊天",
              help: "遇到困难可以随时找可信任成年人",
            },
          };
      return new Response(JSON.stringify(response), {
        status: String(path).endsWith("/session") ? 201 : 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      const result = await createLocalTestAccountSession({ alias: "小树", ageBand: "9_11" });
      expect(result).toMatchObject({ token, mode: { child: { alias: "小树" } } });
      expect(requests).toEqual([
        {
          path: "/api/v1/dev/test-account/session",
          method: "POST",
          body: { alias: "小树", ageBand: "9_11" },
        },
        {
          path: "/api/v1/child/mode",
          method: "GET",
          body: undefined,
        },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("resumes the synthetic account without overwriting profile fields", async () => {
    const originalFetch = globalThis.fetch;
    const requests: Array<{ path: string; body: unknown }> = [];
    const token = "B".repeat(43);
    globalThis.fetch = (async (path, init) => {
      requests.push({
        path: String(path),
        body: init?.body === undefined ? undefined : JSON.parse(String(init.body)),
      });
      const response = String(path).endsWith("/resume")
        ? {
            schemaVersion: "local-test-account-session-2026-08-v1",
            account: { alias: "小树", ageBand: "9_11", minorMode: true },
            childSessionToken: token,
          }
        : {
            status: "active",
            child: { alias: "小树", ageBand: "9_11", minorMode: true },
            boundaries: {
              aiIdentity: "AI成长助手",
              privacy: "不向监护人展示完整普通聊天",
              help: "遇到困难可以随时找可信任成年人",
            },
          };
      return new Response(JSON.stringify(response), {
        status: String(path).endsWith("/resume") ? 201 : 200,
        headers: { "content-type": "application/json" },
      });
    }) as typeof fetch;

    try {
      await resumeLocalTestAccountSession();
      expect(requests).toEqual([
        { path: "/api/v1/dev/test-account/session/resume", body: {} },
        { path: "/api/v1/child/mode", body: undefined },
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("issues a separate verified guardian session for the adult preview", async () => {
    const originalFetch = globalThis.fetch;
    const token = "G".repeat(43);
    globalThis.fetch = (async (path) => new Response(JSON.stringify({
      schemaVersion: "local-test-guardian-session-2026-09-v1",
      account: {
        alias: "青禾测试监护人",
        relationshipStatus: "verified",
        synthetic: true,
      },
      guardianSessionToken: token,
    }), {
      status: 201,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;

    try {
      await expect(createLocalTestGuardianSession()).resolves.toMatchObject({
        token,
        account: { relationshipStatus: "verified", synthetic: true },
      });
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
