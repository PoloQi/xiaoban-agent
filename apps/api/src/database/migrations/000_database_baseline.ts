import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`SELECT 1`.execute(database);
}

export async function down(): Promise<void> {}
