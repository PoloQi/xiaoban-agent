import { createHash, randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import {
  contentItemResponseSchema,
  contentVersionDraftSchema,
  type ContentCommandRequest,
  type ContentCreateItemRequest,
  type ContentCreateVersionRequest,
  type ContentDisableRequest,
  type ContentItemResponse,
  type ContentReviewRequest,
  type ContentVersionDraft,
  type ContentVersionSelectionRequest,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;
type OperatorRole = "content_author" | "content_reviewer";
type ContentCommandType = DatabaseSchema["content_commands"]["command_type"];

interface OperatorPrincipal {
  actorId: string;
  role: OperatorRole;
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function hashCommand(
  actorId: string,
  commandType: ContentCommandType,
  payload: unknown,
): string {
  return createHash("sha256")
    .update(JSON.stringify({ actorId, commandType, payload }), "utf8")
    .digest("hex");
}

function parseJson<T>(value: unknown): T {
  return (typeof value === "string" ? JSON.parse(value) : value) as T;
}

function toIso(value: Date): string {
  return value.toISOString();
}

function isDuplicateEntry(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "ER_DUP_ENTRY"
  );
}

export class ContentService {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async createItem(token: string, input: ContentCreateItemRequest): Promise<ContentItemResponse> {
    const principal = await this.authenticate(token, "content_author");
    return this.executeCommand(
      principal,
      input.requestId,
      "create_item",
      { slug: input.slug, draft: input.draft },
      async (transaction, now) => {
        const itemId = randomUUID();
        const versionId = randomUUID();
        try {
          await transaction.insertInto("content_items").values({
            id: itemId,
            content_type: input.draft.type,
            slug: input.slug,
            lifecycle_status: "draft",
            active_version_id: null,
            created_at: now,
            updated_at: now,
          }).execute();
        } catch (error) {
          if (isDuplicateEntry(error)) {
            throw new PublicAppError("CONTENT_SLUG_CONFLICT", 409);
          }
          throw error;
        }
        await this.insertVersion(
          transaction,
          itemId,
          versionId,
          1,
          principal.actorId,
          input.draft,
          now,
        );
        await this.writeAudit(transaction, principal, {
          action: "content.item.created",
          itemId,
          requestId: input.requestId,
          metadata: { versionId },
          now,
        });
        return itemId;
      },
    );
  }

  async createVersion(
    token: string,
    itemId: string,
    input: ContentCreateVersionRequest,
  ): Promise<ContentItemResponse> {
    const principal = await this.authenticate(token, "content_author");
    return this.executeCommand(
      principal,
      input.requestId,
      "create_version",
      { itemId, draft: input.draft },
      async (transaction, now) => {
        const item = await this.lockItem(transaction, itemId);
        if (item.lifecycle_status === "disabled" || item.content_type !== input.draft.type) {
          throw new PublicAppError("CONTENT_INVALID_STATE", 409);
        }
        const openVersion = await transaction
          .selectFrom("content_versions")
          .select("id")
          .where("item_id", "=", itemId)
          .where("review_status", "in", ["draft", "in_review"])
          .executeTakeFirst();
        if (openVersion !== undefined) {
          throw new PublicAppError("CONTENT_INVALID_STATE", 409);
        }
        const latest = await transaction
          .selectFrom("content_versions")
          .select("version_number as versionNumber")
          .where("item_id", "=", itemId)
          .orderBy("version_number", "desc")
          .executeTakeFirstOrThrow();
        const versionId = randomUUID();
        await this.insertVersion(
          transaction,
          itemId,
          versionId,
          latest.versionNumber + 1,
          principal.actorId,
          input.draft,
          now,
        );
        await transaction.updateTable("content_items").set({ updated_at: now })
          .where("id", "=", itemId).execute();
        await this.writeAudit(transaction, principal, {
          action: "content.version.created",
          itemId,
          requestId: input.requestId,
          metadata: { versionId, versionNumber: latest.versionNumber + 1 },
          now,
        });
        return itemId;
      },
    );
  }

  async submitVersion(
    token: string,
    itemId: string,
    versionId: string,
    input: ContentCommandRequest,
  ): Promise<ContentItemResponse> {
    const principal = await this.authenticate(token, "content_author");
    return this.executeCommand(
      principal,
      input.requestId,
      "submit_review",
      { itemId, versionId },
      async (transaction, now) => {
        await this.lockItem(transaction, itemId);
        const version = await this.lockVersion(transaction, itemId, versionId);
        if (version.author_id !== principal.actorId) {
          throw new PublicAppError("FORBIDDEN", 403);
        }
        if (version.review_status !== "draft") {
          throw new PublicAppError("CONTENT_INVALID_STATE", 409);
        }
        await transaction.updateTable("content_versions").set({ review_status: "in_review" })
          .where("id", "=", versionId).execute();
        await transaction.updateTable("content_items").set({ updated_at: now })
          .where("id", "=", itemId).execute();
        await this.writeAudit(transaction, principal, {
          action: "content.version.submitted",
          itemId,
          requestId: input.requestId,
          metadata: { versionId },
          now,
        });
        return itemId;
      },
    );
  }

  async reviewVersion(
    token: string,
    itemId: string,
    versionId: string,
    input: ContentReviewRequest,
  ): Promise<ContentItemResponse> {
    const principal = await this.authenticate(token, "content_reviewer");
    return this.executeCommand(
      principal,
      input.requestId,
      "review",
      { itemId, versionId, decision: input.decision, reason: input.reason },
      async (transaction, now) => {
        await this.lockItem(transaction, itemId);
        const version = await this.lockVersion(transaction, itemId, versionId);
        if (version.author_id === principal.actorId) {
          throw new PublicAppError("CONTENT_SELF_REVIEW", 422);
        }
        if (version.review_status !== "in_review") {
          throw new PublicAppError("CONTENT_INVALID_STATE", 409);
        }
        await transaction.insertInto("content_reviews").values({
          id: randomUUID(),
          version_id: versionId,
          author_id: version.author_id,
          reviewer_id: principal.actorId,
          decision: input.decision,
          reason: input.reason,
          created_at: now,
        }).execute();
        await transaction.updateTable("content_versions").set({
          review_status: input.decision,
        }).where("id", "=", versionId).execute();
        await transaction.updateTable("content_items").set({ updated_at: now })
          .where("id", "=", itemId).execute();
        await this.writeAudit(transaction, principal, {
          action: "content.version.reviewed",
          itemId,
          requestId: input.requestId,
          metadata: { versionId, decision: input.decision, reason: input.reason },
          now,
        });
        return itemId;
      },
    );
  }

  async publishVersion(
    token: string,
    itemId: string,
    input: ContentVersionSelectionRequest,
  ): Promise<ContentItemResponse> {
    const principal = await this.authenticate(token, "content_reviewer");
    return this.executeCommand(
      principal,
      input.requestId,
      "publish",
      { itemId, versionId: input.versionId },
      async (transaction, now) => {
        const item = await this.lockItem(transaction, itemId);
        const version = await this.lockVersion(transaction, itemId, input.versionId);
        if (
          item.lifecycle_status === "disabled" ||
          version.review_status !== "approved" ||
          item.active_version_id === input.versionId
        ) {
          throw new PublicAppError("CONTENT_INVALID_STATE", 409);
        }
        if (version.expires_at <= now) {
          throw new PublicAppError("CONTENT_EXPIRED", 410);
        }
        await transaction.updateTable("content_items").set({
          lifecycle_status: "published",
          active_version_id: input.versionId,
          updated_at: now,
        }).where("id", "=", itemId).execute();
        await this.writeAudit(transaction, principal, {
          action: "content.item.published",
          itemId,
          requestId: input.requestId,
          metadata: { versionId: input.versionId },
          now,
        });
        return itemId;
      },
    );
  }

  async disableItem(
    token: string,
    itemId: string,
    input: ContentDisableRequest,
  ): Promise<ContentItemResponse> {
    const principal = await this.authenticate(token, "content_reviewer");
    return this.executeCommand(
      principal,
      input.requestId,
      "disable",
      { itemId, reason: input.reason },
      async (transaction, now) => {
        const item = await this.lockItem(transaction, itemId);
        if (item.lifecycle_status !== "published") {
          throw new PublicAppError("CONTENT_INVALID_STATE", 409);
        }
        await transaction.updateTable("content_items").set({
          lifecycle_status: "disabled",
          updated_at: now,
        }).where("id", "=", itemId).execute();
        await this.writeAudit(transaction, principal, {
          action: "content.item.disabled",
          itemId,
          requestId: input.requestId,
          metadata: { reason: input.reason },
          now,
        });
        return itemId;
      },
    );
  }

  async rollbackItem(
    token: string,
    itemId: string,
    input: ContentVersionSelectionRequest,
  ): Promise<ContentItemResponse> {
    const principal = await this.authenticate(token, "content_reviewer");
    return this.executeCommand(
      principal,
      input.requestId,
      "rollback",
      { itemId, versionId: input.versionId },
      async (transaction, now) => {
        const item = await this.lockItem(transaction, itemId);
        if (item.lifecycle_status !== "published" || item.active_version_id === null) {
          throw new PublicAppError("CONTENT_INVALID_STATE", 409);
        }
        const current = await this.lockVersion(
          transaction,
          itemId,
          item.active_version_id,
        );
        const target = await this.lockVersion(transaction, itemId, input.versionId);
        if (
          target.review_status !== "approved" ||
          target.version_number >= current.version_number ||
          target.expires_at <= now
        ) {
          throw new PublicAppError(
            target.expires_at <= now ? "CONTENT_EXPIRED" : "CONTENT_INVALID_STATE",
            target.expires_at <= now ? 410 : 409,
          );
        }
        await transaction.updateTable("content_items").set({
          active_version_id: input.versionId,
          updated_at: now,
        }).where("id", "=", itemId).execute();
        await this.writeAudit(transaction, principal, {
          action: "content.item.rolled_back",
          itemId,
          requestId: input.requestId,
          metadata: {
            fromVersionId: item.active_version_id,
            toVersionId: input.versionId,
          },
          now,
        });
        return itemId;
      },
    );
  }

  async getItem(token: string, itemId: string): Promise<ContentItemResponse> {
    await this.authenticate(token, ["content_author", "content_reviewer"]);
    return this.readItem(this.database, itemId);
  }

  private async authenticate(
    token: string,
    expectedRoles: OperatorRole | OperatorRole[],
  ): Promise<OperatorPrincipal> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    const session = await this.database.selectFrom("access_sessions").select([
      "role",
      "subject_id as subjectId",
      "revoked_at as revokedAt",
    ]).where("token_hash", "=", hashToken(token)).executeTakeFirst();
    if (session === undefined || session.revokedAt !== null) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    const allowed = Array.isArray(expectedRoles) ? expectedRoles : [expectedRoles];
    if (
      (session.role !== "content_author" && session.role !== "content_reviewer") ||
      !allowed.includes(session.role)
    ) {
      throw new PublicAppError("FORBIDDEN", 403);
    }
    return { actorId: session.subjectId, role: session.role };
  }

  private async executeCommand(
    principal: OperatorPrincipal,
    requestId: string,
    commandType: ContentCommandType,
    payload: unknown,
    operation: (
      transaction: Transaction<DatabaseSchema>,
      now: Date,
    ) => Promise<string>,
  ): Promise<ContentItemResponse> {
    const requestHash = hashCommand(principal.actorId, commandType, payload);
    const existing = await this.readCommand(this.database, requestId);
    if (existing !== undefined) {
      return this.restoreCommand(existing, principal, commandType, requestHash);
    }

    try {
      return await this.database.transaction().execute(async (transaction) => {
        const inside = await this.readCommand(transaction, requestId);
        if (inside !== undefined) {
          return this.restoreCommand(inside, principal, commandType, requestHash);
        }
        const now = new Date();
        const itemId = await operation(transaction, now);
        const result = await this.readItem(transaction, itemId);
        await transaction.insertInto("content_commands").values({
          id: randomUUID(),
          request_id: requestId,
          actor_id: principal.actorId,
          command_type: commandType,
          request_hash: requestHash,
          target_item_id: itemId,
          result_body: JSON.stringify(result),
          created_at: now,
        }).execute();
        return result;
      });
    } catch (error) {
      const replay = await this.readCommand(this.database, requestId);
      if (replay !== undefined) {
        return this.restoreCommand(replay, principal, commandType, requestHash);
      }
      throw error;
    }
  }

  private async readCommand(database: DatabaseExecutor, requestId: string) {
    return database.selectFrom("content_commands").select([
      "actor_id as actorId",
      "command_type as commandType",
      "request_hash as requestHash",
      "result_body as resultBody",
    ]).where("request_id", "=", requestId).executeTakeFirst();
  }

  private restoreCommand(
    command: NonNullable<Awaited<ReturnType<ContentService["readCommand"]>>>,
    principal: OperatorPrincipal,
    commandType: ContentCommandType,
    requestHash: string,
  ): ContentItemResponse {
    if (
      command.actorId !== principal.actorId ||
      command.commandType !== commandType ||
      command.requestHash !== requestHash
    ) {
      throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
    }
    const parsed = contentItemResponseSchema.safeParse(parseJson(command.resultBody));
    if (!parsed.success) {
      throw new PublicAppError("INTERNAL_ERROR", 503);
    }
    return parsed.data;
  }

  private async lockItem(database: Transaction<DatabaseSchema>, itemId: string) {
    const item = await database.selectFrom("content_items").selectAll()
      .where("id", "=", itemId).forUpdate().executeTakeFirst();
    if (item === undefined) {
      throw new PublicAppError("CONTENT_NOT_FOUND", 404);
    }
    return item;
  }

  private async lockVersion(
    database: Transaction<DatabaseSchema>,
    itemId: string,
    versionId: string,
  ) {
    const version = await database.selectFrom("content_versions").selectAll()
      .where("item_id", "=", itemId).where("id", "=", versionId)
      .forUpdate().executeTakeFirst();
    if (version === undefined) {
      throw new PublicAppError("CONTENT_VERSION_NOT_FOUND", 404);
    }
    return version;
  }

  private async insertVersion(
    database: DatabaseExecutor,
    itemId: string,
    versionId: string,
    versionNumber: number,
    authorId: string,
    draft: ContentVersionDraft,
    now: Date,
  ): Promise<void> {
    await database.insertInto("content_versions").values({
      id: versionId,
      item_id: itemId,
      version_number: versionNumber,
      review_status: "draft",
      title: draft.title,
      summary: draft.summary,
      content_body: JSON.stringify(draft.body),
      age_band: draft.ageBand,
      source_kind: draft.source.kind,
      source_label: draft.source.label,
      source_url: draft.source.url ?? null,
      valid_from: new Date(draft.validFrom),
      expires_at: new Date(draft.expiresAt),
      risk_tags: JSON.stringify(draft.riskTags),
      author_id: authorId,
      created_at: now,
    }).execute();
  }

  private async readItem(
    database: DatabaseExecutor,
    itemId: string,
  ): Promise<ContentItemResponse> {
    const item = await database.selectFrom("content_items").selectAll()
      .where("id", "=", itemId).executeTakeFirst();
    if (item === undefined) {
      throw new PublicAppError("CONTENT_NOT_FOUND", 404);
    }
    const versions = await database.selectFrom("content_versions").selectAll()
      .where("item_id", "=", itemId).orderBy("version_number").execute();
    const versionIds = versions.map((version) => version.id);
    const reviews = versionIds.length === 0
      ? []
      : await database.selectFrom("content_reviews").selectAll()
        .where("version_id", "in", versionIds).execute();
    const reviewByVersion = new Map(reviews.map((review) => [review.version_id, review]));

    return contentItemResponseSchema.parse({
      itemId: item.id,
      type: item.content_type,
      slug: item.slug,
      lifecycleStatus: item.lifecycle_status,
      activeVersionId: item.active_version_id,
      createdAt: toIso(item.created_at),
      updatedAt: toIso(item.updated_at),
      versions: versions.map((version) => {
        const source = {
          kind: version.source_kind,
          label: version.source_label,
          ...(version.source_url === null ? {} : { url: version.source_url }),
        };
        const draft = contentVersionDraftSchema.parse({
          type: item.content_type,
          title: version.title,
          summary: version.summary,
          ageBand: version.age_band,
          source,
          validFrom: toIso(version.valid_from),
          expiresAt: toIso(version.expires_at),
          riskTags: parseJson(version.risk_tags),
          body: parseJson(version.content_body),
        });
        const review = reviewByVersion.get(version.id);
        return {
          versionId: version.id,
          versionNumber: version.version_number,
          reviewStatus: version.review_status,
          authorId: version.author_id,
          createdAt: toIso(version.created_at),
          draft,
          review: review === undefined
            ? null
            : {
                decision: review.decision,
                reviewerId: review.reviewer_id,
                reason: review.reason,
                reviewedAt: toIso(review.created_at),
              },
        };
      }),
    });
  }

  private async writeAudit(
    database: DatabaseExecutor,
    principal: OperatorPrincipal,
    input: {
      action: string;
      itemId: string;
      requestId: string;
      metadata: Record<string, unknown>;
      now: Date;
    },
  ): Promise<void> {
    await database.insertInto("audit_entries").values({
      id: randomUUID(),
      actor_type: "content_operator",
      actor_id: principal.actorId,
      action: input.action,
      target_type: "content_item",
      target_id: input.itemId,
      request_id: input.requestId,
      metadata: JSON.stringify(input.metadata),
      created_at: input.now,
    }).execute();
  }
}
