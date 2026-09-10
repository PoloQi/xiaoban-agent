import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";
import type { Transaction } from "kysely";

import { GENERATION_STOP_FIXED_REPLY } from "@xiaoban/contracts";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import type { DatabaseSchema } from "../database/types.js";
import { hashSecret } from "../identity/service.js";
import {
  GenerationControlStore,
  GenerationControlStoreError,
  evaluateGenerationGate,
} from "./generation-control-store.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Generation control integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);

class RollbackTestTransaction extends Error {}

async function inRollback(
  run: (transaction: Transaction<DatabaseSchema>) => Promise<void>,
): Promise<void> {
  try {
    await database.transaction().execute(async (transaction) => {
      await run(transaction);
      throw new RollbackTestTransaction();
    });
  } catch (error) {
    if (!(error instanceof RollbackTestTransaction)) throw error;
  }
}

afterAll(async () => {
  await database.destroy();
});

describe("phase 5E persisted generation control", () => {
  it("starts stopped and fails closed when the control cannot be read", async () => {
    await inRollback(async (transaction) => {
      const store = new GenerationControlStore(transaction);
      expect(await store.read()).toMatchObject({
        scope: "global",
        state: "stopped",
        reasonCode: "initial_safety_default",
        version: 1,
      });
      expect(await store.evaluateGate()).toMatchObject({
        decision: "stop",
        state: "stopped",
        source: "persisted",
        fixedReply: GENERATION_STOP_FIXED_REPLY,
      });
    });

    await expect(evaluateGenerationGate(async () => {
      throw new Error("synthetic database outage");
    })).resolves.toEqual({
      decision: "stop",
      state: "unknown",
      source: "fail_closed",
      reasonCode: "control_unavailable",
      controlVersion: null,
      schemaVersion: null,
      fixedReply: GENERATION_STOP_FIXED_REPLY,
    });
  });

  it("allows only a duty safety officer to change state and preserves history", async () => {
    await inRollback(async (transaction) => {
      const now = new Date("2026-08-20T05:00:00.000Z");
      const officerId = randomUUID();
      const ownerId = randomUUID();
      const officerToken = randomBytes(32).toString("base64url");
      const ownerToken = randomBytes(32).toString("base64url");
      await transaction.insertInto("safety_access_grants").values([
        {
          id: randomUUID(), actor_id: officerId, role: "duty_safety_officer",
          token_hash: hashSecret(officerToken), created_at: now, revoked_at: null,
        },
        {
          id: randomUUID(), actor_id: ownerId, role: "event_owner",
          token_hash: hashSecret(ownerToken), created_at: now, revoked_at: null,
        },
      ]).execute();

      const store = new GenerationControlStore(transaction, () => now);
      const request = {
        requestId: randomUUID(),
        targetState: "running" as const,
        reasonCode: "manual_resume" as const,
        reasonNote: "虚构演练：阶段五安全门禁验证通过后恢复。",
      };
      await expect(store.change(ownerToken, request))
        .rejects.toEqual(new GenerationControlStoreError("GENERATION_CONTROL_FORBIDDEN"));

      const running = await store.change(officerToken, request);
      expect(running).toMatchObject({ state: "running", version: 2, updatedBy: officerId });
      expect(running).not.toHaveProperty("reasonNote");
      expect(await store.change(officerToken, request)).toEqual(running);
      expect(await store.evaluateGate()).toMatchObject({
        decision: "allow",
        state: "running",
        source: "persisted",
        controlVersion: 2,
      });
      await expect(store.change(officerToken, {
        ...request,
        targetState: "stopped",
        reasonCode: "manual_safety_stop",
      })).rejects.toEqual(
        new GenerationControlStoreError("GENERATION_CONTROL_IDEMPOTENCY_CONFLICT"),
      );

      const change = await transaction.selectFrom("generation_control_changes")
        .selectAll().where("request_id", "=", request.requestId).executeTakeFirstOrThrow();
      await expect(transaction.updateTable("generation_control_changes")
        .set({ reason_note: "虚构演练：不允许修改历史。" })
        .where("id", "=", change.id).execute()).rejects.toThrow();
      await expect(transaction.deleteFrom("generation_control_changes")
        .where("id", "=", change.id).execute()).rejects.toThrow();

      const audit = await transaction.selectFrom("audit_entries")
        .select(["action", "metadata"])
        .where("target_type", "=", "generation_control")
        .where("request_id", "=", request.requestId)
        .executeTakeFirstOrThrow();
      expect(audit.action).toBe("generation.control.changed");
      expect(JSON.stringify(audit.metadata)).not.toContain(request.reasonNote);
    });
  });
});
