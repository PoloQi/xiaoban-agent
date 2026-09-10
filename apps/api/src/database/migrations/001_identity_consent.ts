import { createHash } from "node:crypto";

import { sql, type Kysely } from "kysely";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
} from "@xiaoban/contracts";

function hashPolicy(summary: string): string {
  return createHash("sha256").update(summary, "utf8").digest("hex");
}

export async function up(database: Kysely<unknown>): Promise<void> {
  await sql`
    CREATE TABLE policy_versions (
      id VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      policy_type VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      content_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      effective_at DATETIME(6) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      CONSTRAINT chk_policy_type CHECK (policy_type IN ('guardian_consent', 'child_notice')),
      CONSTRAINT chk_policy_status CHECK (status IN ('active', 'retired'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE sites (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      display_name VARCHAR(80) NOT NULL,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at DATETIME(6) NOT NULL,
      CONSTRAINT chk_site_status CHECK (status IN ('active', 'paused'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE pilot_invitations (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      site_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      batch_name VARCHAR(80) NOT NULL,
      code_hash BINARY(32) NOT NULL,
      status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      expires_at DATETIME(6) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_pilot_invitation_code_hash (code_hash),
      KEY idx_pilot_invitation_site_status (site_id, status),
      CONSTRAINT fk_pilot_invitation_site FOREIGN KEY (site_id) REFERENCES sites(id),
      CONSTRAINT chk_pilot_invitation_status CHECK (status IN ('active', 'guardian_confirmed', 'consumed', 'expired'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE guardian_accounts (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      alias VARCHAR(20) NOT NULL,
      verification_method VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      created_at DATETIME(6) NOT NULL,
      CONSTRAINT chk_guardian_verification CHECK (verification_method = 'controlled_site_invite'),
      CONSTRAINT chk_guardian_status CHECK (status IN ('active', 'deactivated'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE enrollments (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      invitation_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      guardian_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      child_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      status VARCHAR(24) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      guardian_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      child_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      created_at DATETIME(6) NOT NULL,
      completed_at DATETIME(6) NULL,
      updated_at DATETIME(6) NOT NULL,
      UNIQUE KEY uq_enrollment_invitation (invitation_id),
      UNIQUE KEY uq_enrollment_guardian_request (guardian_request_id),
      UNIQUE KEY uq_enrollment_child_request (child_request_id),
      CONSTRAINT fk_enrollment_invitation FOREIGN KEY (invitation_id) REFERENCES pilot_invitations(id),
      CONSTRAINT fk_enrollment_guardian FOREIGN KEY (guardian_id) REFERENCES guardian_accounts(id),
      CONSTRAINT chk_enrollment_status CHECK (status IN ('guardian_confirmed', 'active', 'withdrawn'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE child_accounts (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      site_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      alias VARCHAR(20) NOT NULL,
      age_band VARCHAR(8) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      minor_mode BOOLEAN NOT NULL DEFAULT TRUE,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      child_notice_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      notice_acknowledged_at DATETIME(6) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      updated_at DATETIME(6) NOT NULL,
      KEY idx_child_site_status (site_id, status),
      CONSTRAINT fk_child_site FOREIGN KEY (site_id) REFERENCES sites(id),
      CONSTRAINT chk_child_age_band CHECK (age_band IN ('9_11', '12_14')),
      CONSTRAINT chk_child_minor_mode CHECK (minor_mode = TRUE),
      CONSTRAINT chk_child_status CHECK (status IN ('active', 'deactivated'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    ALTER TABLE enrollments
      ADD CONSTRAINT fk_enrollment_child FOREIGN KEY (child_id) REFERENCES child_accounts(id)
  `.execute(database);

  await sql`
    CREATE TABLE guardian_consents (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      enrollment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      guardian_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      child_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      policy_version VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      scope_code VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      granted_at DATETIME(6) NOT NULL,
      withdrawn_at DATETIME(6) NULL,
      withdraw_reason_code VARCHAR(32) CHARACTER SET ascii COLLATE ascii_bin NULL,
      withdraw_request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      UNIQUE KEY uq_guardian_consent_enrollment (enrollment_id),
      UNIQUE KEY uq_guardian_consent_withdraw_request (withdraw_request_id),
      CONSTRAINT fk_guardian_consent_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments(id),
      CONSTRAINT fk_guardian_consent_guardian FOREIGN KEY (guardian_id) REFERENCES guardian_accounts(id),
      CONSTRAINT fk_guardian_consent_child FOREIGN KEY (child_id) REFERENCES child_accounts(id),
      CONSTRAINT fk_guardian_consent_policy FOREIGN KEY (policy_version) REFERENCES policy_versions(id),
      CONSTRAINT chk_guardian_consent_scope CHECK (scope_code = 'pilot_account_safety'),
      CONSTRAINT chk_guardian_consent_status CHECK (status IN ('active', 'withdrawn')),
      CONSTRAINT chk_guardian_consent_reason CHECK (withdraw_reason_code IS NULL OR withdraw_reason_code IN ('guardian_choice', 'pilot_exit', 'privacy_request'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE guardian_child_links (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      guardian_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      child_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      relationship_role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      verification_status VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      verified_at DATETIME(6) NOT NULL,
      deactivated_at DATETIME(6) NULL,
      UNIQUE KEY uq_guardian_child_link (guardian_id, child_id),
      CONSTRAINT fk_guardian_child_link_guardian FOREIGN KEY (guardian_id) REFERENCES guardian_accounts(id),
      CONSTRAINT fk_guardian_child_link_child FOREIGN KEY (child_id) REFERENCES child_accounts(id),
      CONSTRAINT chk_guardian_child_role CHECK (relationship_role = 'guardian'),
      CONSTRAINT chk_guardian_child_verification CHECK (verification_status = 'verified')
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE access_sessions (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      enrollment_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      role VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      subject_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      child_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      token_hash BINARY(32) NOT NULL,
      created_at DATETIME(6) NOT NULL,
      revoked_at DATETIME(6) NULL,
      UNIQUE KEY uq_access_session_token (token_hash),
      KEY idx_access_session_subject (role, subject_id),
      CONSTRAINT fk_access_session_enrollment FOREIGN KEY (enrollment_id) REFERENCES enrollments(id),
      CONSTRAINT fk_access_session_child FOREIGN KEY (child_id) REFERENCES child_accounts(id),
      CONSTRAINT chk_access_session_role CHECK (role IN ('guardian', 'child'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  await sql`
    CREATE TABLE audit_entries (
      id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin PRIMARY KEY,
      actor_type VARCHAR(16) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      actor_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NULL,
      action VARCHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      target_type VARCHAR(40) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      target_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      request_id CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
      metadata JSON NOT NULL,
      created_at DATETIME(6) NOT NULL,
      KEY idx_audit_target_time (target_type, target_id, created_at),
      KEY idx_audit_request (request_id),
      CONSTRAINT chk_audit_actor_type CHECK (actor_type IN ('system', 'guardian', 'child'))
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci
  `.execute(database);

  const now = new Date();
  await sql`
    INSERT INTO policy_versions (id, policy_type, content_hash, status, effective_at, created_at)
    VALUES
      (${GUARDIAN_CONSENT_VERSION}, 'guardian_consent', ${hashPolicy("account safety privacy withdrawal")}, 'active', ${now}, ${now}),
      (${CHILD_NOTICE_VERSION}, 'child_notice', ${hashPolicy("ai identity privacy trusted adult help")}, 'active', ${now}, ${now})
  `.execute(database);
}

export async function down(database: Kysely<unknown>): Promise<void> {
  for (const table of [
    "audit_entries",
    "access_sessions",
    "guardian_child_links",
    "guardian_consents",
  ]) {
    await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(database);
  }
  await sql`ALTER TABLE enrollments DROP FOREIGN KEY fk_enrollment_child`.execute(database);
  for (const table of [
    "child_accounts",
    "enrollments",
    "guardian_accounts",
    "pilot_invitations",
    "sites",
    "policy_versions",
  ]) {
    await sql.raw(`DROP TABLE IF EXISTS ${table}`).execute(database);
  }
}
