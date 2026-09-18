import { randomUUID } from "node:crypto";

import { sql } from "kysely";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { guardianDashboardResponseSchema } from "@xiaoban/contracts";

import { buildApp } from "../app.js";
import { ChildChatService } from "../chat/child-chat-service.js";
import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "../database/client.js";
import { DataRightsService } from "../datarights/data-rights-service.js";
import {
  LOCAL_TEST_ACCOUNT,
  LocalTestAccountService,
  seedLocalTestAccount,
} from "../identity/local-test-account.js";
import { RiskConsoleService } from "../tickets/risk-console-service.js";
import { GuardianDashboardService } from "./guardian-dashboard-service.js";

// 阶段6退出门槛「成人无法查看普通完整聊天」的阶段级走查（6A.13）：
// 普通聊天不入库；监护人可达的全部端点只能拿到聚合/工单元数据，
// 契约层把 ordinaryChatVisible 锁死为 false。
const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Adult chat privacy walkthrough is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const fixedNow = new Date("2026-09-01T12:00:00.000Z");
const localAccount = new LocalTestAccountService(database);
const app = buildApp({
  childChatService: new ChildChatService(database),
  dataRightsService: new DataRightsService(database),
  guardianDashboardService: new GuardianDashboardService(database, {
    now: () => fixedNow,
    syntheticPreviewGuardianId: LOCAL_TEST_ACCOUNT.guardianId,
  }),
  riskConsoleService: new RiskConsoleService(database),
  probeDatabase: () => assertDatabaseBaseline(database),
});

// 普通聊天里不可能自然出现的探针句；若任何成人响应包含它，即发生聊天正文泄露。
const CHAT_PROBE_TEXT = "Z6A13-PRIVACY-PROBE-隐私探针句9k2x7q";
// 成人响应中禁止出现的聊天载体键名（notifications 是工单通知状态，不在其列）。
const FORBIDDEN_CHAT_KEYS = ["conversation", "transcript", "chatHistory", "chatMessages", "messages"];

function authorization(value: string) {
  return { authorization: `Bearer ${value}` };
}

async function clearSyntheticData(): Promise<void> {
  await database.deleteFrom("growth_attempts").execute();
  // data_rights_request_events 是追加式表（触发器禁直接删除），靠父行 ON DELETE CASCADE 清理。
  await database.deleteFrom("data_rights_requests").execute();
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

beforeAll(async () => app.ready());
beforeEach(async () => {
  await clearSyntheticData();
  await seedLocalTestAccount(database);
});

afterAll(async () => {
  await clearSyntheticData();
  await app.close();
  await database.destroy();
});

describe("adult cannot view ordinary full chat (phase 6 exit gate walkthrough)", () => {
  it("persists no table that could hold ordinary chat turns", async () => {
    const result = await sql<{ name: string }>`
      SELECT table_name AS name
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
    `.execute(database);
    const chatTables = result.rows
      .map((row) => row.name)
      .filter((name) => /(^|_)(chat|chats|conversation|conversations|transcript|message|messages)(_|$)/u.test(name));
    expect(chatTables).toEqual([]);
  });

  it("exposes no chat content or chat container fields on any guardian-reachable surface", async () => {
    const childSession = await localAccount.resumeSession();
    const childChat = await app.inject({
      method: "POST",
      url: "/api/v1/child/chat",
      headers: authorization(childSession.childSessionToken),
      payload: { requestId: randomUUID(), text: CHAT_PROBE_TEXT },
    });
    expect(childChat.statusCode).toBe(200);

    const guardianSession = await localAccount.createGuardianSession();

    const dashboardResponse = await app.inject({
      method: "GET",
      url: "/api/v1/guardian/dashboard",
      headers: authorization(guardianSession.guardianSessionToken),
    });
    expect(dashboardResponse.statusCode).toBe(200);
    const dashboard = guardianDashboardResponseSchema.parse(dashboardResponse.json());
    expect(dashboard.settings.ordinaryChatVisible).toBe(false);
    expect(dashboard.privacy.hiddenDetail).toBe("完整普通聊天");

    const ticketsResponse = await app.inject({
      method: "GET",
      url: "/api/v1/risk-console/tickets",
      headers: authorization(guardianSession.guardianSessionToken),
    });
    expect(ticketsResponse.statusCode).toBe(200);

    const dataRightsResponse = await app.inject({
      method: "POST",
      url: "/api/v1/guardian/data-rights/requests",
      headers: authorization(guardianSession.guardianSessionToken),
      payload: {
        requestId: randomUUID(),
        requestType: "export",
        reasonCode: "privacy_request",
        confirmed: true,
      },
    });
    expect(dataRightsResponse.statusCode).toBe(201);
    // 导出仅排队，响应体是状态白名单，不携带任何可识别原文。
    expect(dataRightsResponse.json()).not.toHaveProperty("export");
    expect(dataRightsResponse.json().queuedForManualProcessing).toBe(true);

    for (const payload of [dashboardResponse.body, ticketsResponse.body, dataRightsResponse.body]) {
      expect(payload).not.toContain(CHAT_PROBE_TEXT);
      for (const key of FORBIDDEN_CHAT_KEYS) {
        expect(payload).not.toContain(`"${key}"`);
      }
    }
  });

  it("rejects a guardian token on the child chat endpoint", async () => {
    const guardianSession = await localAccount.createGuardianSession();
    const forbidden = await app.inject({
      method: "POST",
      url: "/api/v1/child/chat",
      headers: authorization(guardianSession.guardianSessionToken),
      payload: { requestId: randomUUID(), text: CHAT_PROBE_TEXT },
    });
    expect(forbidden.statusCode).toBe(403);
    expect(forbidden.body).not.toContain(CHAT_PROBE_TEXT);
  });
});
