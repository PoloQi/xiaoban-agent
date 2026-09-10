import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    UPDATE growth_attempts AS attempt
    LEFT JOIN content_items AS item
      ON item.slug = attempt.activity_slug
      AND item.content_type = 'activity'
    LEFT JOIN content_versions AS version
      ON version.id = item.active_version_id
      AND version.item_id = item.id
    SET attempt.target_minutes = COALESCE(
      CAST(JSON_UNQUOTE(JSON_EXTRACT(version.content_body, '$.durationMinutes')) AS UNSIGNED),
      5
    )
    WHERE attempt.source = 'activity'
      AND attempt.target_minutes IS NULL
  `.execute(database);

  await sql`
    ALTER TABLE growth_attempts
      DROP CONSTRAINT chk_growth_attempt_details,
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
      ADD CONSTRAINT chk_growth_attempt_details CHECK (
        (source = 'manual' AND target_minutes IS NULL AND feeling IS NULL)
        OR (
          source = 'activity'
          AND target_minutes BETWEEN 1 AND 120
          AND (feeling IS NULL OR feeling IN ('lighter', 'same', 'rest'))
        )
      )
  `.execute(database);
}
