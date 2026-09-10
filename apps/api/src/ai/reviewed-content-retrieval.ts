import type { Kysely, Transaction } from "kysely";

import {
  REVIEWED_CONTENT_RETRIEVAL_POLICY_VERSION,
  reviewedContentRetrievalRequestSchema,
  reviewedContentRetrievalResultSchema,
  type ChildContentDetail,
  type ReviewedContentRetrievalResult,
} from "@xiaoban/contracts";

import {
  toChildContentDetail,
  visibleContentQuery,
  visibleContentSelection,
  type VisibleContentRow,
} from "../content/visible-content.js";
import type { DatabaseSchema } from "../database/types.js";

export type ReviewedContentRetrievalErrorCode =
  | "RETRIEVAL_REQUEST_INVALID"
  | "RETRIEVAL_UNAVAILABLE";

export class ReviewedContentRetrievalError extends Error {
  constructor(readonly code: ReviewedContentRetrievalErrorCode) {
    super(code);
    this.name = "ReviewedContentRetrievalError";
  }
}

interface RankedContent {
  score: number;
  content: ChildContentDetail;
}

function searchTokens(value: string): Set<string> {
  const normalized = value
    .normalize("NFKC")
    .replace(/\[[A-Z_]+\]/giu, " ")
    .toLocaleLowerCase("zh-CN");
  const tokens = new Set<string>();
  for (const word of normalized.match(/[a-z0-9]{2,}/gu) ?? []) {
    tokens.add(word);
  }
  for (const run of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.add(run.slice(index, index + 2));
    }
  }
  return tokens;
}

export function rankReviewedContent(
  query: string,
  contents: ChildContentDetail[],
  limit: number,
): RankedContent[] {
  const queryTokens = searchTokens(query);
  if (queryTokens.size === 0) return [];

  return contents
    .map((content) => {
      const titleTokens = searchTokens(content.title);
      const summaryTokens = searchTokens(content.summary);
      let score = 0;
      for (const token of queryTokens) {
        if (titleTokens.has(token)) score += 3;
        if (summaryTokens.has(token)) score += 1;
      }
      return { score, content };
    })
    .filter((item) => item.score > 0)
    .sort((left, right) =>
      right.score - left.score
      || (left.content.slug < right.content.slug
        ? -1
        : left.content.slug > right.content.slug ? 1 : 0),
    )
    .slice(0, limit);
}

export class ReviewedContentRetrievalService {
  constructor(
    private readonly database: Kysely<DatabaseSchema> | Transaction<DatabaseSchema>,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async retrieve(input: unknown): Promise<ReviewedContentRetrievalResult> {
    const request = reviewedContentRetrievalRequestSchema.safeParse(input);
    if (!request.success) {
      throw new ReviewedContentRetrievalError("RETRIEVAL_REQUEST_INVALID");
    }

    try {
      const rows = await visibleContentQuery(
        this.database,
        request.data.ageBand,
        this.now(),
      )
        .select(visibleContentSelection)
        .where("item.content_type", "=", request.data.contentType)
        .orderBy("item.slug")
        .execute();
      const contents = (rows as VisibleContentRow[]).map(toChildContentDetail);
      const items = rankReviewedContent(
        request.data.safeInput.sanitizedText,
        contents,
        request.data.limit,
      );

      return reviewedContentRetrievalResultSchema.parse({
        status: "retrieved",
        items,
        trace: {
          retrievalPolicyVersion: REVIEWED_CONTENT_RETRIEVAL_POLICY_VERSION,
          inputPolicyVersion: request.data.safeInput.policyVersion,
          ageBand: request.data.ageBand,
          contentType: request.data.contentType,
        },
      });
    } catch {
      throw new ReviewedContentRetrievalError("RETRIEVAL_UNAVAILABLE");
    }
  }
}
