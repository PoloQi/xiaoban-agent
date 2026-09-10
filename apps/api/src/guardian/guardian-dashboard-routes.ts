import type { FastifyInstance } from "fastify";

import { GUARDIAN_DASHBOARD_SCHEMA_VERSION } from "@xiaoban/contracts";

import { PublicAppError } from "../errors.js";
import type { GuardianDashboardService } from "./guardian-dashboard-service.js";

const headersSchema = {
  type: "object",
  required: ["authorization"],
  properties: { authorization: { type: "string", minLength: 50, maxLength: 50 } },
} as const;

const dashboardSchema = {
  type: "object",
  additionalProperties: false,
  required: ["schemaVersion", "access", "guardian", "child", "week", "stats", "days", "report", "privacy", "settings", "alerts"],
  properties: {
    schemaVersion: { type: "string", const: GUARDIAN_DASHBOARD_SCHEMA_VERSION },
    access: {
      type: "object", additionalProperties: false, required: ["mode", "relationshipStatus"],
      properties: { mode: { type: "string", const: "read_only" }, relationshipStatus: { type: "string", const: "verified" } },
    },
    guardian: { type: "object", additionalProperties: false, required: ["alias"], properties: { alias: { type: "string" } } },
    child: {
      type: "object", additionalProperties: false, required: ["alias", "ageBand"],
      properties: { alias: { type: "string" }, ageBand: { type: "string", enum: ["9_11", "12_14"] } },
    },
    week: {
      type: "object", additionalProperties: false, required: ["startDate", "endDate", "timezone"],
      properties: { startDate: { type: "string", format: "date" }, endDate: { type: "string", format: "date" }, timezone: { type: "string", const: "Asia/Shanghai" } },
    },
    stats: {
      type: "object", additionalProperties: false, required: ["realWorldActivities", "goalAttempts", "activeDays", "usageTracking"],
      properties: {
        realWorldActivities: { type: "integer", minimum: 0 }, goalAttempts: { type: "integer", minimum: 0 },
        activeDays: { type: "integer", minimum: 0, maximum: 7 }, usageTracking: { type: "string", const: "not_collected" },
      },
    },
    days: {
      type: "array", minItems: 7, maxItems: 7,
      items: {
        type: "object", additionalProperties: false, required: ["date", "label", "actionCount"],
        properties: { date: { type: "string", format: "date" }, label: { type: "string", enum: ["一", "二", "三", "四", "五", "六", "日"] }, actionCount: { type: "integer", minimum: 0 } },
      },
    },
    report: {
      type: "object", additionalProperties: false, required: ["source", "headline", "summary"],
      properties: { source: { type: "string", const: "deterministic_summary" }, headline: { type: "string" }, summary: { type: "string" } },
    },
    privacy: {
      type: "object", additionalProperties: false, required: ["visibleSummary", "hiddenDetail"],
      properties: { visibleSummary: { type: "string" }, hiddenDetail: { type: "string", const: "完整普通聊天" } },
    },
    settings: {
      type: "object", additionalProperties: false, required: ["bindingStatus", "usageReminder", "ordinaryChatVisible"],
      properties: {
        bindingStatus: { type: "string", const: "verified" }, ordinaryChatVisible: { type: "boolean", const: false },
        usageReminder: {
          type: "object", additionalProperties: false, required: ["status", "minutes", "editable"],
          properties: { status: { type: "string", const: "not_configured" }, minutes: { type: "null" }, editable: { type: "boolean", const: false } },
        },
      },
    },
    alerts: {
      type: "array", maxItems: 4,
      items: {
        type: "object", additionalProperties: false,
        required: ["id", "source", "level", "title", "summary", "occurredAt", "notificationStatus", "acknowledgementStatus", "steps"],
        properties: {
          id: { type: "string" }, source: { type: "string", const: "synthetic_preview" }, level: { type: "string", const: "L2" },
          title: { type: "string" }, summary: { type: "string" }, occurredAt: { type: "null" }, notificationStatus: { type: "string", const: "not_sent" },
          acknowledgementStatus: { type: "string", const: "unavailable" }, steps: { type: "array", minItems: 3, maxItems: 3, items: { type: "string" } },
        },
      },
    },
  },
} as const;

function token(authorization: string | undefined): string {
  const match = /^Bearer ([A-Za-z0-9_-]{43})$/u.exec(authorization ?? "");
  if (match?.[1] === undefined) throw new PublicAppError("UNAUTHORIZED", 401);
  return match[1];
}

export function registerGuardianDashboardRoutes(
  app: FastifyInstance,
  service: GuardianDashboardService,
): void {
  app.get(
    "/api/v1/guardian/dashboard",
    { schema: { headers: headersSchema, response: { 200: dashboardSchema } } },
    async (request) => service.get(token(request.headers.authorization)),
  );
}
