import { createHash, randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import {
  GENERATION_CONTROL_SCHEMA_VERSION,
  GENERATION_STOP_FIXED_REPLY,
  generationControlChangeRequestSchema,
  generationControlResponseSchema,
  generationGateDecisionSchema,
  type GenerationControlChangeRequest,
  type GenerationControlResponse,
  type GenerationGateDecision,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

export type GenerationControlStoreErrorCode =
  | "GENERATION_CONTROL_INPUT_INVALID"
  | "GENERATION_CONTROL_UNAUTHORIZED"
  | "GENERATION_CONTROL_FORBIDDEN"
  | "GENERATION_CONTROL_NOT_FOUND"
  | "GENERATION_CONTROL_NO_CHANGE"
  | "GENERATION_CONTROL_IDEMPOTENCY_CONFLICT";

export class GenerationControlStoreError extends Error {
  constructor(readonly code: GenerationControlStoreErrorCode) {
    super(code);
    this.name = "GenerationControlStoreError";
  }
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function hashCommand(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value), "utf8").digest("hex");
}

function toResponse(row: {
  state: GenerationControlResponse["state"];
  reason_code: GenerationControlResponse["reasonCode"];
  version: number;
  updated_by: string | null;
  updated_at: Date;
}): GenerationControlResponse {
  return generationControlResponseSchema.parse({
    scope: "global",
    state: row.state,
    reasonCode: row.reason_code,
    version: row.version,
    updatedBy: row.updated_by,
    updatedAt: row.updated_at.toISOString(),
    schemaVersion: GENERATION_CONTROL_SCHEMA_VERSION,
  });
}

export async function evaluateGenerationGate(
  readControl: () => Promise<GenerationControlResponse>,
): Promise<GenerationGateDecision> {
  try {
    const control = generationControlResponseSchema.parse(await readControl());
    return generationGateDecisionSchema.parse(control.state === "running" ? {
      decision: "allow",
      state: "running",
      source: "persisted",
      reasonCode: control.reasonCode,
      controlVersion: control.version,
      schemaVersion: GENERATION_CONTROL_SCHEMA_VERSION,
      fixedReply: null,
    } : {
      decision: "stop",
      state: "stopped",
      source: "persisted",
      reasonCode: control.reasonCode,
      controlVersion: control.version,
      schemaVersion: GENERATION_CONTROL_SCHEMA_VERSION,
      fixedReply: GENERATION_STOP_FIXED_REPLY,
    });
  } catch {
    return generationGateDecisionSchema.parse({
      decision: "stop",
      state: "unknown",
      source: "fail_closed",
      reasonCode: "control_unavailable",
      controlVersion: null,
      schemaVersion: null,
      fixedReply: GENERATION_STOP_FIXED_REPLY,
    });
  }
}

export class GenerationControlStore {
  constructor(
    private readonly database: DatabaseExecutor,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async read(): Promise<GenerationControlResponse> {
    const row = await this.database.selectFrom("generation_controls")
      .selectAll().where("scope", "=", "global").executeTakeFirst();
    if (row === undefined) {
      throw new GenerationControlStoreError("GENERATION_CONTROL_NOT_FOUND");
    }
    return toResponse(row);
  }

  async evaluateGate(): Promise<GenerationGateDecision> {
    return evaluateGenerationGate(() => this.read());
  }

  async change(
    token: string,
    rawInput: GenerationControlChangeRequest,
  ): Promise<GenerationControlResponse> {
    const input = generationControlChangeRequestSchema.safeParse(rawInput);
    if (!input.success) {
      throw new GenerationControlStoreError("GENERATION_CONTROL_INPUT_INVALID");
    }
    const now = this.now();
    return this.inTransaction(async (transaction) => {
      const actorId = await this.authenticateOfficer(transaction, token);
      const requestHash = hashCommand({ actorId, input: input.data });
      const existing = await transaction.selectFrom("generation_control_changes")
        .selectAll().where("request_id", "=", input.data.requestId).executeTakeFirst();
      if (existing !== undefined) {
        if (existing.request_hash !== requestHash) {
          throw new GenerationControlStoreError(
            "GENERATION_CONTROL_IDEMPOTENCY_CONFLICT",
          );
        }
        return toResponse({
          state: existing.new_state,
          reason_code: existing.reason_code,
          version: existing.version,
          updated_by: existing.actor_id,
          updated_at: existing.created_at,
        });
      }

      const current = await transaction.selectFrom("generation_controls")
        .selectAll().where("scope", "=", "global").forUpdate().executeTakeFirst();
      if (current === undefined) {
        throw new GenerationControlStoreError("GENERATION_CONTROL_NOT_FOUND");
      }
      if (current.state === input.data.targetState) {
        throw new GenerationControlStoreError("GENERATION_CONTROL_NO_CHANGE");
      }
      const version = current.version + 1;
      await transaction.insertInto("generation_control_changes").values({
        id: randomUUID(),
        scope: "global",
        request_id: input.data.requestId,
        request_hash: requestHash,
        actor_id: actorId,
        prior_state: current.state,
        new_state: input.data.targetState,
        reason_code: input.data.reasonCode,
        reason_note: input.data.reasonNote,
        version,
        created_at: now,
      }).execute();
      await transaction.updateTable("generation_controls").set({
        state: input.data.targetState,
        reason_code: input.data.reasonCode,
        version,
        updated_by: actorId,
        updated_at: now,
      }).where("scope", "=", "global").execute();
      await transaction.insertInto("audit_entries").values({
        id: randomUUID(),
        actor_type: "safety_operator",
        actor_id: actorId,
        action: "generation.control.changed",
        target_type: "generation_control",
        target_id: "global",
        request_id: input.data.requestId,
        metadata: JSON.stringify({
          priorState: current.state,
          newState: input.data.targetState,
          reasonCode: input.data.reasonCode,
          version,
          schemaVersion: GENERATION_CONTROL_SCHEMA_VERSION,
        }),
        created_at: now,
      }).execute();
      return toResponse({
        state: input.data.targetState,
        reason_code: input.data.reasonCode,
        version,
        updated_by: actorId,
        updated_at: now,
      });
    });
  }

  private async authenticateOfficer(
    database: DatabaseExecutor,
    token: string,
  ): Promise<string> {
    if (typeof token !== "string" || token.length < 20) {
      throw new GenerationControlStoreError("GENERATION_CONTROL_UNAUTHORIZED");
    }
    const grant = await database.selectFrom("safety_access_grants")
      .select(["actor_id", "role"])
      .where("token_hash", "=", hashToken(token))
      .where("revoked_at", "is", null)
      .executeTakeFirst();
    if (grant === undefined) {
      throw new GenerationControlStoreError("GENERATION_CONTROL_UNAUTHORIZED");
    }
    if (grant.role !== "duty_safety_officer") {
      throw new GenerationControlStoreError("GENERATION_CONTROL_FORBIDDEN");
    }
    return grant.actor_id;
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
