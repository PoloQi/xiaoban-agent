import { createHash } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import {
  CHILD_ONBOARDING_SCHEMA_VERSION,
  childOnboardingResponseSchema,
  type ChildGrade,
  type ChildInterest,
  type ChildOnboardingCompletionRequest,
  type ChildOnboardingResponse,
  type ChildProfileUpdateRequest,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";

interface ChildPrincipal {
  ageBand: "9_11" | "12_14";
  alias: string;
  childId: string;
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function hashRequest(request: ChildOnboardingCompletionRequest): string {
  return createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
}

function hashUpdateRequest(request: ChildProfileUpdateRequest): string {
  return createHash("sha256").update(JSON.stringify(request), "utf8").digest("hex");
}

function interestsValue(value: unknown): ChildInterest[] {
  return (typeof value === "string" ? JSON.parse(value) : value) as ChildInterest[];
}

function gradeMatchesAgeBand(
  grade: ChildGrade,
  ageBand: ChildPrincipal["ageBand"],
): boolean {
  return ageBand === "9_11"
    ? ["grade_4", "grade_5", "grade_6"].includes(grade)
    : ["grade_7", "grade_8"].includes(grade);
}

export class ChildOnboardingService {
  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(token: string): Promise<ChildOnboardingResponse> {
    const principal = await this.authenticate(token);
    return this.buildResponse(this.database, principal);
  }

  async complete(
    token: string,
    request: ChildOnboardingCompletionRequest,
  ): Promise<ChildOnboardingResponse> {
    const principal = await this.authenticate(token);
    if (!gradeMatchesAgeBand(request.grade, principal.ageBand)) {
      throw new PublicAppError("INVALID_REQUEST", 400);
    }
    const requestHash = hashRequest(request);

    await this.database.transaction().execute(async (transaction) => {
      const existingByRequest = await transaction.selectFrom("child_profiles")
        .select(["child_id as childId", "request_hash as requestHash"])
        .where("completion_request_id", "=", request.requestId)
        .executeTakeFirst();
      if (existingByRequest !== undefined) {
        if (
          existingByRequest.childId !== principal.childId
          || existingByRequest.requestHash !== requestHash
        ) {
          throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
        }
        return;
      }

      const existingProfile = await transaction.selectFrom("child_profiles")
        .select("child_id as childId")
        .where("child_id", "=", principal.childId)
        .forUpdate()
        .executeTakeFirst();
      if (existingProfile !== undefined) {
        await transaction.updateTable("child_profiles")
          .set({
            completion_request_id: request.requestId,
            request_hash: requestHash,
            grade: request.grade,
            interests: JSON.stringify(request.interests),
            companion: request.companion,
            completed_at: this.now(),
          })
          .where("child_id", "=", existingProfile.childId)
          .execute();
        return;
      }

      await transaction.insertInto("child_profiles").values({
        child_id: principal.childId,
        completion_request_id: request.requestId,
        request_hash: requestHash,
        grade: request.grade,
        interests: JSON.stringify(request.interests),
        companion: request.companion,
        completed_at: this.now(),
      }).execute();
    });

    return this.buildResponse(this.database, principal);
  }

  /**
   * 「我的 → 修改我的资料」编辑闭环。
   *
   * 约束（沿用 onboarding 但补两条差异）：
   * 1. 必须已存在 child_profiles 行（资料编辑只对已完成的儿童开放）。
   * 2. grade 必须仍在当前 ageBand 允许的范围内（与 onboarding 一致）。
   * 3. alias 变化时同步更新 child_accounts.alias；alias 不变则不写 child_accounts（减少锁与审计噪声）。
   * 4. completion_request_id/request_hash 随每次更新写入（idempotency 与 complete 一致）；
   *    相同 requestId 二次提交会被识别为重放并要求 body 与首次一致。
   * 5. updated_at 在每次成功编辑后写入；completed_at 保持首次完成时间不变。
   */
  async update(
    token: string,
    request: ChildProfileUpdateRequest,
  ): Promise<ChildOnboardingResponse> {
    const principal = await this.authenticate(token);
    if (!gradeMatchesAgeBand(request.grade, principal.ageBand)) {
      throw new PublicAppError("INVALID_REQUEST", 400);
    }
    const requestHash = hashUpdateRequest(request);
    const now = this.now();

    await this.database.transaction().execute(async (transaction) => {
      const replayed = await transaction.selectFrom("child_profiles")
        .select([
          "child_id as childId",
          "request_hash as requestHash",
        ])
        .where("completion_request_id", "=", request.requestId)
        .executeTakeFirst();
      if (replayed !== undefined) {
        if (
          replayed.childId !== principal.childId
          || replayed.requestHash !== requestHash
        ) {
          throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
        }
        return;
      }

      const existingProfile = await transaction.selectFrom("child_profiles")
        .select(["child_id as childId"])
        .where("child_id", "=", principal.childId)
        .forUpdate()
        .executeTakeFirst();
      if (existingProfile === undefined) {
        throw new PublicAppError("NOT_FOUND", 404);
      }

      await transaction.updateTable("child_profiles")
        .set({
          completion_request_id: request.requestId,
          request_hash: requestHash,
          grade: request.grade,
          interests: JSON.stringify(request.interests),
          companion: request.companion,
          updated_at: now,
        })
        .where("child_id", "=", existingProfile.childId)
        .execute();

      if (request.alias !== principal.alias) {
        await transaction.updateTable("child_accounts")
          .set({ alias: request.alias, updated_at: now })
          .where("id", "=", existingProfile.childId)
          .execute();
      }
    });

    const refreshed: ChildPrincipal = { ...principal, alias: request.alias };
    return this.buildResponse(this.database, refreshed);
  }

  private async buildResponse(
    database: Kysely<DatabaseSchema> | Transaction<DatabaseSchema>,
    principal: ChildPrincipal,
  ): Promise<ChildOnboardingResponse> {
    const profile = await database.selectFrom("child_profiles")
      .select([
        "grade",
        "interests",
        "companion",
        "completed_at as completedAt",
        "updated_at as updatedAt",
      ])
      .where("child_id", "=", principal.childId)
      .executeTakeFirst();
    if (profile === undefined) {
      return {
        schemaVersion: CHILD_ONBOARDING_SCHEMA_VERSION,
        status: "not_started",
        profile: null,
      };
    }
    return childOnboardingResponseSchema.parse({
      schemaVersion: CHILD_ONBOARDING_SCHEMA_VERSION,
      status: "completed",
      profile: {
        alias: principal.alias,
        ageBand: principal.ageBand,
        grade: profile.grade,
        interests: interestsValue(profile.interests),
        companion: profile.companion,
        completedAt: profile.completedAt.toISOString(),
        updatedAt: profile.updatedAt === null ? null : profile.updatedAt.toISOString(),
      },
    });
  }

  private async authenticate(token: string): Promise<ChildPrincipal> {
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
      .select(["alias", "age_band as ageBand", "status"])
      .where("id", "=", session.childId)
      .where("id", "=", session.subjectId)
      .executeTakeFirst();
    if (session.revokedAt !== null || child?.status !== "active") {
      throw new PublicAppError("ACCOUNT_DEACTIVATED", 403);
    }
    return { alias: child.alias, childId: session.childId, ageBand: child.ageBand };
  }
}
