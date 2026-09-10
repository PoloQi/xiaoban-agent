import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
  childChatResponseSchema,
  errorResponseSchema,
  type InternalAiOrchestrationRequest,
} from "@xiaoban/contracts";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "../database/client.js";
import { EnrollmentService, hashSecret } from "../identity/service.js";
import { ChildChatService, type ChildChatRunner } from "./child-chat-service.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Child chat cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const enrollmentService = new EnrollmentService(database);

function token(): string {
  return randomBytes(32).toString("base64url");
}

function authorization(value: string) {
  return { authorization: `Bearer ${value}` };
}

async function clearSyntheticData(): Promise<void> {
  for (const table of [
    "audit_entries",
    "access_sessions",
    "guardian_child_links",
    "guardian_consents",
    "enrollments",
    "child_accounts",
    "guardian_accounts",
    "pilot_invitations",
    "sites",
  ] as const) {
    await database.deleteFrom(table).execute();
  }
}

async function createChild(ageBand: "9_11" | "12_14") {
  const invitationCode = `SYNTHETIC-${randomUUID()}`;
  const siteId = randomUUID();
  const now = new Date();
  await database.insertInto("sites").values({
    id: siteId,
    display_name: "青禾聊天测试站（虚构）",
    status: "active",
    created_at: now,
  }).execute();
  await database.insertInto("pilot_invitations").values({
    id: randomUUID(),
    site_id: siteId,
    batch_name: "合成聊天测试批次",
    code_hash: hashSecret(invitationCode),
    status: "active",
    expires_at: new Date("2027-08-18T00:00:00.000Z"),
    created_at: now,
    updated_at: now,
  }).execute();

  const guardianToken = token();
  const childToken = token();
  await enrollmentService.confirmGuardian({
    requestId: randomUUID(),
    invitationCode,
    guardianAlias: "青禾阿姨",
    policyVersion: GUARDIAN_CONSENT_VERSION,
    consentAccepted: true,
    guardianSessionToken: guardianToken,
  });
  await enrollmentService.activateChild(guardianToken, {
    requestId: randomUUID(),
    childAlias: "小山雀",
    ageBand,
    childNoticeVersion: CHILD_NOTICE_VERSION,
    noticeAccepted: true,
    childSessionToken: childToken,
  });
  const child = await database.selectFrom("child_accounts")
    .select("id")
    .executeTakeFirstOrThrow();
  return { childId: child.id, childToken, guardianToken };
}

const internalTrace = {
  pipelineVersion: "internal-ai-pipeline-v1",
  generationControl: {
    state: "running",
    source: "persisted",
    reasonCode: "manual_resume",
    controlVersion: 2,
    schemaVersion: "generation-control-2026-08-v1",
  },
  inputPolicyVersion: "input-deidentification-2026-08-v1",
  retrievalPolicyVersion: "reviewed-content-retrieval-v1",
  outputPolicyVersion: "output-safety-2026-08-v1",
  promptVersion: "internal-companion-v1",
  model: {
    provider: "deepseek",
    model: "deepseek-v4-pro",
    promptVersion: "internal-companion-v1",
    outputSchemaVersion: "internal-ai-candidate-v1",
    durationMs: 120,
    usage: { inputTokens: 20, outputTokens: 18, totalTokens: 38 },
  },
} as const;

const approvedResult = {
  status: "approved",
  intent: "general_support",
  reply: "你好呀，我在呢。",
  contentSlugs: [],
  trace: internalTrace,
} as const;

const fallbackResult = {
  status: "static_fallback",
  reply: "我现在不能安全生成新的回答，可以稍后再试。",
  contentSlugs: [],
  reasonCode: "output_rejected",
  trace: internalTrace,
} as const;

const openApps: ReturnType<typeof buildApp>[] = [];

function buildChatApp(runner?: ChildChatRunner) {
  const app = buildApp({
    childChatService: new ChildChatService(database, runner),
    probeDatabase: () => assertDatabaseBaseline(database),
  });
  openApps.push(app);
  return app;
}

beforeEach(clearSyntheticData);

afterEach(async () => {
  await Promise.all(openApps.splice(0).map((app) => app.close()));
});

afterAll(async () => {
  await clearSyntheticData();
  await database.destroy();
});

describe("POST /api/v1/child/chat", () => {
  it("authenticates the child, derives the age band, and returns the model reply", async () => {
    const { childToken } = await createChild("12_14");
    let captured: InternalAiOrchestrationRequest | undefined;
    const app = buildChatApp(async (input) => {
      captured = input;
      return approvedResult;
    });

    const requestId = randomUUID();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/child/chat",
      headers: authorization(childToken),
      payload: {
        requestId,
        text: "我今天有点不开心。",
        history: [{ role: "child", text: "你好" }, { role: "assistant", text: "嗨，我在呀。" }],
      },
    });

    expect(response.statusCode).toBe(200);
    const parsed = childChatResponseSchema.parse(response.json());
    expect(parsed.route).toBe("reply");
    if (parsed.route !== "reply") throw new Error("expected reply route");
    expect(parsed.reply).toBe("你好呀，我在呢。");
    expect(captured).toEqual({
      requestId,
      text: "我今天有点不开心。",
      ageBand: "12_14",
      contentType: "knowledge",
      history: [{ role: "child", text: "你好" }, { role: "assistant", text: "嗨，我在呀。" }],
    });
    expect(JSON.stringify(response.body)).not.toContain("usage");
    expect(JSON.stringify(response.body)).not.toContain("trace");
  });

  it("collapses a static fallback into a single safe reply", async () => {
    const { childToken } = await createChild("9_11");
    const app = buildChatApp(async () => fallbackResult);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/child/chat",
      headers: authorization(childToken),
      payload: { requestId: randomUUID(), text: "想听个故事。" },
    });

    expect(response.statusCode).toBe(200);
    const parsed = childChatResponseSchema.parse(response.json());
    expect(parsed.route).toBe("reply");
    if (parsed.route !== "reply") throw new Error("expected reply route");
    expect(parsed.reply).toBe(
      "我现在不能安全生成新的回答，可以稍后再试。",
    );
  });

  it("stops generation and returns fixed safety actions for an L2 input", async () => {
    const { childToken } = await createChild("9_11");
    let runnerCalls = 0;
    const app = buildChatApp(async () => {
      runnerCalls += 1;
      return approvedResult;
    });

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/child/chat",
      headers: authorization(childToken),
      payload: {
        requestId: randomUUID(),
        text: "虚构测试：陌生人要我发家庭住址和验证码。",
      },
    });

    expect(response.statusCode).toBe(200);
    const parsed = childChatResponseSchema.parse(response.json());
    expect(parsed).toMatchObject({
      route: "fixed_safety",
      level: "L2",
      title: "停止联系和发送",
      notificationStatus: "not_sent",
    });
    expect(runnerCalls).toBe(0);
    expect(JSON.stringify(parsed)).not.toMatch(/matchedRuleIds|primaryCategory|eventRequired/u);
  });

  it("returns a safe fallback when no internal runner is connected", async () => {
    const { childToken } = await createChild("9_11");
    const app = buildChatApp();

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/child/chat",
      headers: authorization(childToken),
      payload: { requestId: randomUUID(), text: "你好。" },
    });

    expect(response.statusCode).toBe(200);
    expect(childChatResponseSchema.safeParse(response.json()).success).toBe(true);
    expect(response.body).not.toContain("error");
  });

  it("rejects a guardian token and a deactivated child", async () => {
    const { childId, childToken, guardianToken } = await createChild("9_11");
    const app = buildChatApp(async () => approvedResult);

    const guardian = await app.inject({
      method: "POST",
      url: "/api/v1/child/chat",
      headers: authorization(guardianToken),
      payload: { requestId: randomUUID(), text: "你好。" },
    });
    expect(guardian.statusCode).toBe(403);
    expect(errorResponseSchema.parse(guardian.json()).error.code).toBe("FORBIDDEN");

    await database.updateTable("child_accounts").set({ status: "deactivated" })
      .where("id", "=", childId).execute();
    const deactivated = await app.inject({
      method: "POST",
      url: "/api/v1/child/chat",
      headers: authorization(childToken),
      payload: { requestId: randomUUID(), text: "你好。" },
    });
    expect(deactivated.statusCode).toBe(403);
    expect(errorResponseSchema.parse(deactivated.json()).error.code).toBe(
      "ACCOUNT_DEACTIVATED",
    );
  });

  it("rejects a malformed token", async () => {
    const app = buildChatApp(async () => approvedResult);

    const response = await app.inject({
      method: "POST",
      url: "/api/v1/child/chat",
      headers: authorization("not-a-valid-token"),
      payload: { requestId: randomUUID(), text: "你好。" },
    });

    expect(response.statusCode).toBe(401);
    expect(errorResponseSchema.parse(response.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("rejects invalid request bodies before reaching the service", async () => {
    const { childToken } = await createChild("9_11");
    let calls = 0;
    const app = buildChatApp(async () => {
      calls += 1;
      return approvedResult;
    });

    for (const payload of [
      { requestId: randomUUID() },
      { requestId: randomUUID(), text: "a".repeat(701) },
      { requestId: randomUUID(), text: "你好。", history: new Array(9).fill({ role: "child", text: "x" }) },
    ]) {
      const response = await app.inject({
        method: "POST",
        url: "/api/v1/child/chat",
        headers: authorization(childToken),
        payload,
      });
      expect(response.statusCode).toBe(400);
      expect(errorResponseSchema.parse(response.json()).error.code).toBe("INVALID_REQUEST");
    }

    expect(calls).toBe(0);
  });
});
