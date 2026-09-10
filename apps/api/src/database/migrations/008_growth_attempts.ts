import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE growth_attempts (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      child_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      goal_key VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      activity_slug VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NULL,
      local_date DATE NOT NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_growth_attempt_request (request_id),
      KEY idx_growth_attempt_child_week (child_id, local_date, created_at),
      KEY idx_growth_attempt_activity (activity_slug),
      CONSTRAINT fk_growth_attempt_child FOREIGN KEY (child_id)
        REFERENCES child_accounts(id) ON DELETE CASCADE,
      CONSTRAINT chk_growth_attempt_goal CHECK (goal_key = 'screen-free-bedtime-30m'),
      CONSTRAINT chk_growth_attempt_source CHECK (source IN ('manual', 'activity')),
      CONSTRAINT chk_growth_attempt_activity CHECK (
        (source = 'manual' AND activity_slug IS NULL)
        OR (source = 'activity' AND activity_slug IS NOT NULL)
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS growth_attempts`.execute(database);
}
