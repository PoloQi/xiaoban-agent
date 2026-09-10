import { describe, expect, it } from "vitest";

import { DeepSeekConfigError, loadDeepSeekConfig } from "./model-config.js";

const syntheticKey = ["sk", "synthetic-stage4a-unit-key"].join("-");

describe("loadDeepSeekConfig", () => {
  it("uses the approved provider, model, timeout, and output limit", () => {
    expect(loadDeepSeekConfig({ DEEPSEEK_API_KEY: syntheticKey })).toEqual({
      apiKey: syntheticKey,
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-v4-pro",
      timeoutMs: 12_000,
      maxOutputTokens: 800,
    });
  });

  it("rejects an unapproved endpoint without echoing it", () => {
    const unapprovedEndpoint = "https://unapproved.invalid/private";
    try {
      loadDeepSeekConfig({
        DEEPSEEK_API_KEY: syntheticKey,
        DEEPSEEK_BASE_URL: unapprovedEndpoint,
      });
      expect.unreachable("configuration should reject an unapproved endpoint");
    } catch (error) {
      expect(error).toBeInstanceOf(DeepSeekConfigError);
      expect((error as DeepSeekConfigError).fields).toContain("DEEPSEEK_BASE_URL");
      expect((error as Error).message).not.toContain(unapprovedEndpoint);
    }
  });

  it("fails safely when the key is absent", () => {
    try {
      loadDeepSeekConfig({});
      expect.unreachable("configuration should require a server-side key");
    } catch (error) {
      expect(error).toBeInstanceOf(DeepSeekConfigError);
      expect((error as DeepSeekConfigError).fields).toContain("DEEPSEEK_API_KEY");
      expect((error as Error).message).not.toContain("undefined");
    }
  });
});
