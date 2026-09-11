import { createHash } from "node:crypto";

import type { Kysely } from "kysely";

import {
  CHILD_CHAT_SCHEMA_VERSION,
  TRUSTED_ADULT_OPENING_LINE,
  childChatResponseSchema,
  internalAiOrchestrationResultSchema,
  type ChildActivitySummary,
  type ChildChatRequest,
  type ChildChatResponse,
  type InternalAiOrchestrationRequest,
} from "@xiaoban/contracts";

import {
  toChildContentSummary,
  visibleContentQuery,
  visibleContentSelection,
  type VisibleContentRow,
} from "../content/visible-content.js";
import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";
import { getRiskDisposition } from "../safety/risk-policy.js";
import { assessRiskWithRules } from "../safety/risk-rule-engine.js";

const STATIC_FALLBACK_REPLY =
  "我现在暂时不能回答，可以先暂停一下，稍后再试；需要帮助时请找身边可信任的成年人。";

const BOREDOM_REPLY =
  "无聊的时候，手很容易自己去点短视频。我们不急着硬忍。你现在更想动一动，还是安静做点事？";
const BOREDOM_SUGGESTED_REPLIES = ["想动一动", "安静做点事"] as const;

const MOVE_REPLY =
  "好，我们不选太多。我找了几个能让身体动起来的小活动，每个都不超过10分钟。";
const QUIET_REPLY =
  "好，我们不选太多。我找了几个安静、简单的小活动，每个都不超过10分钟。";

const BOREDOM_PATTERN = /(无聊|刷视频|短视频|没事做|不知道做什么|好没意思)/u;
const MOVE_PATTERN = /(想动|动一动|动起来|活动一下|跑一跑|跳一跳|运动)/u;
const QUIET_PATTERN = /(安静|静一点|坐下来|慢一点|安安静静)/u;

const LONELY_TRIGGER_PATTERN =
  /(想念|想家|想爸妈|想爸爸|想妈妈|想同学|想朋友|想外婆|爸妈|爸爸妈妈|很久没|很久不|好久没)/u;
const LONELY_EMOTION_PATTERN = /^(很想念|有点难过|有点委屈)$/u;
const LONELY_CONNECT_GRANDMA_PATTERN = /(请外婆帮我联系|请外婆|帮我联系)/u;
const LONELY_CONNECT_SELF_PATTERN = /(我想先自己写下来|先写下来|先做一分钟呼吸|做一分钟呼吸)/u;

const LONELY_TRIGGER_REPLY =
  "听起来，你心里装着很多想念。现在的感觉更接近「想念」「有点难过」，还是「有点委屈」？";
const LONELY_TRIGGER_SUGGESTED_REPLIES = ["很想念", "有点难过", "有点委屈"] as const;

const LONELY_EMOTION_REPLY =
  "谢谢你告诉我。想念一个人并不丢脸。我们可以先准备一句话再去联系家人，你想现在做哪一件小事？";
const LONELY_EMOTION_SUGGESTED_REPLIES = [
  "请外婆帮我联系",
  "我想先自己写下来",
  "先做一分钟呼吸",
] as const;

const LONELY_SELF_REPLY =
  "好。你可以从这句开始：「我今天很想你，我想告诉你一件小事。」写好以后再决定要不要发出去。";
const LONELY_SELF_SUGGESTED_REPLIES = ["先聊到这里"] as const;

const LONELY_GRANDMA_REPLY =
  "我们可以先准备好一句开口的话，再去请外婆帮忙联系家人。";
const LONELY_GRANDMA_SUGGESTED_REPLIES = ["先聊到这里"] as const;

function detectMovementChoice(text: string): "move" | "quiet" | null {
  if (QUIET_PATTERN.test(text)) return "quiet";
  if (MOVE_PATTERN.test(text)) return "move";
  return null;
}

function detectBoredom(text: string): boolean {
  return BOREDOM_PATTERN.test(text);
}

function detectLonelyTrigger(text: string): boolean {
  return LONELY_TRIGGER_PATTERN.test(text);
}

function detectLonelyEmotion(text: string): boolean {
  return LONELY_EMOTION_PATTERN.test(text);
}

function detectLonelyGrandma(text: string): boolean {
  return LONELY_CONNECT_GRANDMA_PATTERN.test(text);
}

function detectLonelySelf(text: string): boolean {
  return LONELY_CONNECT_SELF_PATTERN.test(text);
}

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
    const movement = detectMovementChoice(request.text);
    if (movement !== null) {
      return this.recommendActivities(principal, request, movement);
    }
    if (detectBoredom(request.text)) {
      return childChatResponseSchema.parse({
        schemaVersion: CHILD_CHAT_SCHEMA_VERSION,
        requestId: request.requestId,
        route: "reply",
        reply: BOREDOM_REPLY,
        suggestedReplies: BOREDOM_SUGGESTED_REPLIES,
      });
    }
    if (detectLonelyEmotion(request.text)) {
      return childChatResponseSchema.parse({
        schemaVersion: CHILD_CHAT_SCHEMA_VERSION,
        requestId: request.requestId,
        route: "reply",
        reply: LONELY_EMOTION_REPLY,
        suggestedReplies: LONELY_EMOTION_SUGGESTED_REPLIES,
      });
    }
    if (detectLonelyTrigger(request.text)) {
      return childChatResponseSchema.parse({
        schemaVersion: CHILD_CHAT_SCHEMA_VERSION,
        requestId: request.requestId,
        route: "reply",
        reply: LONELY_TRIGGER_REPLY,
        suggestedReplies: LONELY_TRIGGER_SUGGESTED_REPLIES,
      });
    }
    if (detectLonelySelf(request.text)) {
      return childChatResponseSchema.parse({
        schemaVersion: CHILD_CHAT_SCHEMA_VERSION,
        requestId: request.requestId,
        route: "reply",
        reply: LONELY_SELF_REPLY,
        suggestedReplies: LONELY_SELF_SUGGESTED_REPLIES,
      });
    }
    if (detectLonelyGrandma(request.text)) {
      return childChatResponseSchema.parse({
        schemaVersion: CHILD_CHAT_SCHEMA_VERSION,
        requestId: request.requestId,
        route: "lonely_connection",
        reply: LONELY_GRANDMA_REPLY,
        connectionLabel: "外婆",
        contactIntention: "trusted_adult",
        openingLine: TRUSTED_ADULT_OPENING_LINE,
        suggestedReplies: LONELY_GRANDMA_SUGGESTED_REPLIES,
      });
    }
    return childChatResponseSchema.parse({
      schemaVersion: CHILD_CHAT_SCHEMA_VERSION,
      requestId: request.requestId,
      route: "reply",
      reply: await this.generate(principal, request),
    });
  }

  private async recommendActivities(
    principal: ChildPrincipal,
    request: ChildChatRequest,
    movement: "move" | "quiet",
  ): Promise<ChildChatResponse> {
    const rows = await visibleContentQuery(this.database, principal.ageBand, new Date())
      .select(visibleContentSelection)
      .where("item.content_type", "=", "activity")
      .orderBy("item.slug")
      .execute();
    const activities = (rows as VisibleContentRow[])
      .map(toChildContentSummary)
      .filter((item): item is ChildActivitySummary =>
        item.type === "activity" && item.movement === movement)
      .slice(0, 3);
    if (activities.length === 0) {
      return childChatResponseSchema.parse({
        schemaVersion: CHILD_CHAT_SCHEMA_VERSION,
        requestId: request.requestId,
        route: "reply",
        reply: "现在手边还没有合适的活动，我们可以先聊点别的，或者稍后再来看看。",
      });
    }
    return childChatResponseSchema.parse({
      schemaVersion: CHILD_CHAT_SCHEMA_VERSION,
      requestId: request.requestId,
      route: "activity_recommendations",
      movement,
      reply: movement === "move" ? MOVE_REPLY : QUIET_REPLY,
      activities,
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
