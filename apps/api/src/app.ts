import Fastify from "fastify";

import type {
  ErrorCode,
  ErrorResponse,
  HealthResponse,
  ReadinessResponse,
} from "@xiaoban/contracts";

import { PublicAppError } from "./errors.js";
import { registerChildContentRoutes } from "./content/child-content-routes.js";
import type { ChildContentService } from "./content/child-content-service.js";
import { registerContentRoutes } from "./content/routes.js";
import type { ContentService } from "./content/service.js";
import { registerEnrollmentRoutes } from "./identity/routes.js";
import type { EnrollmentService } from "./identity/service.js";
import { registerLocalTestAccountRoutes } from "./identity/local-test-account-routes.js";
import type { LocalTestAccountSessionIssuer } from "./identity/local-test-account.js";
import { registerChildChatRoutes } from "./chat/child-chat-routes.js";
import type { ChildChatService } from "./chat/child-chat-service.js";
import { registerChildGrowthRoutes } from "./growth/child-growth-routes.js";
import type { ChildGrowthService } from "./growth/child-growth-service.js";
import { registerChildOnboardingRoutes } from "./onboarding/child-onboarding-routes.js";
import type { ChildOnboardingService } from "./onboarding/child-onboarding-service.js";
import { registerChildMoodRoutes } from "./mood/child-mood-routes.js";
import type { ChildMoodService } from "./mood/child-mood-service.js";
import { registerChildTrustedAdultRoutes } from "./trusted/child-trusted-adult-routes.js";
import type { ChildTrustedAdultService } from "./trusted/child-trusted-adult-service.js";
import { registerGuardianDashboardRoutes } from "./guardian/guardian-dashboard-routes.js";
import type { GuardianDashboardService } from "./guardian/guardian-dashboard-service.js";
import { registerDataRightsRoutes } from "./datarights/data-rights-routes.js";
import type { DataRightsService } from "./datarights/data-rights-service.js";

interface AppDependencies {
  childChatService?: ChildChatService;
  childContentService?: ChildContentService;
  childGrowthService?: ChildGrowthService;
  childOnboardingService?: ChildOnboardingService;
  childMoodService?: ChildMoodService;
  childTrustedAdultService?: ChildTrustedAdultService;
  closeDatabase?: () => Promise<void>;
  contentService?: ContentService;
  enrollmentService?: EnrollmentService;
  dataRightsService?: DataRightsService;
  guardianDashboardService?: GuardianDashboardService;
  localTestAccountService?: LocalTestAccountSessionIssuer;
  probeDatabase?: () => Promise<void>;
}

const healthResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["status", "service", "timestamp"],
  properties: {
    status: { type: "string", const: "ok" },
    service: { type: "string", const: "xiaoban-api" },
    timestamp: { type: "string", format: "date-time" },
  },
} as const;

const errorResponseJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["error"],
  properties: {
    error: {
      type: "object",
      additionalProperties: false,
      required: ["code", "message", "nextAction", "requestId"],
      properties: {
        code: {
          type: "string",
          enum: [
            "INVALID_REQUEST",
            "ROUTE_NOT_FOUND",
            "DEPENDENCY_UNAVAILABLE",
            "UNAUTHORIZED",
            "FORBIDDEN",
            "INVITATION_INVALID",
            "INVITATION_EXPIRED",
            "INVITATION_USED",
            "CONSENT_REQUIRED",
            "POLICY_VERSION_MISMATCH",
            "ACCOUNT_DEACTIVATED",
            "IDEMPOTENCY_CONFLICT",
            "CONTENT_NOT_FOUND",
            "CONTENT_VERSION_NOT_FOUND",
            "CONTENT_INVALID_STATE",
            "CONTENT_SELF_REVIEW",
            "CONTENT_EXPIRED",
            "CONTENT_SLUG_CONFLICT",
            "INTERNAL_ERROR",
          ],
        },
        message: { type: "string", minLength: 1 },
        nextAction: { type: "string", minLength: 1 },
        requestId: { type: "string", minLength: 1 },
      },
    },
  },
} as const;

const publicErrors: Record<
  ErrorCode,
  Pick<ErrorResponse["error"], "message" | "nextAction">
> = {
  INVALID_REQUEST: {
    message: "请求内容不符合要求。",
    nextAction: "检查输入后重试。",
  },
  ROUTE_NOT_FOUND: {
    message: "请求的接口不存在。",
    nextAction: "检查请求地址后重试。",
  },
  NOT_FOUND: {
    message: "请求的资源不存在。",
    nextAction: "返回上一页或刷新后重试。",
  },
  DEPENDENCY_UNAVAILABLE: {
    message: "服务尚未准备好。",
    nextAction: "请稍后重试。",
  },
  UNAUTHORIZED: {
    message: "登录状态无效。",
    nextAction: "请重新从受控邀请进入。",
  },
  FORBIDDEN: {
    message: "当前角色不能执行这个操作。",
    nextAction: "请使用有权限的账号。",
  },
  INVITATION_INVALID: {
    message: "找不到这份邀请。",
    nextAction: "请向试点工作人员核对邀请码。",
  },
  INVITATION_EXPIRED: {
    message: "这份邀请已经过期。",
    nextAction: "请向试点工作人员申请新邀请。",
  },
  INVITATION_USED: {
    message: "这份邀请已经使用。",
    nextAction: "请继续已有流程或联系试点工作人员。",
  },
  CONSENT_REQUIRED: {
    message: "需要明确确认后才能继续。",
    nextAction: "请阅读说明并主动勾选确认。",
  },
  POLICY_VERSION_MISMATCH: {
    message: "说明版本已经更新。",
    nextAction: "请重新阅读最新说明。",
  },
  ACCOUNT_DEACTIVATED: {
    message: "监护同意已撤回，儿童功能已停用。",
    nextAction: "如有疑问，请联系试点工作人员。",
  },
  IDEMPOTENCY_CONFLICT: {
    message: "重复请求内容不一致。",
    nextAction: "请刷新状态后重试。",
  },
  CONTENT_NOT_FOUND: {
    message: "找不到这项内容。",
    nextAction: "刷新内容列表后重试。",
  },
  CONTENT_VERSION_NOT_FOUND: {
    message: "找不到这个内容版本。",
    nextAction: "刷新内容详情后重试。",
  },
  CONTENT_INVALID_STATE: {
    message: "当前内容状态不允许执行这个操作。",
    nextAction: "刷新内容状态并按流程继续。",
  },
  CONTENT_SELF_REVIEW: {
    message: "内容作者不能审核自己的版本。",
    nextAction: "请由另一位审核员处理。",
  },
  CONTENT_EXPIRED: {
    message: "这个内容版本已过有效期。",
    nextAction: "请新建有效版本后再发布。",
  },
  CONTENT_SLUG_CONFLICT: {
    message: "内容标识已被使用。",
    nextAction: "请更换内容标识后重试。",
  },
  INTERNAL_ERROR: {
    message: "服务暂时无法完成请求。",
    nextAction: "请稍后重试；若问题持续，请提供请求编号。",
  },
};

function createErrorResponse(code: ErrorCode, requestId: string): ErrorResponse {
  return {
    error: {
      code,
      ...publicErrors[code],
      requestId,
    },
  };
}

function isValidationError(error: unknown): error is { validation: unknown[] } {
  return (
    typeof error === "object" &&
    error !== null &&
    "validation" in error &&
    Array.isArray(error.validation)
  );
}

export function buildApp(dependencies: AppDependencies = {}) {
  const app = Fastify({ logger: false });

  if (dependencies.closeDatabase !== undefined) {
    app.addHook("onClose", dependencies.closeDatabase);
  }

  app.addHook("onRequest", async (request, reply) => {
    reply.header("x-request-id", request.id);
  });

  app.setNotFoundHandler(async (request, reply) =>
    reply.code(404).send(createErrorResponse("ROUTE_NOT_FOUND", request.id)),
  );

  app.setErrorHandler(async (error, request, reply) => {
    if (error instanceof PublicAppError) {
      return reply
        .code(error.statusCode)
        .send(createErrorResponse(error.code, request.id));
    }

    if (isValidationError(error)) {
      return reply
        .code(400)
        .send(createErrorResponse("INVALID_REQUEST", request.id));
    }

    request.log.error(
      { errorCode: "INTERNAL_ERROR", requestId: request.id },
      "Unhandled request error",
    );

    return reply
      .code(500)
      .send(createErrorResponse("INTERNAL_ERROR", request.id));
  });

  app.get<{ Reply: HealthResponse }>(
    "/api/v1/health",
    {
      schema: {
        response: {
          200: healthResponseJsonSchema,
          "4xx": errorResponseJsonSchema,
          500: errorResponseJsonSchema,
        },
      },
    },
    async () => ({
      status: "ok",
      service: "xiaoban-api",
      timestamp: new Date().toISOString(),
    }),
  );

  app.get<{ Reply: ReadinessResponse | ErrorResponse }>(
    "/api/v1/readiness",
    {
      schema: {
        response: {
          200: {
            type: "object",
            additionalProperties: false,
            required: ["status", "service", "timestamp", "dependencies"],
            properties: {
              status: { type: "string", const: "ready" },
              service: { type: "string", const: "xiaoban-api" },
              timestamp: { type: "string", format: "date-time" },
              dependencies: {
                type: "object",
                additionalProperties: false,
                required: ["database"],
                properties: { database: { type: "string", const: "ready" } },
              },
            },
          },
          503: errorResponseJsonSchema,
        },
      },
    },
    async (request, reply) => {
      try {
        if (dependencies.probeDatabase === undefined) {
          throw new Error("Database probe is unavailable.");
        }
        await dependencies.probeDatabase();
        return {
          status: "ready",
          service: "xiaoban-api",
          timestamp: new Date().toISOString(),
          dependencies: { database: "ready" },
        };
      } catch {
        return reply
          .code(503)
          .send(createErrorResponse("DEPENDENCY_UNAVAILABLE", request.id));
      }
    },
  );

  if (dependencies.enrollmentService !== undefined) {
    registerEnrollmentRoutes(app, dependencies.enrollmentService);
  }

  if (dependencies.localTestAccountService !== undefined) {
    registerLocalTestAccountRoutes(app, dependencies.localTestAccountService);
  }

  if (dependencies.contentService !== undefined) {
    registerContentRoutes(app, dependencies.contentService);
  }

  if (dependencies.childContentService !== undefined) {
    registerChildContentRoutes(app, dependencies.childContentService);
  }

  if (dependencies.childChatService !== undefined) {
    registerChildChatRoutes(app, dependencies.childChatService);
  }

  if (dependencies.childGrowthService !== undefined) {
    registerChildGrowthRoutes(app, dependencies.childGrowthService);
  }

  if (dependencies.childOnboardingService !== undefined) {
    registerChildOnboardingRoutes(app, dependencies.childOnboardingService);
  }

  if (dependencies.childMoodService !== undefined) {
    registerChildMoodRoutes(app, dependencies.childMoodService);
  }

  if (dependencies.childTrustedAdultService !== undefined) {
    registerChildTrustedAdultRoutes(app, dependencies.childTrustedAdultService);
  }

  if (dependencies.guardianDashboardService !== undefined) {
    registerGuardianDashboardRoutes(app, dependencies.guardianDashboardService);
  }

  if (dependencies.dataRightsService !== undefined) {
    registerDataRightsRoutes(app, dependencies.dataRightsService);
  }

  return app;
}
