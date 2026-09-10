import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { FileMigrationProvider, Migrator } from "kysely/migration";

import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "./client.js";

const targetIsTest = process.argv.includes("--target=test");
const migrateDown = process.argv.includes("--down");
const migrationConfig = loadDatabaseConfig(process.env, "migration");
const config = targetIsTest
  ? {
      ...migrationConfig,
      database: loadDatabaseConfig(process.env, "test").database,
    }
  : migrationConfig;
const database = createDatabase(config);

try {
  await assertDatabaseBaseline(database);
  console.log("Database baseline verified.");
  const migrationFolder = fileURLToPath(new URL("./migrations", import.meta.url));
  const migrator = new Migrator({
    db: database,
    provider: new FileMigrationProvider({
      fs,
      path,
      migrationFolder,
      import: (filePath) => import(pathToFileURL(filePath).href),
    }),
  });
  const { error, results } = migrateDown
    ? await migrator.migrateDown()
    : await migrator.migrateToLatest();

  for (const result of results ?? []) {
    console.log(`${result.status}: ${result.migrationName}`);
  }
  if (error !== undefined) {
    throw new Error("DATABASE_MIGRATION_FAILED", { cause: error });
  }
} catch (error) {
  const databaseCode =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    typeof error.code === "string" &&
    /^[A-Z0-9_]+$/u.test(error.code)
      ? error.code
      : error instanceof Error && /^DATABASE_[A-Z0-9_]+$/u.test(error.message)
        ? error.message
        : "DATABASE_OPERATION_ERROR";
  console.error(`Database migration failed safely: ${databaseCode}.`);
  process.exitCode = 1;
} finally {
  await database.destroy();
}
