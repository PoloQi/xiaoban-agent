import { describe, expect, it } from "vitest";

import {
  ACTIVITY_ENCOURAGEMENTS,
  ACTIVITY_TARGET_OPTIONS,
  chooseEncouragement,
  formatRemainingSeconds,
  parseCustomTarget,
} from "./activity-timer";

describe("activity timer", () => {
  it("offers the three approved target durations", () => {
    expect(ACTIVITY_TARGET_OPTIONS).toEqual([5, 10, 15]);
  });

  it("accepts custom minutes only within the activity limit", () => {
    expect(parseCustomTarget("12", 15)).toBe(12);
    expect(parseCustomTarget("16", 15)).toBeNull();
    expect(parseCustomTarget("0", 15)).toBeNull();
  });

  it("chooses a fixed local encouragement", () => {
    expect(chooseEncouragement(() => 0)).toBe(ACTIVITY_ENCOURAGEMENTS[0]);
    expect(chooseEncouragement(() => 0.99)).toBe(ACTIVITY_ENCOURAGEMENTS.at(-1));
  });

  it("formats remaining time for the child-facing timer", () => {
    expect(formatRemainingSeconds(605)).toBe("10:05");
    expect(formatRemainingSeconds(-2)).toBe("00:00");
  });
});
