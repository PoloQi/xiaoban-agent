import { createHash } from "node:crypto";

import type { Kysely } from "kysely";

import {
  CHILD_CHAT_SCHEMA_VERSION,
  childChatResponseSchema,
  internalAiOrchestrationResultSchema,
  type ChildChatRequest,
  type ChildChatResponse,
  type InternalAiOrchestrationRequest,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";
import { getRiskDisposition } from "../safety/risk-policy.js";
import { assessRiskWithRules } from "../safety/risk-rule-engine.js";

const STATIC_FALLBACK_REPLY =
  "我现在暂时不能回答，可以先暂停一下，稍后再试；需要帮助时请找身边可信任的成年人。";

interface ChildPrincipal {
  ageBand: "9_11" | "12_14";
  childId: string;
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export type ChildChatRunner = (
  input: InternalAiOrchestrationRequest,
) => Promise<unknown>;

export class ChildChatService {
  constructor(
    private readonly database: Kysely<DatabaseSchema>,
    private readonly runInternal?: ChildChatRunner,
  ) {}

  async chat(token: string, request: ChildChatRequest): Promise<ChildChatResponse> {
    const principal = await this.authenticate(token);
    const assessment = assessRiskWithRules({
      requestId: request.requestId,
      synthetic: true,
      ageBand: principal.ageBand,
      turns: [
        ...(request.history ?? [])
          .filter((turn) => turn.role === "child")
          .slice(-2)
          .map((turn) => turn.text),
        request.text,
      ],
    });
    const disposition = getRiskDisposition({
      level: assessment.level,
      primaryCategory: assessment.primaryCategory,
    });
    if (disposition.mode === "fixed_safety") {
      return childChatResponseSchema.parse({
        schemaVersion: CHILD_CHAT_SCHEMA_VERSION,
        requestId: request.requestId,
        route: "fixed_safety",
        level: disposition.level,
        title: disposition.title,
        steps: disposition.steps,
        notificationStatus: disposition.notificationStatus,
      });
    }
    return childChatResponseSchema.parse({
      schemaVersion: CHILD_CHAT_SCHEMA_VERSION,
      requestId: request.requestId,
      route: "reply",
      reply: await this.generate(principal, request),
    });
  }

  private async generate(
    principal: ChildPrincipal,
    request: ChildChatRequest,
  ): Promise<string> {
    if (this.runInternal === undefined) {
      return STATIC_FALLBACK_REPLY;
    }

    let rawResult: unknown;
    try {
      rawResult = await this.runInternal({
        requestId: request.requestId,
        text: request.text,
        ageBand: principal.ageBand,
        contentType: "knowledge",
        history: request.history ?? [],
      });
    } catch {
      return STATIC_FALLBACK_REPLY;
    }

    const parsed = internalAiOrchestrationResultSchema.safeParse(rawResult);
    if (!parsed.success) {
      return STATIC_FALLBACK_REPLY;
    }
    return parsed.data.reply;
  }

  private async authenticate(token: string): Promise<ChildPrincipal> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    const session = await this.database
      .selectFrom("access_sessions")
      .select([
        "role",
        "subject_id as subjectId",
        "child_id as childId",
        "revoked_at as revokedAt",
      ])
      .where("token_hash", "=", hashToken(token))
      .executeTakeFirst();
    if (session === undefined) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    if (session.role !== "child") {
      throw new PublicAppError("FORBIDDEN", 403);
    }
    if (session.childId === null) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    const child = await this.database
      .selectFrom("child_accounts")
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
