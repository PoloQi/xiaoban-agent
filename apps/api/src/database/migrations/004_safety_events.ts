import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE safety_access_grants (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      token_hash BINARY(32) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      revoked_at DATETIME(6) NULL,
      UNIQUE KEY uq_safety_access_token (token_hash),
      KEY idx_safety_access_actor (actor_id, role),
      CONSTRAINT chk_safety_access_role CHECK (
        role IN ('duty_safety_officer', 'event_owner')
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE safety_events (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      synthetic BOOLEAN NOT NULL,
      case_reference VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      owner_actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      minimal_excerpt VARCHAR(280) NOT NULL,
      classification_snapshot JSON NOT NULL,
      detected_level VARCHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      detected_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      effective_level VARCHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      effective_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      retention_until DATETIME(6) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_safety_event_request (request_id),
      UNIQUE KEY uq_safety_event_case (case_reference),
      KEY idx_safety_event_owner_time (owner_actor_id, created_at),
      KEY idx_safety_event_retention (retention_until),
      CONSTRAINT chk_safety_event_synthetic CHECK (synthetic = TRUE),
      CONSTRAINT chk_safety_event_detected_level CHECK (detected_level IN ('L2', 'L3')),
      CONSTRAINT chk_safety_event_effective_level CHECK (
        effective_level IN ('L0', 'L1', 'L2', 'L3')
      ),
      CONSTRAINT chk_safety_event_status CHECK (status = 'open'),
      CONSTRAINT chk_safety_event_classification CHECK (
        JSON_TYPE(classification_snapshot) = 'OBJECT'
      ),
      CONSTRAINT chk_safety_event_retention CHECK (
        retention_until > created_at
        AND retention_until <= DATE_ADD(created_at, INTERVAL 90 DAY)
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE safety_event_overrides (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      event_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_role VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      prior_level VARCHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      prior_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      new_level VARCHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      new_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reason_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reason_note VARCHAR(240) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_safety_override_request (request_id),
      KEY idx_safety_override_event_time (event_id, created_at),
      CONSTRAINT fk_safety_override_event FOREIGN KEY (event_id) REFERENCES safety_events(id),
      CONSTRAINT chk_safety_override_role CHECK (
        actor_role IN ('duty_safety_officer', 'event_owner')
      ),
      CONSTRAINT chk_safety_override_prior_level CHECK (
        prior_level IN ('L0', 'L1', 'L2', 'L3')
      ),
      CONSTRAINT chk_safety_override_new_level CHECK (
        new_level IN ('L0', 'L1', 'L2', 'L3')
      ),
      CONSTRAINT chk_safety_override_changed CHECK (
        prior_level <> new_level OR prior_category <> new_category
      ),
      CONSTRAINT chk_safety_override_reason CHECK (
        reason_code IN (
          'false_positive',
          'context_clarified',
          'immediacy_changed',
          'category_corrected',
          'human_review'
        )
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TRIGGER trg_safety_override_no_update
    BEFORE UPDATE ON safety_event_overrides
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SAFETY_OVERRIDE_APPEND_ONLY'
  `.execute(database);
  await sql`
    CREATE TRIGGER trg_safety_override_no_delete
    BEFORE DELETE ON safety_event_overrides
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'SAFETY_OVERRIDE_APPEND_ONLY'
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_safety_override_no_delete`.execute(database);
  await sql`DROP TRIGGER IF EXISTS trg_safety_override_no_update`.execute(database);
  await sql`DROP TABLE IF EXISTS safety_event_overrides`.execute(database);
  await sql`DROP TABLE IF EXISTS safety_events`.execute(database);
  await sql`DROP TABLE IF EXISTS safety_access_grants`.execute(database);
}
