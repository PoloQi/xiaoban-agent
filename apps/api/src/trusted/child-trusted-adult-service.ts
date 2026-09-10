import { createHash } from "node:crypto";

import type { Kysely } from "kysely";

import {
  CHILD_TRUSTED_ADULTS_SCHEMA_VERSION,
  TRUSTED_ADULT_MAX,
  childTrustedAdultsResponseSchema,
  type ChildTrustedAdultsResponse,
  type TrustedAdultChannel,
  type TrustedAdultReachability,
  type TrustedAdultRelationship,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";

const RELATIONSHIP_LABELS: Record<TrustedAdultRelationship, string> = {
  family: "家人",
  teacher: "老师",
  other: "其他大人",
};

const CHANNEL_LABELS: Record<TrustedAdultChannel, string> = {
  face_to_face: "在家，可以当面说",
  scheduled_contact: "工作时间可以联系",
  not_configured: "还没有约定联系方式",
};

const REACHABILITY_LABELS: Record<TrustedAdultReachability, string> = {
  available_now: "现在就可以找",
  by_appointment: "需要先约时间",
  unavailable: "暂时联系不上",
};

function hashToken(token: string): Buffer {
  return createHash("sha256").update(token, "utf8").digest();
}

export class ChildTrustedAdultService {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async list(token: string): Promise<ChildTrustedAdultsResponse> {
    const childId = await this.authenticate(token);
    const rows = await this.database
      .selectFrom("child_trusted_adults")
      .select([
        "id as id",
        "adult_label as label",
        "relationship_kind as relationshipKind",
        "contact_channel as channel",
        "reachability as reachability",
        "verified_at as verifiedAt",
      ])
      .where("child_id", "=", childId)
      .where("status", "=", "active")
      .orderBy("verified_at", "asc")
      .orderBy("adult_label", "asc")
      .limit(TRUSTED_ADULT_MAX)
      .execute();

    return childTrustedAdultsResponseSchema.parse({
      schemaVersion: CHILD_TRUSTED_ADULTS_SCHEMA_VERSION,
      adults: rows.map((row) => ({
        id: row.id,
        label: row.label,
        relationship: row.relationshipKind,
        relationshipLabel: RELATIONSHIP_LABELS[row.relationshipKind],
        channel: row.channel,
        channelLabel: CHANNEL_LABELS[row.channel],
        reachability: row.reachability,
        reachabilityLabel: REACHABILITY_LABELS[row.reachability],
        verifiedAt: row.verifiedAt.toISOString(),
      })),
      notificationStatus: "not_sent",
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
