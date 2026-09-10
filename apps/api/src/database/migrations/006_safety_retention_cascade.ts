import { sql, type Kysely } from "kysely";

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_safety_override_no_delete`.execute(database);
  await sql`DROP TRIGGER IF EXISTS trg_safety_override_no_update`.execute(database);
  await sql`
    ALTER TABLE safety_event_overrides
      DROP FOREIGN KEY fk_safety_override_event
  `.execute(database);
  await sql`
    ALTER TABLE safety_event_overrides
      ADD CONSTRAINT fk_safety_override_event
      FOREIGN KEY (event_id) REFERENCES safety_events(id) ON DELETE CASCADE
  `.execute(database);
  await createAppendOnlyTriggers(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  await sql`DROP TRIGGER IF EXISTS trg_safety_override_no_delete`.execute(database);
  await sql`DROP TRIGGER IF EXISTS trg_safety_override_no_update`.execute(database);
  await sql`
    ALTER TABLE safety_event_overrides
      DROP FOREIGN KEY fk_safety_override_event
  `.execute(database);
  await sql`
    ALTER TABLE safety_event_overrides
      ADD CONSTRAINT fk_safety_override_event
      FOREIGN KEY (event_id) REFERENCES safety_events(id)
  `.execute(database);
  await createAppendOnlyTriggers(database);
}

async function createAppendOnlyTriggers(database: Kysely<unknown>): Promise<void> {
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
