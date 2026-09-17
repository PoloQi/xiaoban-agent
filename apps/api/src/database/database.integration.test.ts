import { afterAll, describe, expect, it } from "vitest";
import { sql } from "kysely";

import { errorResponseSchema, readinessResponseSchema } from "@xiaoban/contracts";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "./client.js";

const config = loadDatabaseConfig(process.env, "test");
const database = createDatabase(config);

afterAll(async () => {
  await database.destroy();
});

describe("MySQL integration", () => {
  it("meets the database baseline with the current product tables", async () => {
    await assertDatabaseBaseline(database);
    const result = await sql<{ tableName: string }>`
      SELECT table_name AS tableName
      FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name NOT IN ('kysely_migration', 'kysely_migration_lock')
      ORDER BY table_name
    `.execute(database);

    const tableNames = result.rows.map((row) => row.tableName);
    // This branch's migrations (001-018) create 29 business tables. The shared
    // local xiaoban_test database may additionally hold a parallel branch's 019
    // table, so assert the branch baseline as a floor plus the 018 tables rather
    // than an exact count (do not remove another branch's migration objects).
    expect(tableNames.length).toBeGreaterThanOrEqual(29);
    expect(tableNames).toContain("data_rights_requests");
    expect(tableNames).toContain("data_rights_request_events");
  });

  it("reports readiness when the database is available", async () => {
    const app = buildApp({ probeDatabase: () => assertDatabaseBaseline(database) });

    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/readiness" });
      expect(response.statusCode).toBe(200);
      expect(readinessResponseSchema.safeParse(response.json()).success).toBe(true);
    } finally {
      await app.close();
    }
  });

  it("requires persisted activity attempts to include target minutes", async () => {
    const result = await sql<{ checkClause: string }>`
      SELECT check_clause AS checkClause
      FROM information_schema.check_constraints
      WHERE constraint_schema = DATABASE()
        AND constraint_name = 'chk_growth_attempt_details'
    `.execute(database);

    expect(result.rows[0]?.checkClause.toLowerCase().replaceAll("`", ""))
      .toContain("target_minutes is not null");
  });

  it("fails closed without exposing connection details", async () => {
    const unavailableDatabase = createDatabase({
      ...config,
      port: 1,
      connectTimeoutMs: 250,
    });
    const app = buildApp({
      closeDatabase: () => unavailableDatabase.destroy(),
      probeDatabase: () => assertDatabaseBaseline(unavailableDatabase),
    });

    try {
      const response = await app.inject({ method: "GET", url: "/api/v1/readiness" });
      expect(response.statusCode).toBe(503);
      expect(errorResponseSchema.safeParse(response.json()).success).toBe(true);
      expect(response.json().error.code).toBe("DEPENDENCY_UNAVAILABLE");
      expect(response.body).not.toContain(config.database);
      expect(response.body).not.toContain(config.user);
    } finally {
      await app.close();
    }
  });
});
