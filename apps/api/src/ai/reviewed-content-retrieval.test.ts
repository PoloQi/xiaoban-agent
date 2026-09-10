import { describe, expect, it } from "vitest";

import type { Kysely } from "kysely";

import type { ChildContentDetail } from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import {
  ReviewedContentRetrievalError,
  ReviewedContentRetrievalService,
  rankReviewedContent,
} from "./reviewed-content-retrieval.js";

const requestId = "019c111a-f9e0-7dd8-a24c-6dfd908bb620";

function knowledge(
  slug: string,
  title: string,
  summary: string,
): ChildContentDetail {
  return {
    type: "knowledge",
    revision: "fedcba9876543210",
    slug,
    title,
    summary,
    sourceLabel: "本地合成验证内容",
    expiresAt: "2027-08-20T00:00:00.000Z",
    topic: "general_growth",
    paragraphs: ["仅用于合成检索测试。"],
  };
}

describe("rankReviewedContent", () => {
  it("uses title-weighted deterministic matching, drops zero scores, and limits results", () => {
    const ranked = rankReviewedContent("想找屏幕休息方法", [
      knowledge("synthetic-summary-match", "看看远处", "离开屏幕休息一下。"),
      knowledge("synthetic-title-z", "屏幕休息方法", "短暂休息。"),
      knowledge("synthetic-title-a", "屏幕休息方法", "短暂休息。"),
      knowledge("synthetic-zero", "观察天空", "看看云朵。"),
    ], 3);

    expect(ranked.map((item) => item.content.slug)).toEqual([
      "synthetic-title-a",
      "synthetic-title-z",
      "synthetic-summary-match",
    ]);
    expect(ranked[0]?.score).toBe(ranked[1]?.score);
    expect(ranked[1]?.score).toBeGreaterThan(ranked[2]?.score ?? 0);
    expect(ranked.every((item) => item.score > 0)).toBe(true);
  });
});

describe("ReviewedContentRetrievalService", () => {
  it("rejects blocked input before touching the database", async () => {
    let databaseTouched = false;
    const database = new Proxy({}, {
      get() {
        databaseTouched = true;
        throw new Error("database must not be touched");
      },
    }) as Kysely<DatabaseSchema>;
    const service = new ReviewedContentRetrievalService(database);

    await expect(service.retrieve({
      requestId,
      safeInput: {
        decision: "block",
        policyVersion: "input-deidentification-2026-08-v1",
        reasonCodes: ["possible_name"],
      },
      ageBand: "9_11",
      contentType: "knowledge",
      limit: 2,
    })).rejects.toMatchObject({ code: "RETRIEVAL_REQUEST_INVALID" });
    expect(databaseTouched).toBe(false);
  });

  it("maps database errors to a stable code without leaking details", async () => {
    const privateDetail = "synthetic private database detail";
    const database = new Proxy({}, {
      get() {
        throw new Error(privateDetail);
      },
    }) as Kysely<DatabaseSchema>;
    const service = new ReviewedContentRetrievalService(database);
    const input = {
      requestId,
      safeInput: {
        decision: "allow" as const,
        policyVersion: "input-deidentification-2026-08-v1" as const,
        sanitizedText: "屏幕休息方法",
        redactedCategories: [],
      },
      ageBand: "9_11" as const,
      contentType: "knowledge" as const,
      limit: 2,
    };

    await expect(service.retrieve(input)).rejects.toMatchObject({
      code: "RETRIEVAL_UNAVAILABLE",
    });
    try {
      await service.retrieve(input);
    } catch (error) {
      expect(error).toBeInstanceOf(ReviewedContentRetrievalError);
      expect((error as Error).message).not.toContain(privateDetail);
    }
  });
});
