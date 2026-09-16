import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE risk_tickets (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      synthetic BOOLEAN NOT NULL,
      case_reference VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      risk_level VARCHAR(2) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      primary_category VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      resolution VARCHAR(240) NULL,
      created_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_risk_ticket_request (request_id),
      UNIQUE KEY uq_risk_ticket_case (case_reference),
      KEY idx_risk_ticket_status_time (status, created_at),
      CONSTRAINT chk_risk_ticket_synthetic CHECK (synthetic = TRUE),
      CONSTRAINT chk_risk_ticket_level CHECK (risk_level IN ('L2', 'L3')),
      CONSTRAINT chk_risk_ticket_category CHECK (
        primary_category IN (
          'bullying',
          'abuse_exploitation',
          'fraud_privacy',
          'dangerous_imitation',
          'self_harm',
          'harm_to_others',
          'active_danger'
        )
      ),
      CONSTRAINT chk_risk_ticket_status CHECK (
        status IN (
          'open',
          'waiting_for_acknowledgement',
          'escalated',
          'acknowledged',
          'resolved',
          'closed'
        )
      ),
      CONSTRAINT chk_risk_ticket_resolution CHECK (
        resolution IS NULL OR CHAR_LENGTH(resolution) >= 10
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE risk_ticket_notification_outbox (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      ticket_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      channel VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      attempts TINYINT UNSIGNED NOT NULL,
      delivered_at DATETIME(6) NULL,
      viewed_at DATETIME(6) NULL,
      acknowledged_at DATETIME(6) NULL,
      failed_at DATETIME(6) NULL,
      timed_out_at DATETIME(6) NULL,
      created_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_risk_ticket_channel (ticket_id, channel),
      KEY idx_risk_outbox_status (status, updated_at),
      CONSTRAINT fk_risk_outbox_ticket FOREIGN KEY (ticket_id)
        REFERENCES risk_tickets(id) ON DELETE CASCADE,
      CONSTRAINT chk_risk_outbox_channel CHECK (
        channel IN ('in_app', 'off_site_backup')
      ),
      CONSTRAINT chk_risk_outbox_status CHECK (
        status IN (
          'not_sent',
          'attempted',
          'delivered',
          'viewed',
          'acknowledged',
          'failed',
          'timed_out'
        )
      ),
      CONSTRAINT chk_risk_outbox_attempts CHECK (attempts BETWEEN 0 AND 2)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE risk_ticket_events (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      ticket_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      action VARCHAR(48) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      channel VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NULL,
      disposition_note VARCHAR(240) NULL,
      occurred_at DATETIME(6) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_risk_ticket_event_request (request_id),
      KEY idx_risk_ticket_event_time (ticket_id, occurred_at, id),
      CONSTRAINT fk_risk_ticket_event_ticket FOREIGN KEY (ticket_id)
        REFERENCES risk_tickets(id) ON DELETE CASCADE,
      CONSTRAINT chk_risk_ticket_event_action CHECK (
        action IN (
          'record_send_attempted',
          'record_delivered',
          'record_viewed',
          'record_acknowledged',
          'record_failed',
          'record_timed_out',
          'escalate_for_immediate_human_review',
          'resolve',
          'close'
        )
      ),
      CONSTRAINT chk_risk_ticket_event_channel CHECK (
        channel IS NULL OR channel IN ('in_app', 'off_site_backup')
      ),
      CONSTRAINT chk_risk_ticket_event_note CHECK (
        disposition_note IS NULL OR CHAR_LENGTH(disposition_note) >= 10
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TRIGGER trg_risk_ticket_event_no_update
    BEFORE UPDATE ON risk_ticket_events
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RISK_TICKET_EVENT_APPEND_ONLY'
  `.execute(database);

  await sql`
    CREATE TRIGGER trg_risk_ticket_event_no_delete
    BEFORE DELETE ON risk_ticket_events
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RISK_TICKET_EVENT_APPEND_ONLY'
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_risk_ticket_event_no_delete`.execute(database);
  await sql`DROP TRIGGER IF EXISTS trg_risk_ticket_event_no_update`.execute(database);
  await sql`DROP TABLE IF EXISTS risk_ticket_events`.execute(database);
  await sql`DROP TABLE IF EXISTS risk_ticket_notification_outbox`.execute(database);
  await sql`DROP TABLE IF EXISTS risk_tickets`.execute(database);
}