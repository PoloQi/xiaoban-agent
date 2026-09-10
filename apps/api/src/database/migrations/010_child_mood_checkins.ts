import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE child_mood_checkins (
      child_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      mood VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NULL,
      local_date DATE NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_child_mood_request (request_id),
      CONSTRAINT fk_child_mood_child FOREIGN KEY (child_id)
        REFERENCES child_accounts(id) ON DELETE CASCADE,
      CONSTRAINT chk_child_mood_value CHECK (
        mood IS NULL OR mood IN ('happy', 'calm', 'bored', 'sad', 'angry', 'worried')
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS child_mood_checkins`.execute(database);
}
