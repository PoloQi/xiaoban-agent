import type { Kysely } from "kysely";

import {
  GUARDIAN_DASHBOARD_SCHEMA_VERSION,
  guardianDashboardResponseSchema,
  type GuardianDashboardResponse,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";
import { weekWindow } from "../growth/child-growth-service.js";
import { hashSecret } from "../identity/service.js";

const DAY_LABELS = ["一", "二", "三", "四", "五", "六", "日"] as const;

function localDateValue(value: unknown): string {
  if (!(value instanceof Date)) return String(value).slice(0, 10);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const date = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${date.year}-${date.month}-${date.day}`;
}

interface GuardianDashboardOptions {
  syntheticPreviewGuardianId?: string;
  now?: () => Date;
}

interface GuardianPrincipal {
  guardianId: string;
  guardianAlias: string;
  childId: string;
  childAlias: string;
  ageBand: "9_11" | "12_14";
}

export class GuardianDashboardService {
  private readonly now: () => Date;

  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly options: GuardianDashboardOptions = {},
  ) {
    this.now = options.now ?? (() => new Date());
  }

  async get(token: string): Promise<GuardianDashboardResponse> {
    const principal = await this.authenticate(token);
    const window = weekWindow(this.now());
    const attempts = await this.database.selectFrom("growth_attempts")
      .select(["source", "local_date as localDate"])
      .where("child_id", "=", principal.childId)
      .where("local_date", ">=", window.startDate)
      .where("local_date", "<=", window.endDate)
      .execute();
    const counts = new Map<string, number>();
    for (const attempt of attempts) {
      const date = localDateValue(attempt.localDate);
      counts.set(date, (counts.get(date) ?? 0) + 1);
    }
    const activityCount = attempts.filter((attempt) => attempt.source === "activity").length;
    const attemptCount = attempts.length;
    const activeDays = counts.size;
    const headline = attemptCount === 0
      ? `${principal.childAlias}本周还没有记录现实行动`
      : `${principal.childAlias}本周记录了${attemptCount}次尝试`;
    const summary = attemptCount === 0
      ? "本周暂时没有目标尝试记录。可以先留意孩子愿意开始的一次小行动。"
      : `本周有${attemptCount}次目标尝试，其中${activityCount}次来自现实活动，分布在${activeDays}天。`;

    return guardianDashboardResponseSchema.parse({
      schemaVersion: GUARDIAN_DASHBOARD_SCHEMA_VERSION,
      access: { mode: "read_only", relationshipStatus: "verified" },
      guardian: { alias: principal.guardianAlias },
      child: { alias: principal.childAlias, ageBand: principal.ageBand },
      week: {
        startDate: window.startDate,
        endDate: window.endDate,
        timezone: "Asia/Shanghai",
      },
      stats: {
        realWorldActivities: activityCount,
        goalAttempts: attemptCount,
        activeDays,
        usageTracking: "not_collected",
      },
      days: window.dates.map((date, index) => ({
        date,
        label: DAY_LABELS[index],
        actionCount: counts.get(date) ?? 0,
      })),
      report: { source: "deterministic_summary", headline, summary },
      privacy: {
        visibleSummary: "本周现实活动、目标尝试和必要的风险演练状态",
        hiddenDetail: "完整普通聊天",
      },
      settings: {
        bindingStatus: "verified",
        usageReminder: { status: "not_configured", minutes: null, editable: false },
        ordinaryChatVisible: false,
      },
      alerts: principal.guardianId === this.options.syntheticPreviewGuardianId
        ? [{
            id: "synthetic-online-privacy-preview",
            source: "synthetic_preview",
            level: "L2",
            title: "陌生网友索要家庭地址",
            summary: "本地合成演练，不代表孩子发生了真实事件，也没有向任何人发送通知。",
            occurredAt: null,
            notificationStatus: "not_sent",
            acknowledgementStatus: "unavailable",
            steps: [
              "先停止发送家庭地址、学校、照片等个人信息。",
              "停止与对方联系，并保留必要的页面线索。",
              "和孩子一起找身边可信任成年人说明情况。",
            ],
          }]
        : [],
    });
  }

  private async authenticate(token: string): Promise<GuardianPrincipal> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    const session = await this.database.selectFrom("access_sessions")
      .select(["role", "subject_id as subjectId", "enrollment_id as enrollmentId", "revoked_at as revokedAt"])
      .where("token_hash", "=", hashSecret(token))
      .executeTakeFirst();
    if (session === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
    if (session.role !== "guardian") throw new PublicAppError("FORBIDDEN", 403);
    if (session.revokedAt !== null || session.enrollmentId === null) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }

    const principal = await this.database.selectFrom("guardian_accounts as guardian")
      .innerJoin("enrollments as enrollment", "enrollment.guardian_id", "guardian.id")
      .innerJoin("guardian_consents as consent", "consent.enrollment_id", "enrollment.id")
      .innerJoin("child_accounts as child", "child.id", "enrollment.child_id")
      .innerJoin("guardian_child_links as link", "link.child_id", "child.id")
      .select([
        "guardian.id as guardianId",
        "guardian.alias as guardianAlias",
        "guardian.status as guardianStatus",
        "enrollment.status as enrollmentStatus",
        "consent.status as consentStatus",
        "child.id as childId",
        "child.alias as childAlias",
        "child.age_band as ageBand",
        "child.status as childStatus",
        "link.verification_status as relationshipStatus",
        "link.deactivated_at as linkDeactivatedAt",
      ])
      .where("guardian.id", "=", session.subjectId)
      .where("enrollment.id", "=", session.enrollmentId)
      .whereRef("consent.guardian_id", "=", "guardian.id")
      .whereRef("consent.child_id", "=", "child.id")
      .whereRef("link.guardian_id", "=", "guardian.id")
      .executeTakeFirst();

    if (principal === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
    if (
      principal.guardianStatus !== "active"
      || principal.enrollmentStatus !== "active"
      || principal.consentStatus !== "active"
      || principal.childStatus !== "active"
      || principal.relationshipStatus !== "verified"
      || principal.linkDeactivatedAt !== null
    ) {
      throw new PublicAppError("ACCOUNT_DEACTIVATED", 403);
    }
    return {
      guardianId: principal.guardianId,
      guardianAlias: principal.guardianAlias,
      childId: principal.childId,
      childAlias: principal.childAlias,
      ageBand: principal.ageBand,
    };
  }
}
