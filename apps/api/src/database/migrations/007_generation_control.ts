import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE generation_controls (
      scope VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reason_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      version INT UNSIGNED NOT NULL,
      updated_by CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      updated_at DATETIME(6) NOT NULL,
      CONSTRAINT chk_generation_control_scope CHECK (scope = 'global'),
      CONSTRAINT chk_generation_control_state CHECK (state IN ('running', 'stopped')),
      CONSTRAINT chk_generation_control_reason CHECK (
        reason_code IN (
          'initial_safety_default',
          'manual_safety_stop',
          'evaluation_failed',
          'dependency_failure',
          'manual_resume'
        )
      ),
      CONSTRAINT chk_generation_control_version CHECK (version > 0)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE generation_control_changes (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      scope VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      prior_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      new_state VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reason_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reason_note VARCHAR(240) NOT NULL,
      version INT UNSIGNED NOT NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_generation_control_request (request_id),
      KEY idx_generation_control_time (scope, created_at),
      CONSTRAINT fk_generation_control_scope FOREIGN KEY (scope)
        REFERENCES generation_controls(scope),
      CONSTRAINT chk_generation_control_change_states CHECK (
        prior_state IN ('running', 'stopped')
        AND new_state IN ('running', 'stopped')
        AND prior_state <> new_state
      ),
      CONSTRAINT chk_generation_control_change_reason CHECK (
        reason_code IN (
          'manual_safety_stop',
          'evaluation_failed',
          'dependency_failure',
          'manual_resume'
        )
      ),
      CONSTRAINT chk_generation_control_change_version CHECK (version > 1)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    INSERT INTO generation_controls (
      scope, state, reason_code, version, updated_by, updated_at
    ) VALUES (
      'global', 'stopped', 'initial_safety_default', 1, NULL, UTC_TIMESTAMP(6)
    )
  `.execute(database);

  await sql`
    CREATE TRIGGER trg_generation_control_change_no_update
    BEFORE UPDATE ON generation_control_changes
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'GENERATION_CONTROL_CHANGE_APPEND_ONLY'
  `.execute(database);
  await sql`
    CREATE TRIGGER trg_generation_control_change_no_delete
    BEFORE DELETE ON generation_control_changes
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'GENERATION_CONTROL_CHANGE_APPEND_ONLY'
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  const result = await sql<{ count: number }>`
    SELECT COUNT(*) AS count FROM generation_control_changes
  `.execute(database);
  if (Number(result.rows[0]?.count) > 0) {
    throw new Error("GENERATION_CONTROL_HISTORY_EXISTS");
  }
  await sql`DROP TRIGGER IF EXISTS trg_generation_control_change_no_delete`.execute(database);
  await sql`DROP TRIGGER IF EXISTS trg_generation_control_change_no_update`.execute(database);
  await sql`DROP TABLE IF EXISTS generation_control_changes`.execute(database);
  await sql`DROP TABLE IF EXISTS generation_controls`.execute(database);
}
