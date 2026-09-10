import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE child_profiles (
      child_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      completion_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      grade VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      interests JSON NOT NULL,
      companion VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      completed_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_child_profile_completion_request (completion_request_id),
      CONSTRAINT fk_child_profile_child FOREIGN KEY (child_id)
        REFERENCES child_accounts(id) ON DELETE CASCADE,
      CONSTRAINT chk_child_profile_grade CHECK (
        grade IN ('grade_4', 'grade_5', 'grade_6', 'grade_7', 'grade_8')
      ),
      CONSTRAINT chk_child_profile_companion CHECK (
        companion IN ('sprout', 'cloud', 'kite')
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS child_profiles`.execute(database);
}
