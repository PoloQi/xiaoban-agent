import { createHash } from "node:crypto";

import type { Kysely } from "kysely";

import {
  childContentListResponseSchema,
  type ChildContentDetail,
  type ChildContentListQuery,
  type ChildContentListResponse,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";
import {
  publicRevision,
  toChildContentDetail,
  toChildContentSummary,
  visibleContentQuery,
  visibleContentSelection,
  type VisibleContentRow,
} from "./visible-content.js";

interface ChildPrincipal {
  ageBand: "9_11" | "12_14";
  childId: string;
}

interface ChildContentReference {
  slug: string;
  versionId: string;
}

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

function catalogRevision(references: ChildContentReference[]): string {
  return publicRevision(
    references.map(({ slug, versionId }) => `${slug}:${publicRevision(versionId)}`).join("\n"),
  );
}

export class ChildContentService {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async list(
    token: string,
    query: ChildContentListQuery,
  ): Promise<ChildContentListResponse> {
    const principal = await this.authenticate(token);
    const now = new Date();
    let referencesQuery = visibleContentQuery(this.database, principal.ageBand, now)
      .select(["item.slug", "version.id as versionId"]);
    let itemsQuery = visibleContentQuery(this.database, principal.ageBand, now)
      .select(visibleContentSelection);
    if (query.type !== "all") {
      referencesQuery = referencesQuery.where("item.content_type", "=", query.type);
      itemsQuery = itemsQuery.where("item.content_type", "=", query.type);
    }
    const [references, rows] = await Promise.all([
      referencesQuery.orderBy("item.slug").execute(),
      itemsQuery.orderBy("item.updated_at", "desc")
        .orderBy("item.slug")
        .limit(query.limit)
        .offset(query.offset)
        .execute(),
    ]);

    return childContentListResponseSchema.parse({
      items: (rows as VisibleContentRow[]).map(toChildContentSummary),
      catalogRevision: catalogRevision(references as ChildContentReference[]),
      pagination: {
        limit: query.limit,
        offset: query.offset,
        total: references.length,
      },
    });
  }

  async get(token: string, slug: string): Promise<ChildContentDetail> {
    const principal = await this.authenticate(token);
    const row = await visibleContentQuery(this.database, principal.ageBand, new Date())
      .select(visibleContentSelection)
      .where("item.slug", "=", slug)
      .executeTakeFirst();
    if (row === undefined) {
      throw new PublicAppError("CONTENT_NOT_FOUND", 404);
    }
    return toChildContentDetail(row as VisibleContentRow);
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
