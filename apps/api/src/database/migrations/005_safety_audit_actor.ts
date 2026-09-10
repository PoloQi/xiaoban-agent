import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE audit_entries
      DROP CHECK chk_audit_actor_type,
      ADD CONSTRAINT chk_audit_actor_type CHECK (
        actor_type IN (
          'system',
          'guardian',
          'child',
          'content_operator',
          'safety_operator'
        )
      )
  `.execute(database);
}

export async function down(_database: Kysely<unknown>): Promise<void> {
  // Keep the additive actor value so rollback never requires deleting safety audit evidence.
}
