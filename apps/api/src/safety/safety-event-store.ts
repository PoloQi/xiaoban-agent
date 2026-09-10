import { createHash, randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import {
  SAFETY_EVENT_SCHEMA_VERSION,
  riskFusionResultSchema,
  safetyEventCreateRequestSchema,
  safetyEventOverrideRequestSchema,
  safetyEventResponseSchema,
  type RiskFusionResult,
  type SafetyEventActorRole,
  type SafetyEventCreateRequest,
  type SafetyEventOverrideRequest,
  type SafetyEventResponse,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export type RiskEventStoreErrorCode =
  | "RISK_EVENT_INPUT_INVALID"
  | "RISK_EVENT_UNAUTHORIZED"
  | "RISK_EVENT_FORBIDDEN"
  | "RISK_EVENT_NOT_FOUND"
  | "RISK_EVENT_EXPIRED"
  | "RISK_EVENT_RETENTION_INVALID"
  | "RISK_EVENT_OVERRIDE_NO_CHANGE"
  | "RISK_EVENT_CASE_CONFLICT"
  | "RISK_EVENT_IDEMPOTENCY_CONFLICT";

export class RiskEventStoreError extends Error {
  constructor(readonly code: RiskEventStoreErrorCode) {
    super(code);
    this.name = "RiskEventStoreError";
  }
}

interface SafetyPrincipal {
  actorId: string;
  role: SafetyEventActorRole;
}

const MAX_SYNTHETIC_RETENTION_MS = 90 * 24 * 60 * 60 * 1_000;

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function hashCommand(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function parseJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    throw new RiskEventStoreError("RISK_EVENT_INPUT_INVALID");
  }
}

function toIso(value: Date): string {
  return value.toISOString();
}

function isDuplicateEntry(error: unknown): boolean {
  return error !== null
    && typeof error === "object"
    && "code" in error
    && error.code === "ER_DUP_ENTRY";
}

export class SafetyEventStore {
  constructor(
    private readonly database: DatabaseExecutor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async createEvent(
    token: string,
    rawInput: SafetyEventCreateRequest,
  ): Promise<SafetyEventResponse> {
    const input = safetyEventCreateRequestSchema.safeParse(rawInput);
    if (!input.success) throw new RiskEventStoreError("RISK_EVENT_INPUT_INVALID");
    const now = this.now();
    const retentionUntil = new Date(input.data.retentionUntil);
    const retentionMs = retentionUntil.getTime() - now.getTime();
    if (retentionMs <= 0 || retentionMs > MAX_SYNTHETIC_RETENTION_MS) {
      throw new RiskEventStoreError("RISK_EVENT_RETENTION_INVALID");
    }
    const level = input.data.classification.level;
    const category = input.data.classification.primaryCategory;
    if ((level !== "L2" && level !== "L3") || category === null) {
      throw new RiskEventStoreError("RISK_EVENT_INPUT_INVALID");
    }

    return this.inTransaction(async (transaction) => {
      const principal = await this.authenticate(transaction, token);
      if (principal.role !== "duty_safety_officer") {
        throw new RiskEventStoreError("RISK_EVENT_FORBIDDEN");
      }
      const requestHash = hashCommand({ actorId: principal.actorId, input: input.data });
      const existing = await transaction.selectFrom("safety_events")
        .select(["id", "request_hash"])
        .where("request_id", "=", input.data.requestId)
        .executeTakeFirst();
      if (existing !== undefined) {
        if (existing.request_hash !== requestHash) {
          throw new RiskEventStoreError("RISK_EVENT_IDEMPOTENCY_CONFLICT");
        }
        const replayed = await this.readAuthorizedEvent(transaction, principal, existing.id, now);
        await this.writeAudit(transaction, principal, {
          action: "safety.event.create_replayed",
          eventId: existing.id,
          requestId: input.data.requestId,
          metadata: { schemaVersion: SAFETY_EVENT_SCHEMA_VERSION },
          now,
        });
        return replayed;
      }

      const conflictingCase = await transaction.selectFrom("safety_events")
        .select("id").where("case_reference", "=", input.data.caseReference)
        .executeTakeFirst();
      if (conflictingCase !== undefined) {
        throw new RiskEventStoreError("RISK_EVENT_CASE_CONFLICT");
      }

      const id = randomUUID();
      try {
        await transaction.insertInto("safety_events").values({
          id,
          request_id: input.data.requestId,
          request_hash: requestHash,
          synthetic: 1,
          case_reference: input.data.caseReference,
          owner_actor_id: input.data.ownerActorId,
          minimal_excerpt: input.data.minimalExcerpt,
          classification_snapshot: JSON.stringify(input.data.classification),
          detected_level: level,
          detected_category: category,
          effective_level: level,
          effective_category: category,
          status: "open",
          retention_until: retentionUntil,
          created_at: now,
          updated_at: now,
        }).execute();
      } catch (error) {
        if (isDuplicateEntry(error)) {
          throw new RiskEventStoreError("RISK_EVENT_CASE_CONFLICT");
        }
        throw error;
      }
      await this.writeAudit(transaction, principal, {
        action: "safety.event.created",
        eventId: id,
        requestId: input.data.requestId,
        metadata: {
          level,
          category,
          schemaVersion: SAFETY_EVENT_SCHEMA_VERSION,
          retentionUntil: input.data.retentionUntil,
        },
        now,
      });
      return this.readAuthorizedEvent(transaction, principal, id, now);
    });
  }

  async readEvent(token: string, eventId: string): Promise<SafetyEventResponse> {
    if (!/^[0-9a-f-]{36}$/iu.test(eventId)) {
      throw new RiskEventStoreError("RISK_EVENT_INPUT_INVALID");
    }
    return this.inTransaction(async (transaction) => {
      const principal = await this.authenticate(transaction, token);
      const now = this.now();
      const event = await this.readAuthorizedEvent(transaction, principal, eventId, now);
      await this.writeAudit(transaction, principal, {
        action: "safety.event.viewed",
        eventId,
        requestId: randomUUID(),
        metadata: { role: principal.role },
        now,
      });
      return event;
    });
  }

  async overrideEvent(
    token: string,
    eventId: string,
    rawInput: SafetyEventOverrideRequest,
  ): Promise<SafetyEventResponse> {
    const input = safetyEventOverrideRequestSchema.safeParse(rawInput);
    if (!input.success || !/^[0-9a-f-]{36}$/iu.test(eventId)) {
      throw new RiskEventStoreError("RISK_EVENT_INPUT_INVALID");
    }
    const now = this.now();
    return this.inTransaction(async (transaction) => {
      const principal = await this.authenticate(transaction, token);
      const requestHash = hashCommand({
        actorId: principal.actorId,
        eventId,
        input: input.data,
      });
      const existing = await transaction.selectFrom("safety_event_overrides")
        .select(["event_id", "request_hash"])
        .where("request_id", "=", input.data.requestId)
        .executeTakeFirst();
      if (existing !== undefined) {
        if (existing.event_id !== eventId || existing.request_hash !== requestHash) {
          throw new RiskEventStoreError("RISK_EVENT_IDEMPOTENCY_CONFLICT");
        }
        const replayed = await this.readAuthorizedEvent(transaction, principal, eventId, now);
        await this.writeAudit(transaction, principal, {
          action: "safety.event.override_replayed",
          eventId,
          requestId: input.data.requestId,
          metadata: { role: principal.role },
          now,
        });
        return replayed;
      }

      const event = await transaction.selectFrom("safety_events")
        .selectAll().where("id", "=", eventId).forUpdate().executeTakeFirst();
      this.assertEventAccess(principal, event?.owner_actor_id);
      if (event === undefined) throw new RiskEventStoreError("RISK_EVENT_NOT_FOUND");
      if (event.retention_until <= now) {
        throw new RiskEventStoreError("RISK_EVENT_EXPIRED");
      }
      if (
        event.effective_level === input.data.level
        && event.effective_category === input.data.primaryCategory
      ) {
        throw new RiskEventStoreError("RISK_EVENT_OVERRIDE_NO_CHANGE");
      }

      await transaction.insertInto("safety_event_overrides").values({
        id: randomUUID(),
        event_id: eventId,
        request_id: input.data.requestId,
        request_hash: requestHash,
        actor_id: principal.actorId,
        actor_role: principal.role,
        prior_level: event.effective_level,
        prior_category: event.effective_category,
        new_level: input.data.level,
        new_category: input.data.primaryCategory,
        reason_code: input.data.reasonCode,
        reason_note: input.data.reasonNote,
        created_at: now,
      }).execute();
      await transaction.updateTable("safety_events").set({
        effective_level: input.data.level,
        effective_category: input.data.primaryCategory,
        updated_at: now,
      }).where("id", "=", eventId).execute();
      await this.writeAudit(transaction, principal, {
        action: "safety.event.overridden",
        eventId,
        requestId: input.data.requestId,
        metadata: {
          priorLevel: event.effective_level,
          priorCategory: event.effective_category,
          newLevel: input.data.level,
          newCategory: input.data.primaryCategory,
          reasonCode: input.data.reasonCode,
        },
        now,
      });
      return this.readAuthorizedEvent(transaction, principal, eventId, now);
    });
  }

  async purgeExpiredSyntheticEvents(): Promise<number> {
    const now = this.now();
    return this.inTransaction(async (transaction) => {
      const expired = await transaction.selectFrom("safety_events")
        .select("id")
        .where("synthetic", "=", 1)
        .where("retention_until", "<=", now)
        .forUpdate()
        .execute();
      for (const event of expired) {
        await transaction.insertInto("audit_entries").values({
          id: randomUUID(),
          actor_type: "system",
          actor_id: null,
          action: "safety.event.retention_purged",
          target_type: "safety_event",
          target_id: event.id,
          request_id: randomUUID(),
          metadata: JSON.stringify({ schemaVersion: SAFETY_EVENT_SCHEMA_VERSION }),
          created_at: now,
        }).execute();
      }
      if (expired.length > 0) {
        await transaction.deleteFrom("safety_events")
          .where("id", "in", expired.map((event) => event.id))
          .execute();
      }
      return expired.length;
    });
  }

  private async authenticate(
    database: DatabaseExecutor,
    token: string,
  ): Promise<SafetyPrincipal> {
    if (typeof token !== "string" || token.length < 20) {
      throw new RiskEventStoreError("RISK_EVENT_UNAUTHORIZED");
    }
    const grant = await database.selectFrom("safety_access_grants")
      .select(["actor_id", "role"])
      .where("token_hash", "=", hashToken(token))
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    if (grant === undefined) throw new RiskEventStoreError("RISK_EVENT_UNAUTHORIZED");
    return { actorId: grant.actor_id, role: grant.role };
  }

  private assertEventAccess(
    principal: SafetyPrincipal,
    ownerActorId: string | undefined,
  ): void {
    if (ownerActorId === undefined) return;
    if (
      principal.role !== "duty_safety_officer"
      && principal.actorId !== ownerActorId
    ) {
      throw new RiskEventStoreError("RISK_EVENT_FORBIDDEN");
    }
  }

  private async readAuthorizedEvent(
    database: DatabaseExecutor,
    principal: SafetyPrincipal,
    eventId: string,
    now: Date,
  ): Promise<SafetyEventResponse> {
    const event = await database.selectFrom("safety_events")
      .selectAll().where("id", "=", eventId).executeTakeFirst();
    if (event === undefined) throw new RiskEventStoreError("RISK_EVENT_NOT_FOUND");
    this.assertEventAccess(principal, event.owner_actor_id);
    if (event.retention_until <= now) {
      throw new RiskEventStoreError("RISK_EVENT_EXPIRED");
    }
    const classification = riskFusionResultSchema.safeParse(
      parseJson(event.classification_snapshot),
    );
    if (!classification.success) {
      throw new RiskEventStoreError("RISK_EVENT_INPUT_INVALID");
    }
    const overrides = await database.selectFrom("safety_event_overrides")
      .selectAll().where("event_id", "=", eventId)
      .orderBy("created_at", "asc").orderBy("id", "asc").execute();
    return safetyEventResponseSchema.parse({
      id: event.id,
      schemaVersion: SAFETY_EVENT_SCHEMA_VERSION,
      synthetic: true,
      caseReference: event.case_reference,
      ownerActorId: event.owner_actor_id,
      minimalExcerpt: event.minimal_excerpt,
      originalClassification: classification.data,
      effectiveLevel: event.effective_level,
      effectiveCategory: event.effective_category,
      status: event.status,
      retentionUntil: toIso(event.retention_until),
      createdAt: toIso(event.created_at),
      updatedAt: toIso(event.updated_at),
      overrides: overrides.map((item) => ({
        id: item.id,
        priorLevel: item.prior_level,
        priorCategory: item.prior_category,
        newLevel: item.new_level,
        newCategory: item.new_category,
        actorId: item.actor_id,
        actorRole: item.actor_role,
        reasonCode: item.reason_code,
        reasonNote: item.reason_note,
        createdAt: toIso(item.created_at),
      })),
    });
  }

  private async writeAudit(
    database: DatabaseExecutor,
    principal: SafetyPrincipal,
    input: {
      action: string;
      eventId: string;
      requestId: string;
      metadata: Record<string, unknown>;
      now: Date;
    },
  ): Promise<void> {
    await database.insertInto("audit_entries").values({
      id: randomUUID(),
      actor_type: "safety_operator",
      actor_id: principal.actorId,
      action: input.action,
      target_type: "safety_event",
      target_id: input.eventId,
      request_id: input.requestId,
      metadata: JSON.stringify(input.metadata),
      created_at: input.now,
    }).execute();
  }

  private async inTransaction<T>(
    run: (transaction: Transaction<DatabaseSchema>) => Promise<T>,
  ): Promise<T> {
    if (this.database.isTransaction) {
      return run(this.database as Transaction<DatabaseSchema>);
    }
    return this.database.transaction().execute(run);
  }
}
