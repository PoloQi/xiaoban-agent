import { describe, expect, it } from "vitest";

import { childProfileLabels, type CompletedChildProfile } from "./profile";

describe("child profile labels", () => {
  it("maps persisted profile values to child-facing labels", () => {
    const profile: CompletedChildProfile = {
      alias: "小青禾",
      ageBand: "9_11",
      grade: "grade_6",
      interests: ["drawing", "reading", "tidying"],
      companion: "cloud",
      completedAt: "2026-08-31T12:00:00.000Z",
    };

    expect(childProfileLabels(profile)).toEqual({
      grade: "六年级",
      interests: ["画画", "阅读", "整理"],
    });
  });
});
