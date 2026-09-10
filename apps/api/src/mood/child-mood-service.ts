import { createHash } from "node:crypto";

import type { Kysely } from "kysely";

import {
  CHILD_MOOD_CHECK_IN_SCHEMA_VERSION,
  childMoodCheckInResponseSchema,
  type ChildMoodCheckInRequest,
  type ChildMoodCheckInResponse,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";

const TIMEZONE = "Asia/Shanghai";

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function hashRequest(request: ChildMoodCheckInRequest): string {
  return createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
}

function chinaDate(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const value = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${value.year}-${value.month}-${value.day}`;
}

function dateValue(value: unknown): string {
  return value instanceof Date ? chinaDate(value) : String(value).slice(0, 10);
}

export class ChildMoodService {
  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(token: string): Promise<ChildMoodCheckInResponse> {
    const childId = await this.authenticate(token);
    const today = chinaDate(this.now());
    const row = await this.database.selectFrom("child_mood_checkins")
      .select(["mood", "local_date as localDate", "updated_at as updatedAt"])
      .where("child_id", "=", childId)
      .executeTakeFirst();

    if (row !== undefined && dateValue(row.localDate) !== today) {
      await this.database.deleteFrom("child_mood_checkins")
        .where("child_id", "=", childId)
        .where("local_date", "=", dateValue(row.localDate))
        .execute();
      return this.response(today, null, null);
    }
    return this.response(today, row?.mood ?? null, row?.updatedAt ?? null);
  }

  async save(
    token: string,
    request: ChildMoodCheckInRequest,
  ): Promise<ChildMoodCheckInResponse> {
    const childId = await this.authenticate(token);
    const now = this.now();
    const today = chinaDate(now);
    const requestHash = hashRequest(request);

    const saved = await this.database.transaction().execute(async (transaction) => {
      const requestRow = await transaction.selectFrom("child_mood_checkins")
        .select([
          "child_id as childId",
          "request_hash as requestHash",
          "mood",
          "local_date as localDate",
          "updated_at as updatedAt",
        ])
        .where("request_id", "=", request.requestId)
        .executeTakeFirst();
      if (requestRow !== undefined) {
        if (requestRow.childId !== childId || requestRow.requestHash !== requestHash) {
          throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
        }
        return requestRow;
      }

      const current = await transaction.selectFrom("child_mood_checkins")
        .select("child_id")
        .where("child_id", "=", childId)
        .forUpdate()
        .executeTakeFirst();
      if (current === undefined) {
        await transaction.insertInto("child_mood_checkins").values({
          child_id: childId,
          request_id: request.requestId,
          request_hash: requestHash,
          mood: request.mood,
          local_date: today,
          updated_at: now,
        }).execute();
      } else {
        await transaction.updateTable("child_mood_checkins").set({
          request_id: request.requestId,
          request_hash: requestHash,
          mood: request.mood,
          local_date: today,
          updated_at: now,
        }).where("child_id", "=", childId).execute();
      }
      return { childId, requestHash, mood: request.mood, localDate: today, updatedAt: now };
    });

    return this.response(dateValue(saved.localDate), saved.mood, saved.updatedAt);
  }

  private response(
    date: string,
    mood: ChildMoodCheckInResponse["mood"],
    updatedAt: Date | null,
  ): ChildMoodCheckInResponse {
    return childMoodCheckInResponseSchema.parse({
      schemaVersion: CHILD_MOOD_CHECK_IN_SCHEMA_VERSION,
      date,
      mood,
      updatedAt: updatedAt?.toISOString() ?? null,
    });
  }

  private async authenticate(token: string): Promise<string> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    const session = await this.database.selectFrom("access_sessions")
      .select(["role", "subject_id as subjectId", "child_id as childId", "revoked_at as revokedAt"])
      .where("token_hash", "=", hashToken(token))
      .executeTakeFirst();
    if (session === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
    if (session.role !== "child") throw new PublicAppError("FORBIDDEN", 403);
    if (session.childId === null) throw new PublicAppError("UNAUTHORIZED", 401);
    const child = await this.database.selectFrom("child_accounts")
      .select("status")
      .where("id", "=", session.childId)
      .where("id", "=", session.subjectId)
      .executeTakeFirst();
    if (session.revokedAt !== null || child?.status !== "active") {
      throw new PublicAppError("ACCOUNT_DEACTIVATED", 403);
    }
    return session.childId;
  }
}
