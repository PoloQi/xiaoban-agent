import { describe, expect, it } from "vitest";

import { advanceOnboarding } from "./onboarding-flow";

describe("onboarding entry flow", () => {
  it("starts with the boundary step instead of resuming content", () => {
    expect(advanceOnboarding("welcome")).toBe("boundaries");
  });

  it("continues from boundaries to profile setup", () => {
    expect(advanceOnboarding("boundaries")).toBe("setup");
  });
});
