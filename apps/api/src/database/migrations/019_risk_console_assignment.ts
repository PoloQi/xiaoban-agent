import { sql, type Kysely } from "kysely";

// 阶段6 风险工作台（Agent A）—— 纯追加：工单儿童归属/责任人列 + 独立 append-only 处置备注表。
// 不修改既有 risk_ticket_events 枚举、状态机、outbox 或 016/017 触发器。
export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE risk_tickets
      ADD COLUMN child_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER primary_category,
      ADD COLUMN claimed_by_guardian_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL AFTER child_id,
      ADD COLUMN claimed_at DATETIME(6) NULL AFTER claimed_by_guardian_id,
      ADD KEY idx_risk_ticket_console (child_id, status, created_at),
      ADD KEY idx_risk_ticket_assignee (claimed_by_guardian_id, status)
  `.execute(database);

  await sql`
    CREATE TABLE risk_ticket_console_notes (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      ticket_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      guardian_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      kind VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      note VARCHAR(240) NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_risk_console_note_request (request_id),
      KEY idx_risk_console_note_time (ticket_id, created_at, id),
      CONSTRAINT fk_risk_console_note_ticket FOREIGN KEY (ticket_id)
        REFERENCES risk_tickets(id) ON DELETE CASCADE,
      CONSTRAINT chk_risk_console_note_kind CHECK (
        kind IN ('claimed', 'disposition_note')
      ),
      CONSTRAINT chk_risk_console_note_text CHECK (
        note IS NULL OR CHAR_LENGTH(note) >= 10
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TRIGGER trg_risk_console_note_no_update
    BEFORE UPDATE ON risk_ticket_console_notes
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RISK_CONSOLE_NOTE_APPEND_ONLY'
  `.execute(database);

  await sql`
    CREATE TRIGGER trg_risk_console_note_no_delete
    BEFORE DELETE ON risk_ticket_console_notes
    FOR EACH ROW
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'RISK_CONSOLE_NOTE_APPEND_ONLY'
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_risk_console_note_no_delete`.execute(database);
  await sql`DROP TRIGGER IF EXISTS trg_risk_console_note_no_update`.execute(database);
  await sql`DROP TABLE IF EXISTS risk_ticket_console_notes`.execute(database);
  await sql`
    ALTER TABLE risk_tickets
      DROP INDEX idx_risk_ticket_assignee,
      DROP INDEX idx_risk_ticket_console,
      DROP COLUMN claimed_at,
      DROP COLUMN claimed_by_guardian_id,
      DROP COLUMN child_id
  `.execute(database);
}