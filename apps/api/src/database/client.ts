import { Kysely, MysqlDialect, sql } from "kysely";
import { createPool } from "mysql2";

import type { DatabaseConfig } from "../config.js";
import type { DatabaseSchema } from "./types.js";

export function createDatabase(config: DatabaseConfig): Kysely<DatabaseSchema> {
  const pool = createPool({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: config.password,
    charset: "utf8mb4",
    connectionLimit: config.connectionLimit,
    connectTimeout: config.connectTimeoutMs,
    waitForConnections: true,
    queueLimit: 0,
    enableKeepAlive: false,
  });

  pool.on("connection", (connection) => {
    connection.query("SET SESSION time_zone = '+00:00'", (error) => {
      if (error) {
        connection.destroy();
      }
    });
  });

  return new Kysely<DatabaseSchema>({
    dialect: new MysqlDialect({ pool }),
  });
}

export async function assertDatabaseBaseline(
  database: Kysely<DatabaseSchema>,
): Promise<void> {
  const result = await sql<{
    characterSet: string;
    databaseName: string;
    storageEngine: string;
    timeZone: string;
    version: string;
  }>`
    SELECT
      VERSION() AS version,
      DATABASE() AS databaseName,
      @@default_storage_engine AS storageEngine,
      @@character_set_connection AS characterSet,
      @@session.time_zone AS timeZone
  `.execute(database);
  const row = result.rows[0];

  if (
    row === undefined ||
    !row.version.startsWith("8.4.") ||
    row.storageEngine !== "InnoDB" ||
    row.characterSet !== "utf8mb4" ||
    row.timeZone !== "+00:00" ||
    !["xiaoban_dev", "xiaoban_test"].includes(row.databaseName)
  ) {
    throw new Error("DATABASE_BASELINE_MISMATCH");
  }
}
