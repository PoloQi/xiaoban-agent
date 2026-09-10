import { describe, expect, it } from "vitest";

import { ConfigError, loadConfig } from "./config.js";

describe("loadConfig", () => {
  it("uses safe local defaults around a required database secret", () => {
    expect(loadConfig({ DATABASE_PASSWORD: "synthetic-password-value" })).toEqual({
      database: {
        connectionLimit: 5,
        connectTimeoutMs: 3000,
        database: "xiaoban_dev",
        host: "127.0.0.1",
        password: "synthetic-password-value",
        port: 3307,
        user: "xiaoban_app",
      },
      host: "127.0.0.1",
      nodeEnv: "development",
      port: 3000,
    });
  });

  it("parses explicit non-secret configuration", () => {
    expect(
      loadConfig({
        NODE_ENV: "test",
        XIAOBAN_API_HOST: "0.0.0.0",
        XIAOBAN_API_PORT: "4300",
        DATABASE_PASSWORD: "synthetic-password-value",
      }),
    ).toEqual({
      database: {
        connectionLimit: 5,
        connectTimeoutMs: 3000,
        database: "xiaoban_dev",
        host: "127.0.0.1",
        password: "synthetic-password-value",
        port: 3307,
        user: "xiaoban_app",
      },
      host: "0.0.0.0",
      nodeEnv: "test",
      port: 4300,
    });
  });

  it("fails without echoing an invalid configuration value", () => {
    const invalidValue = "not-a-port-private-marker";

    try {
      loadConfig({
        DATABASE_PASSWORD: "synthetic-password-value",
        XIAOBAN_API_PORT: invalidValue,
      });
      expect.unreachable("loadConfig should reject an invalid port");
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigError);
      expect((error as Error).message).toContain("XIAOBAN_API_PORT");
      expect((error as Error).message).not.toContain(invalidValue);
    }
  });

  it("fails safely when the database password is absent", () => {
    expect(() => loadConfig({})).toThrowError(ConfigError);

    try {
      loadConfig({});
    } catch (error) {
      expect((error as ConfigError).fields).toContain("DATABASE_PASSWORD");
      expect((error as Error).message).not.toContain("undefined");
    }
  });
});
