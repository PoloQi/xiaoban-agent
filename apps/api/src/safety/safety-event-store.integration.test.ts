import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, describe, expect, it } from "vitest";

import type { Transaction } from "kysely";

import type { RiskFusionResult } from "@xiaoban/contracts";

import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import type { DatabaseSchema } from "../database/types.js";
import { hashSecret } from "../identity/service.js";
import { RiskEventStoreError, SafetyEventStore } from "./safety-event-store.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Safety event integration tests are restricted to xiaoban_test.");
}
const database = createDatabase(config);

const classification: RiskFusionResult = {
  decision: "classified",
  level: "L2",
  primaryCategory: "bullying",
  route: "fixed_safety",
  selectedSource: "model",
  disagreement: true,
  modelStatus: "ok",
  rule: { level: "L1", primaryCategory: "persistent_distress" },
  model: { level: "L2", primaryCategory: "bullying" },
  versions: {
    policyVersion: "risk-policy-2026-08-v1",
        rulesVersion: "risk-rules-2026-08-v3",
    classifierVersion: "risk-classifier-deepseek-v3",
    fusionVersion: "risk-fusion-max-v1",
  },
};

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

describe("phase 5D safety event store", () => {
  it("enforces scoped access, idempotency, explicit expiry, and append-only overrides", async () => {
    await inRollback(async (transaction) => {
      const now = new Date("2026-08-20T04:00:00.000Z");
      const officerId = randomUUID();
      const ownerId = randomUUID();
      const otherOwnerId = randomUUID();
      const officerToken = randomBytes(32).toString("base64url");
      const ownerToken = randomBytes(32).toString("base64url");
      const otherOwnerToken = randomBytes(32).toString("base64url");
      await transaction.insertInto("safety_access_grants").values([
        {
          id: randomUUID(), actor_id: officerId, role: "duty_safety_officer",
          token_hash: hashSecret(officerToken), created_at: now, revoked_at: null,
        },
        {
          id: randomUUID(), actor_id: ownerId, role: "event_owner",
          token_hash: hashSecret(ownerToken), created_at: now, revoked_at: null,
        },
        {
          id: randomUUID(), actor_id: otherOwnerId, role: "event_owner",
          token_hash: hashSecret(otherOwnerToken), created_at: now, revoked_at: null,
        },
      ]).execute();

      const store = new SafetyEventStore(transaction, () => now);
      const request = {
        requestId: randomUUID(),
        synthetic: true as const,
        caseReference: "synthetic-risk-l2-integration",
        ownerActorId: ownerId,
        minimalExcerpt: "虚构测试：同学反复威胁公开一张虚构照片。",
        classification,
        retentionUntil: "2026-09-19T04:00:00.000Z",
      };
      const created = await store.createEvent(officerToken, request);
      expect(created).toMatchObject({
        synthetic: true,
        effectiveLevel: "L2",
        effectiveCategory: "bullying",
        ownerActorId: ownerId,
        status: "open",
        overrides: [],
      });
      expect((await store.createEvent(officerToken, request)).id).toBe(created.id);
      await expect(store.createEvent(officerToken, {
        ...request,
        ownerActorId: otherOwnerId,
      })).rejects.toEqual(new RiskEventStoreError("RISK_EVENT_IDEMPOTENCY_CONFLICT"));
      await expect(store.createEvent(officerToken, {
        ...request,
        requestId: randomUUID(),
      })).rejects.toEqual(new RiskEventStoreError("RISK_EVENT_CASE_CONFLICT"));

      await expect(store.readEvent("invalid-token", created.id))
        .rejects.toEqual(new RiskEventStoreError("RISK_EVENT_UNAUTHORIZED"));
      await expect(store.readEvent(otherOwnerToken, created.id))
        .rejects.toEqual(new RiskEventStoreError("RISK_EVENT_FORBIDDEN"));
      expect((await store.readEvent(ownerToken, created.id)).minimalExcerpt)
        .toBe(request.minimalExcerpt);

      const overrideRequest = {
        requestId: randomUUID(),
        level: "L3" as const,
        primaryCategory: "active_danger" as const,
        reasonCode: "immediacy_changed" as const,
        reasonNote: "虚构复核：补充情境表明危险正在发生。",
      };
      const overridden = await store.overrideEvent(ownerToken, created.id, overrideRequest);
      expect(overridden).toMatchObject({
        effectiveLevel: "L3",
        effectiveCategory: "active_danger",
        originalClassification: classification,
      });
      expect(overridden.overrides).toHaveLength(1);
      expect((await store.overrideEvent(ownerToken, created.id, overrideRequest)).overrides)
        .toHaveLength(1);
      await expect(store.overrideEvent(ownerToken, created.id, {
        ...overrideRequest,
        reasonCode: "human_review",
      })).rejects.toEqual(new RiskEventStoreError("RISK_EVENT_IDEMPOTENCY_CONFLICT"));

      const overrideId = overridden.overrides[0]!.id;
      await expect(transaction.updateTable("safety_event_overrides")
        .set({ reason_note: "虚构复核：不允许修改历史。" })
        .where("id", "=", overrideId).execute()).rejects.toThrow();
      await expect(transaction.deleteFrom("safety_event_overrides")
        .where("id", "=", overrideId).execute()).rejects.toThrow();

      await expect(store.createEvent(ownerToken, {
        ...request,
        requestId: randomUUID(),
      })).rejects.toEqual(new RiskEventStoreError("RISK_EVENT_FORBIDDEN"));
      await expect(store.createEvent(officerToken, {
        ...request,
        requestId: randomUUID(),
        retentionUntil: "2027-08-20T04:00:00.000Z",
      })).rejects.toEqual(new RiskEventStoreError("RISK_EVENT_RETENTION_INVALID"));

      const audits = await transaction.selectFrom("audit_entries")
        .select("action").where("target_type", "=", "safety_event")
        .where("target_id", "=", created.id).execute();
      expect(audits.map((item) => item.action)).toEqual(expect.arrayContaining([
        "safety.event.created",
        "safety.event.viewed",
        "safety.event.overridden",
      ]));

      const expiredStore = new SafetyEventStore(
        transaction,
        () => new Date("2026-09-20T04:00:00.000Z"),
      );
      await expect(expiredStore.readEvent(ownerToken, created.id))
        .rejects.toEqual(new RiskEventStoreError("RISK_EVENT_EXPIRED"));
      expect(await expiredStore.purgeExpiredSyntheticEvents()).toBe(1);
      expect(await transaction.selectFrom("safety_events")
        .select("id").where("id", "=", created.id).executeTakeFirst()).toBeUndefined();
      expect(await transaction.selectFrom("safety_event_overrides")
        .select("id").where("event_id", "=", created.id).executeTakeFirst()).toBeUndefined();
      expect(await transaction.selectFrom("audit_entries")
        .select("action").where("target_id", "=", created.id)
        .where("action", "=", "safety.event.retention_purged")
        .executeTakeFirst()).toBeDefined();
    });
  });

  it("does not leave synthetic event data after the rolled-back test", async () => {
    const events = await database.selectFrom("safety_events")
      .select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    const overrides = await database.selectFrom("safety_event_overrides")
      .select(({ fn }) => fn.countAll<number>().as("count")).executeTakeFirstOrThrow();
    expect(Number(events.count)).toBe(0);
    expect(Number(overrides.count)).toBe(0);
  });
});
