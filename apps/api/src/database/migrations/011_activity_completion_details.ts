import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE growth_attempts
      ADD COLUMN target_minutes SMALLINT UNSIGNED NULL AFTER activity_slug,
      ADD COLUMN feeling VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER target_minutes,
      ADD CONSTRAINT chk_growth_attempt_details CHECK (
        (source = 'manual' AND target_minutes IS NULL AND feeling IS NULL)
        OR (
          source = 'activity'
          AND target_minutes IS NOT NULL
          AND target_minutes BETWEEN 1 AND 120
          AND (feeling IS NULL OR feeling IN ('lighter', 'same', 'rest'))
        )
      )
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE growth_attempts
      DROP CONSTRAINT chk_growth_attempt_details,
      DROP COLUMN feeling,
      DROP COLUMN target_minutes
  `.execute(database);
}
