import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE content_items (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      content_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      slug VARCHAR(80) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      lifecycle_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      active_version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      created_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_content_item_slug (slug),
      CONSTRAINT chk_content_item_type CHECK (content_type IN ('activity', 'knowledge')),
      CONSTRAINT chk_content_item_status CHECK (lifecycle_status IN ('draft', 'published', 'disabled')),
      CONSTRAINT chk_content_item_active_version CHECK (
        (lifecycle_status = 'draft' AND active_version_id IS NULL)
        OR (lifecycle_status IN ('published', 'disabled') AND active_version_id IS NOT NULL)
      )
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE content_versions (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      item_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      version_number INT UNSIGNED NOT NULL,
      review_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      title VARCHAR(80) NOT NULL,
      summary VARCHAR(240) NOT NULL,
      content_body JSON NOT NULL,
      age_band VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_kind VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      source_label VARCHAR(160) NOT NULL,
      source_url VARCHAR(512) NULL,
      valid_from DATETIME(6) NOT NULL,
      expires_at DATETIME(6) NOT NULL,
      risk_tags JSON NOT NULL,
      author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_content_version_number (item_id, version_number),
      UNIQUE KEY uq_content_version_item_id (item_id, id),
      UNIQUE KEY uq_content_version_author (id, author_id),
      KEY idx_content_version_review (review_status, expires_at),
      CONSTRAINT fk_content_version_item FOREIGN KEY (item_id) REFERENCES content_items(id),
      CONSTRAINT chk_content_version_number CHECK (version_number >= 1),
      CONSTRAINT chk_content_version_review CHECK (review_status IN ('draft', 'in_review', 'approved', 'rejected')),
      CONSTRAINT chk_content_version_age CHECK (age_band IN ('9_11', '12_14', 'both')),
      CONSTRAINT chk_content_version_source CHECK (source_kind IN ('synthetic_test', 'official', 'institution_reviewed', 'local_pilot')),
      CONSTRAINT chk_content_version_validity CHECK (expires_at > valid_from),
      CONSTRAINT chk_content_version_body_object CHECK (JSON_TYPE(content_body) = 'OBJECT'),
      CONSTRAINT chk_content_version_risk_array CHECK (JSON_TYPE(risk_tags) = 'ARRAY')
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    ALTER TABLE content_items
      ADD CONSTRAINT fk_content_item_active_version
      FOREIGN KEY (id, active_version_id) REFERENCES content_versions(item_id, id)
  `.execute(database);

  await sql`
    CREATE TABLE content_reviews (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      version_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      author_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reviewer_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      decision VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      reason VARCHAR(400) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_content_review_version (version_id),
      KEY idx_content_review_reviewer_time (reviewer_id, created_at),
      CONSTRAINT fk_content_review_version_author
        FOREIGN KEY (version_id, author_id) REFERENCES content_versions(id, author_id),
      CONSTRAINT chk_content_review_decision CHECK (decision IN ('approved', 'rejected')),
      CONSTRAINT chk_content_review_two_person CHECK (author_id <> reviewer_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`ALTER TABLE content_items DROP FOREIGN KEY fk_content_item_active_version`.execute(
    database,
  );
  await sql`DROP TABLE IF EXISTS content_reviews`.execute(database);
  await sql`DROP TABLE IF EXISTS content_versions`.execute(database);
  await sql`DROP TABLE IF EXISTS content_items`.execute(database);
}
