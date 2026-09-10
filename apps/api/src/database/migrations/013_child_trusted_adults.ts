import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE child_trusted_adults (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      child_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      guardian_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      adult_label VARCHAR(24) NOT NULL,
      relationship_kind VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      contact_channel VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reachability VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      verification_source VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      verified_at DATETIME(6) NOT NULL,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_child_trusted_adult_label (child_id, adult_label),
      KEY idx_child_trusted_adult_child (child_id, status, verified_at),
      CONSTRAINT fk_child_trusted_adult_child FOREIGN KEY (child_id)
        REFERENCES child_accounts(id) ON DELETE CASCADE,
      CONSTRAINT fk_child_trusted_adult_guardian FOREIGN KEY (guardian_id)
        REFERENCES guardian_accounts(id) ON DELETE SET NULL,
      CONSTRAINT chk_child_trusted_adult_relationship
        CHECK (relationship_kind IN ('family', 'teacher', 'other')),
      CONSTRAINT chk_child_trusted_adult_channel
        CHECK (contact_channel IN ('face_to_face', 'scheduled_contact', 'not_configured')),
      CONSTRAINT chk_child_trusted_adult_reachability
        CHECK (reachability IN ('available_now', 'by_appointment', 'unavailable')),
      CONSTRAINT chk_child_trusted_adult_source
        CHECK (verification_source IN ('guardian_enrollment', 'pilot_site')),
      CONSTRAINT chk_child_trusted_adult_status
        CHECK (status IN ('active', 'inactive'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS child_trusted_adults`.execute(database);
}
