import { createHash, randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import {
  CHILD_GROWTH_GOAL_LIST_SCHEMA_VERSION,
  CHILD_GROWTH_PLAN_SCHEMA_VERSION,
  DEFAULT_CHILD_GROWTH_GOAL_KEY,
  childGrowthGoalKeySchema,
  childGrowthGoalListResponseSchema,
  childGrowthGoalOptionSchema,
  childGrowthPlanResponseSchema,
  type ChildGrowthAttemptRequest,
  type ChildGrowthGoalKey,
  type ChildGrowthGoalListResponse,
  type ChildGrowthGoalUpdateRequest,
  type ChildGrowthPlanResponse,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";
import { visibleContentQuery } from "../content/visible-content.js";

const TIMEZONE = "Asia/Shanghai" as const;
const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

const GOAL_CATALOG: ReadonlyArray<{
  key: ChildGrowthGoalKey;
  title: string;
  alternativeAction: string;
  description: string;
}> = [
  {
    key: "screen-free-bedtime-30m",
    title: "睡前30分钟不刷短视频",
    alternativeAction: "听一段故事、整理书包，或者和身边的大人聊五分钟。",
    description: "把屏幕放一放，给身体一段安静下来再睡的过渡时间。",
  },
  {
    key: "daily-move-20m",
    title: "每天运动20分钟",
    alternativeAction: "散步、跳绳、伸展，或者做一套简单的操。",
    description: "找一个身体喜欢的方式，每天活动 20 分钟就够了。",
  },
  {
    key: "daily-read-10-pages",
    title: "每天读10页书",
    alternativeAction: "睡前读、课间读，或者和身边的大人一起读。",
    description: "不限制书单，挑一本想翻开的，慢慢读 10 页。",
  },
  {
    key: "tidy-my-space",
    title: "整理自己的书桌或书包",
    alternativeAction: "睡前 5 分钟，或做完作业后顺手整理一次。",
    description: "把属于自己的小地方收拾整齐，是一个安静的开始。",
  },
  {
    key: "three-good-things",
    title: "写下今天三件好事",
    alternativeAction: "写在日记本、便签上，或者画下来也行。",
    description: "帮自己留意今天已经发生的小好事。",
  },
] as const;

interface ChildPrincipal {
  ageBand: "9_11" | "12_14";
  childId: string;
}

interface WeekWindow {
  dates: string[];
  endDate: string;
  nextStart: Date;
  start: Date;
  startDate: string;
  today: string;
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function hashRequest(request: ChildGrowthAttemptRequest): string {
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

function addDays(date: string, amount: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const shifted = new Date(Date.UTC(year!, month! - 1, day! + amount));
  return shifted.toISOString().slice(0, 10);
}

function localDateValue(value: unknown): string {
  if (value instanceof Date) return chinaDate(value);
  return String(value).slice(0, 10);
}

function findGoal(goalKey: ChildGrowthGoalKey): (typeof GOAL_CATALOG)[number] {
  const goal = GOAL_CATALOG.find((entry) => entry.key === goalKey);
  if (goal === undefined) throw new PublicAppError("INVALID_REQUEST", 400);
  return goal;
}

export function weekWindow(now: Date): WeekWindow {
  const today = chinaDate(now);
  const [year, month, day] = today.split("-").map(Number);
  const utcDate = new Date(Date.UTC(year!, month! - 1, day!));
  const offsetFromMonday = (utcDate.getUTCDay() + 6) % 7;
  const startDate = addDays(today, -offsetFromMonday);
  const dates = DAY_LABELS.map((_, index) => addDays(startDate, index));
  const [startYear, startMonth, startDay] = startDate.split("-").map(Number);
  const start = new Date(Date.UTC(startYear!, startMonth! - 1, startDay!, -8));
  const nextStart = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return {
    dates,
    endDate: dates[6]!,
    nextStart,
    start,
    startDate,
    today,
  };
}

export class ChildGrowthService {
  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async get(token: string): Promise<ChildGrowthPlanResponse> {
    const principal = await this.authenticate(token);
    const goalKey = await this.readCurrentGoalKey(principal.childId);
    return this.buildPlan(this.database, principal, goalKey, this.now());
  }

  async listGoals(token: string): Promise<ChildGrowthGoalListResponse> {
    const principal = await this.authenticate(token);
    const currentKey = await this.readCurrentGoalKey(principal.childId);
    return childGrowthGoalListResponseSchema.parse({
      schemaVersion: CHILD_GROWTH_GOAL_LIST_SCHEMA_VERSION,
      currentKey,
      goals: GOAL_CATALOG.map((entry) => childGrowthGoalOptionSchema.parse(entry)),
    });
  }

  async updateGoal(
    token: string,
    request: ChildGrowthGoalUpdateRequest,
  ): Promise<ChildGrowthGoalListResponse> {
    const principal = await this.authenticate(token);
    const goal = findGoal(request.goalKey);
    childGrowthGoalKeySchema.parse(goal.key);

    await this.database.transaction().execute(async (transaction) => {
      const existingProfile = await transaction.selectFrom("child_profiles")
        .select("child_id as childId")
        .where("child_id", "=", principal.childId)
        .forUpdate()
        .executeTakeFirst();
      if (existingProfile !== undefined) {
        await transaction.updateTable("child_profiles")
          .set({
            current_goal_id: request.goalKey,
            updated_at: this.now(),
          })
          .where("child_id", "=", principal.childId)
          .execute();
      } else {
        await transaction.insertInto("child_profiles").values({
          child_id: principal.childId,
          completion_request_id: "00000000-0000-4000-8000-000000000000",
          request_hash: createHash("sha256").update(`goal-only:${principal.childId}:${request.goalKey}`, "utf8").digest("hex"),
          grade: "grade_4",
          interests: JSON.stringify([]),
          companion: "sprout",
          completed_at: this.now(),
          current_goal_id: request.goalKey,
        }).execute();
      }
    });

    return childGrowthGoalListResponseSchema.parse({
      schemaVersion: CHILD_GROWTH_GOAL_LIST_SCHEMA_VERSION,
      currentKey: request.goalKey,
      goals: GOAL_CATALOG.map((entry) => childGrowthGoalOptionSchema.parse(entry)),
    });
  }

  async record(
    token: string,
    request: ChildGrowthAttemptRequest,
  ): Promise<ChildGrowthPlanResponse> {
    const principal = await this.authenticate(token);
    const now = this.now();
    const goalKey = await this.readCurrentGoalKey(principal.childId);
    const window = weekWindow(now);
    const requestHash = hashRequest(request);

    await this.database.transaction().execute(async (transaction) => {
      const existingRequest = await transaction.selectFrom("growth_attempts")
        .select(["child_id as childId", "request_hash as requestHash"])
        .where("request_id", "=", request.requestId)
        .executeTakeFirst();
      if (existingRequest !== undefined) {
        if (
          existingRequest.childId !== principal.childId
          || existingRequest.requestHash !== requestHash
        ) {
          throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
        }
        return;
      }

      if (request.source === "activity") {
        const activity = await visibleContentQuery(
          transaction,
          principal.ageBand,
          now,
        )
          .select("item.slug")
          .where("item.content_type", "=", "activity")
          .where("item.slug", "=", request.activitySlug)
          .executeTakeFirst();
        if (activity === undefined) {
          throw new PublicAppError("CONTENT_NOT_FOUND", 404);
        }
        const duplicateActivity = await transaction.selectFrom("growth_attempts")
          .select("id")
          .where("child_id", "=", principal.childId)
          .where("goal_key", "=", goalKey)
          .where("source", "=", "activity")
          .where("activity_slug", "=", request.activitySlug)
          .where("local_date", "=", window.today)
          .executeTakeFirst();
        if (duplicateActivity !== undefined) return;
      } else {
        const alreadyRecordedToday = await transaction.selectFrom("growth_attempts")
          .select("id")
          .where("child_id", "=", principal.childId)
          .where("goal_key", "=", goalKey)
          .where("local_date", "=", window.today)
          .executeTakeFirst();
        if (alreadyRecordedToday !== undefined) return;
      }

      await transaction.insertInto("growth_attempts").values({
        id: randomUUID(),
        request_id: request.requestId,
        request_hash: requestHash,
        child_id: principal.childId,
        goal_key: goalKey,
        source: request.source,
        activity_slug: request.source === "activity" ? request.activitySlug : null,
        target_minutes: request.source === "activity" ? request.targetMinutes : null,
        feeling: request.source === "activity" ? request.feeling ?? null : null,
        local_date: window.today,
        created_at: now,
      }).execute();
    });

    return this.buildPlan(this.database, principal, goalKey, now);
  }

  private async readCurrentGoalKey(childId: string): Promise<ChildGrowthGoalKey> {
    const row = await this.database.selectFrom("child_profiles")
      .select("current_goal_id as currentGoalId")
      .where("child_id", "=", childId)
      .executeTakeFirst();
    if (row?.currentGoalId === undefined || row.currentGoalId === null) {
      return DEFAULT_CHILD_GROWTH_GOAL_KEY;
    }
    const parsed = childGrowthGoalKeySchema.safeParse(row.currentGoalId);
    if (!parsed.success) return DEFAULT_CHILD_GROWTH_GOAL_KEY;
    return parsed.data;
  }

  private async buildPlan(
    database: Kysely<DatabaseSchema> | Transaction<DatabaseSchema>,
    principal: ChildPrincipal,
    goalKey: ChildGrowthGoalKey,
    now: Date,
  ): Promise<ChildGrowthPlanResponse> {
    const goal = findGoal(goalKey);
    const window = weekWindow(now);
    const attempts = await database.selectFrom("growth_attempts")
      .select(["source", "activity_slug as activitySlug", "local_date as localDate"])
      .where("child_id", "=", principal.childId)
      .where("goal_key", "=", goalKey)
      .where("created_at", ">=", window.start)
      .where("created_at", "<", window.nextStart)
      .orderBy("created_at")
      .execute();
    const activeDates = new Set(attempts.map((attempt) => localDateValue(attempt.localDate)));
    const activityCount = attempts.filter((attempt) => attempt.source === "activity").length;
    const manualCount = attempts.length - activityCount;
    const attemptCount = attempts.length;
    const choices: ChildGrowthPlanResponse["review"]["choices"] = [];
    if (activityCount > 0) {
      choices.push({
        kind: "activity",
        title: "用现实活动替代刷视频",
        detail: `你已经完成${activityCount}次现实活动，每一次都算数。`,
      });
    }
    if (manualCount > 0) {
      choices.push({
        kind: "self_report",
        title: "主动记录自己的尝试",
        detail: `你主动记下${manualCount}次改变，不连续也没关系。`,
      });
    }

    return childGrowthPlanResponseSchema.parse({
      schemaVersion: CHILD_GROWTH_PLAN_SCHEMA_VERSION,
      week: {
        startDate: window.startDate,
        endDate: window.endDate,
        timezone: TIMEZONE,
      },
      goal: {
        key: goalKey,
        title: goal.title,
        alternativeAction: goal.alternativeAction,
        targetAttempts: 3,
        attemptCount,
        status: attemptCount === 0 ? "not_started" : attemptCount >= 3 ? "completed" : "in_progress",
        todayRecorded: activeDates.has(window.today),
      },
      days: window.dates.map((date, index) => ({
        date,
        label: DAY_LABELS[index],
        attempted: activeDates.has(date),
      })),
      stats: {
        realWorldActivities: activityCount,
        goalAttempts: attemptCount,
        activeDays: activeDates.size,
      },
      review: {
        headline: attemptCount === 0 ? "这一周，从第一次尝试开始" : "这一周，你多了几种选择",
        summary: attemptCount === 0
          ? "还没有记录也没关系。今天愿意试一次，就是开始。"
          : `你已经记录${attemptCount}次尝试，其中${activityCount}次来自现实活动。`,
        choices,
        nextGoal: { key: goalKey, title: goal.title },
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
      .select(["age_band as ageBand", "status"])
      .where("id", "=", session.childId)
      .where("id", "=", session.subjectId)
      .executeTakeFirst();
    if (session.revokedAt !== null || child?.status !== "active") {
      throw new PublicAppError("ACCOUNT_DEACTIVATED", 403);
    }
    return { childId: session.childId, ageBand: child.ageBand };
  }
}