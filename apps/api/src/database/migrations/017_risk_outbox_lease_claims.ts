import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE risk_ticket_notification_outbox
      ADD COLUMN lease_owner_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER attempts,
      ADD COLUMN leased_at DATETIME(6) NULL AFTER lease_owner_id,
      ADD COLUMN lease_expires_at DATETIME(6) NULL AFTER leased_at,
      ADD COLUMN lease_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER lease_expires_at,
      ADD KEY idx_risk_outbox_lease (status, lease_expires_at, created_at),
      ADD KEY idx_risk_outbox_claim_order (status, created_at, channel)
  `.execute(database);

  await sql`
    CREATE TABLE risk_ticket_outbox_claims (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      outbox_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      ticket_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      claim_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      worker_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      lease_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      leased_at DATETIME(6) NOT NULL,
      lease_expires_at DATETIME(6) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_risk_outbox_claim_request (claim_request_id),
      UNIQUE KEY uq_risk_outbox_claim_token (lease_token),
      KEY idx_risk_outbox_claim_outbox_time (outbox_id, leased_at, id),
      KEY idx_risk_outbox_claim_worker_time (worker_id, leased_at),
      CONSTRAINT fk_risk_outbox_claim_outbox FOREIGN KEY (outbox_id)
        REFERENCES risk_ticket_notification_outbox(id) ON DELETE CASCADE,
      CONSTRAINT fk_risk_outbox_claim_ticket FOREIGN KEY (ticket_id)
        REFERENCES risk_tickets(id) ON DELETE CASCADE,
      CONSTRAINT chk_risk_outbox_claim_expiry CHECK (lease_expires_at > leased_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TRIGGER trg_risk_outbox_claim_no_update
    BEFORE UPDATE ON risk_ticket_outbox_claims
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RISK_OUTBOX_CLAIM_APPEND_ONLY'
  `.execute(database);

  await sql`
    CREATE TRIGGER trg_risk_outbox_claim_no_delete
    BEFORE DELETE ON risk_ticket_outbox_claims
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RISK_OUTBOX_CLAIM_APPEND_ONLY'
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_risk_outbox_claim_no_delete`.execute(database);
  await sql`DROP TRIGGER IF EXISTS trg_risk_outbox_claim_no_update`.execute(database);
  await sql`DROP TABLE IF EXISTS risk_ticket_outbox_claims`.execute(database);
  await sql`
    ALTER TABLE risk_ticket_notification_outbox
      DROP INDEX idx_risk_outbox_claim_order,
      DROP INDEX idx_risk_outbox_lease,
      DROP COLUMN lease_count,
      DROP COLUMN lease_expires_at,
      DROP COLUMN leased_at,
      DROP COLUMN lease_owner_id
  `.execute(database);
}