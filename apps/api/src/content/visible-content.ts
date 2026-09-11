import { createHash } from "node:crypto";

import type { Kysely } from "kysely";

import {
  childContentDetailSchema,
  contentVersionDraftSchema,
  type ChildContentDetail,
  type ChildContentSummary,
  type ContentVersionDraft,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";

export interface VisibleContentRow {
  ageBand: "9_11" | "12_14" | "both";
  body: unknown;
  contentType: "activity" | "knowledge";
  expiresAt: Date;
  sourceKind: "synthetic_test" | "official" | "institution_reviewed" | "local_pilot";
  sourceLabel: string;
  sourceUrl: string | null;
  slug: string;
  summary: string;
  title: string;
  validFrom: Date;
  versionId: string;
  reviewedAt: Date;
}

export const visibleContentSelection = [
  "version.id as versionId",
  "item.content_type as contentType",
  "item.slug",
  "version.title",
  "version.summary",
  "version.content_body as body",
  "version.age_band as ageBand",
  "version.source_kind as sourceKind",
  "version.source_label as sourceLabel",
  "version.source_url as sourceUrl",
  "version.valid_from as validFrom",
  "version.expires_at as expiresAt",
  "review.created_at as reviewedAt",
] as const;

function parseJson(value: unknown): unknown {
  return typeof value === "string" ? JSON.parse(value) : value;
}

function toIso(value: Date): string {
  return value.toISOString();
}

export function publicRevision(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex").slice(0, 16);
}

function readDraft(row: VisibleContentRow): ContentVersionDraft {
  return contentVersionDraftSchema.parse({
    type: row.contentType,
    title: row.title,
    summary: row.summary,
    ageBand: row.ageBand,
    source: {
      kind: row.sourceKind,
      label: row.sourceLabel,
      ...(row.sourceUrl === null ? {} : { url: row.sourceUrl }),
    },
    validFrom: toIso(row.validFrom),
    expiresAt: toIso(row.expiresAt),
    riskTags: [],
    body: parseJson(row.body),
  });
}

export function toChildContentSummary(row: VisibleContentRow): ChildContentSummary {
  const draft = readDraft(row);
  const common = {
    revision: publicRevision(row.versionId),
    slug: row.slug,
    title: draft.title,
    summary: draft.summary,
    sourceLabel: draft.source.label,
    expiresAt: draft.expiresAt,
  };
  return draft.type === "activity"
    ? {
        ...common,
        type: "activity",
        movement: draft.body.movement,
        durationMinutes: draft.body.durationMinutes,
        location: draft.body.location,
        adultSupervision: draft.body.adultSupervision,
      }
    : {
      ...common,
      type: "knowledge",
      topic: draft.body.topic,
      hasQuiz: draft.body.quiz !== undefined,
      };
}

export function toChildContentDetail(row: VisibleContentRow): ChildContentDetail {
  const draft = readDraft(row);
  const summary = toChildContentSummary(row);
  const detail = draft.type === "activity"
    ? {
      ...summary,
      type: "activity" as const,
      reviewLabel: "小伴内容审核组" as const,
      reviewedAt: toIso(row.reviewedAt),
      materials: draft.body.materials,
        steps: draft.body.steps,
      }
    : {
      ...summary,
      type: "knowledge" as const,
      reviewLabel: "小伴内容审核组" as const,
      reviewedAt: toIso(row.reviewedAt),
      paragraphs: draft.body.paragraphs,
      quiz: draft.body.quiz ?? null,
      };
  return childContentDetailSchema.parse(detail);
}

export function visibleContentQuery(
  database: Kysely<DatabaseSchema>,
  ageBand: "9_11" | "12_14",
  now: Date,
) {
  return database
    .selectFrom("content_items as item")
    .innerJoin("content_versions as version", (join) =>
      join
        .onRef("version.id", "=", "item.active_version_id")
        .onRef("version.item_id", "=", "item.id"),
    )
    .innerJoin("content_reviews as review", (join) =>
      join
        .onRef("review.version_id", "=", "version.id")
        .on("review.decision", "=", "approved"),
    )
    .where("item.lifecycle_status", "=", "published")
    .where("version.review_status", "=", "approved")
    .where("version.valid_from", "<=", now)
    .where("version.expires_at", ">", now)
    .where("version.age_band", "in", [ageBand, "both"]);
}
