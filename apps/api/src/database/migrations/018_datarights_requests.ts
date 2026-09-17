import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE data_rights_requests (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      guardian_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      child_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      synthetic BOOLEAN NOT NULL,
      request_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reason_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      child_status_after VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      effective_at DATETIME(6) NULL,
      created_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_data_rights_request (request_id),
      KEY idx_data_rights_guardian_child (guardian_id, child_id, created_at),
      CONSTRAINT fk_data_rights_guardian FOREIGN KEY (guardian_id)
        REFERENCES guardian_accounts(id),
      CONSTRAINT fk_data_rights_child FOREIGN KEY (child_id)
        REFERENCES child_accounts(id),
      CONSTRAINT chk_data_rights_synthetic CHECK (synthetic = TRUE),
      CONSTRAINT chk_data_rights_type CHECK (request_type IN ('delete', 'export')),
      CONSTRAINT chk_data_rights_reason CHECK (reason_code IN ('privacy_request', 'guardian_choice', 'pilot_exit')),
      CONSTRAINT chk_data_rights_status CHECK (status IN ('received', 'queued', 'processing', 'completed')),
      CONSTRAINT chk_data_rights_child_status CHECK (child_status_after IN ('active', 'deactivated'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE data_rights_request_events (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      data_rights_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      event_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      sequence_no INT UNSIGNED NOT NULL,
      action VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_guardian_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      event_metadata JSON NOT NULL,
      occurred_at DATETIME(6) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_data_rights_event_request (event_request_id),
      UNIQUE KEY uq_data_rights_event_action (data_rights_request_id, action),
      UNIQUE KEY uq_data_rights_event_sequence (data_rights_request_id, sequence_no),
      KEY idx_data_rights_event_origin_request (request_id),
      KEY idx_data_rights_event_target_time (data_rights_request_id, occurred_at, id),
      CONSTRAINT fk_data_rights_event_request FOREIGN KEY (data_rights_request_id)
        REFERENCES data_rights_requests(id) ON DELETE CASCADE,
      CONSTRAINT fk_data_rights_event_guardian FOREIGN KEY (actor_guardian_id)
        REFERENCES guardian_accounts(id),
      CONSTRAINT chk_data_rights_event_action CHECK (
        action IN ('request_received', 'export_queued', 'functional_deletion_completed')
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TRIGGER trg_data_rights_event_no_update
    BEFORE UPDATE ON data_rights_request_events
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DATA_RIGHTS_EVENT_APPEND_ONLY'
  `.execute(database);

  await sql`
    CREATE TRIGGER trg_data_rights_event_no_delete
    BEFORE DELETE ON data_rights_request_events
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'DATA_RIGHTS_EVENT_APPEND_ONLY'
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_data_rights_event_no_delete`.execute(database);
  await sql`DROP TRIGGER IF EXISTS trg_data_rights_event_no_update`.execute(database);
  await sql`DROP TABLE IF EXISTS data_rights_request_events`.execute(database);
  await sql`DROP TABLE IF EXISTS data_rights_requests`.execute(database);
}
