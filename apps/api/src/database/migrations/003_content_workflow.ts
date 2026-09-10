import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    ALTER TABLE access_sessions
      DROP CHECK chk_access_session_role,
      MODIFY enrollment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      ADD CONSTRAINT chk_access_session_role CHECK (
        role IN ('guardian', 'child', 'content_author', 'content_reviewer')
      ),
      ADD CONSTRAINT chk_access_session_scope CHECK (
        (role IN ('guardian', 'child') AND enrollment_id IS NOT NULL)
        OR (
          role IN ('content_author', 'content_reviewer')
          AND enrollment_id IS NULL
          AND child_id IS NULL
        )
      )
  `.execute(database);

  await sql`
    ALTER TABLE audit_entries
      DROP CHECK chk_audit_actor_type,
      ADD CONSTRAINT chk_audit_actor_type CHECK (
        actor_type IN ('system', 'guardian', 'child', 'content_operator')
      )
  `.execute(database);

  await sql`
    CREATE TABLE content_commands (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      command_type VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      target_item_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      result_body JSON NOT NULL,
      created_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_content_command_request (request_id),
      KEY idx_content_command_target_time (target_item_id, created_at),
      CONSTRAINT fk_content_command_item FOREIGN KEY (target_item_id) REFERENCES content_items(id),
      CONSTRAINT chk_content_command_type CHECK (
        command_type IN (
          'create_item',
          'create_version',
          'submit_review',
          'review',
          'publish',
          'disable',
          'rollback'
        )
      ),
      CONSTRAINT chk_content_command_result CHECK (JSON_TYPE(result_body) = 'OBJECT')
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TABLE IF EXISTS content_commands`.execute(database);

  await sql`
    ALTER TABLE audit_entries
      DROP CHECK chk_audit_actor_type,
      ADD CONSTRAINT chk_audit_actor_type CHECK (
        actor_type IN ('system', 'guardian', 'child')
      )
  `.execute(database);

  await sql`
    ALTER TABLE access_sessions
      DROP FOREIGN KEY fk_access_session_enrollment
  `.execute(database);

  await sql`
    ALTER TABLE access_sessions
      DROP CHECK chk_access_session_scope,
      DROP CHECK chk_access_session_role,
      MODIFY enrollment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      ADD CONSTRAINT fk_access_session_enrollment
        FOREIGN KEY (enrollment_id) REFERENCES enrollments(id),
      ADD CONSTRAINT chk_access_session_role CHECK (role IN ('guardian', 'child'))
  `.execute(database);
}
