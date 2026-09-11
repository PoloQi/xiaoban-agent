import type { ColumnType } from "kysely";

import type {
  ChildCompanion,
  ChildGrade,
  ChildInterest,
  ChildMood,
  GenerationControlReason,
  GenerationControlState,
  RiskFusionResult,
  TrustedAdultChannel,
  TrustedAdultReachability,
  TrustedAdultRelationship,
} from "@xiaoban/contracts";

type Timestamp = ColumnType<Date, Date, Date>;
type NullableTimestamp = ColumnType<Date | null, Date | null, Date | null>;

export interface PolicyVersionsTable {
  id: string;
  policy_type: "guardian_consent" | "child_notice";
  content_hash: string;
  status: "active" | "retired";
  effective_at: Timestamp;
  created_at: Timestamp;
}

export interface SitesTable {
  id: string;
  display_name: string;
  status: "active" | "paused";
  created_at: Timestamp;
}

export interface PilotInvitationsTable {
  id: string;
  site_id: string;
  batch_name: string;
  code_hash: Buffer;
  status: "active" | "guardian_confirmed" | "consumed" | "expired";
  expires_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface GuardianAccountsTable {
  id: string;
  alias: string;
  verification_method: "controlled_site_invite";
  status: "active" | "deactivated";
  created_at: Timestamp;
}

export interface EnrollmentsTable {
  id: string;
  invitation_id: string;
  guardian_id: string;
  child_id: string | null;
  status: "guardian_confirmed" | "active" | "withdrawn";
  guardian_request_id: string;
  child_request_id: string | null;
  created_at: Timestamp;
  completed_at: NullableTimestamp;
  updated_at: Timestamp;
}

export interface ChildAccountsTable {
  id: string;
  site_id: string;
  alias: string;
  age_band: "9_11" | "12_14";
  minor_mode: 1;
  status: "active" | "deactivated";
  child_notice_version: string;
  notice_acknowledged_at: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface GuardianConsentsTable {
  id: string;
  enrollment_id: string;
  guardian_id: string;
  child_id: string | null;
  policy_version: string;
  scope_code: "pilot_account_safety";
  status: "active" | "withdrawn";
  granted_at: Timestamp;
  withdrawn_at: NullableTimestamp;
  withdraw_reason_code: "guardian_choice" | "pilot_exit" | "privacy_request" | null;
  withdraw_request_id: string | null;
}

export interface GuardianChildLinksTable {
  id: string;
  guardian_id: string;
  child_id: string;
  relationship_role: "guardian";
  verification_status: "verified";
  verified_at: Timestamp;
  deactivated_at: NullableTimestamp;
}

export interface AccessSessionsTable {
  id: string;
  enrollment_id: string | null;
  role: "guardian" | "child" | "content_author" | "content_reviewer";
  subject_id: string;
  child_id: string | null;
  token_hash: Buffer;
  created_at: Timestamp;
  revoked_at: NullableTimestamp;
}

export interface AuditEntriesTable {
  id: string;
  actor_type: "system" | "guardian" | "child" | "content_operator" | "safety_operator";
  actor_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  request_id: string;
  metadata: ColumnType<Record<string, unknown>, string, string>;
  created_at: Timestamp;
}

export interface ContentItemsTable {
  id: string;
  content_type: "activity" | "knowledge";
  slug: string;
  lifecycle_status: "draft" | "published" | "disabled";
  active_version_id: string | null;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface ContentVersionsTable {
  id: string;
  item_id: string;
  version_number: number;
  review_status: "draft" | "in_review" | "approved" | "rejected";
  title: string;
  summary: string;
  content_body: ColumnType<Record<string, unknown>, string, never>;
  age_band: "9_11" | "12_14" | "both";
  source_kind: "synthetic_test" | "official" | "institution_reviewed" | "local_pilot";
  source_label: string;
  source_url: string | null;
  valid_from: Timestamp;
  expires_at: Timestamp;
  risk_tags: ColumnType<string[], string, never>;
  author_id: string;
  created_at: Timestamp;
}

export interface ContentReviewsTable {
  id: string;
  version_id: string;
  author_id: string;
  reviewer_id: string;
  decision: "approved" | "rejected";
  reason: string;
  created_at: Timestamp;
}

export interface ContentCommandsTable {
  id: string;
  request_id: string;
  actor_id: string;
  command_type:
    | "create_item"
    | "create_version"
    | "submit_review"
    | "review"
    | "publish"
    | "disable"
    | "rollback";
  request_hash: string;
  target_item_id: string;
  result_body: ColumnType<Record<string, unknown>, string, never>;
  created_at: Timestamp;
}

export interface SafetyAccessGrantsTable {
  id: string;
  actor_id: string;
  role: "duty_safety_officer" | "event_owner";
  token_hash: Buffer;
  created_at: Timestamp;
  revoked_at: NullableTimestamp;
}

export interface SafetyEventsTable {
  id: string;
  request_id: string;
  request_hash: string;
  synthetic: 1;
  case_reference: string;
  owner_actor_id: string;
  minimal_excerpt: string;
  classification_snapshot: ColumnType<RiskFusionResult, string, never>;
  detected_level: "L2" | "L3";
  detected_category: string;
  effective_level: "L0" | "L1" | "L2" | "L3";
  effective_category: string;
  status: "open";
  retention_until: Timestamp;
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface SafetyEventOverridesTable {
  id: string;
  event_id: string;
  request_id: string;
  request_hash: string;
  actor_id: string;
  actor_role: "duty_safety_officer" | "event_owner";
  prior_level: "L0" | "L1" | "L2" | "L3";
  prior_category: string;
  new_level: "L0" | "L1" | "L2" | "L3";
  new_category: string;
  reason_code:
    | "false_positive"
    | "context_clarified"
    | "immediacy_changed"
    | "category_corrected"
    | "human_review";
  reason_note: string;
  created_at: Timestamp;
}

export interface GenerationControlsTable {
  scope: "global";
  state: GenerationControlState;
  reason_code: GenerationControlReason;
  version: number;
  updated_by: string | null;
  updated_at: Timestamp;
}

export interface GenerationControlChangesTable {
  id: string;
  scope: "global";
  request_id: string;
  request_hash: string;
  actor_id: string;
  prior_state: GenerationControlState;
  new_state: GenerationControlState;
  reason_code: Exclude<GenerationControlReason, "initial_safety_default">;
  reason_note: string;
  version: number;
  created_at: Timestamp;
}

export interface GrowthAttemptsTable {
  id: string;
  request_id: string;
  request_hash: string;
  child_id: string;
  goal_key: string;
  source: "manual" | "activity";
  activity_slug: string | null;
  target_minutes: number | null;
  feeling: "lighter" | "same" | "rest" | null;
  local_date: ColumnType<string, string, string>;
  created_at: Timestamp;
}

export interface ChildProfilesTable {
  child_id: string;
  completion_request_id: string;
  request_hash: string;
  grade: ChildGrade;
  interests: ColumnType<ChildInterest[], string, string>;
  companion: ChildCompanion;
  completed_at: Timestamp;
  updated_at: Timestamp | null;
  current_goal_id: string | null;
}

export interface ChildMoodCheckInsTable {
  child_id: string;
  request_id: string;
  request_hash: string;
  mood: ChildMood | null;
  local_date: ColumnType<string, string, string>;
  updated_at: Timestamp;
}

export interface ChildTrustedAdultsTable {
  id: string;
  child_id: string;
  guardian_id: string | null;
  adult_label: string;
  relationship_kind: TrustedAdultRelationship;
  contact_channel: TrustedAdultChannel;
  reachability: TrustedAdultReachability;
  verification_source: "guardian_enrollment" | "pilot_site";
  verified_at: Timestamp;
  status: "active" | "inactive";
  created_at: Timestamp;
  updated_at: Timestamp;
}

export interface DatabaseSchema {
  access_sessions: AccessSessionsTable;
  audit_entries: AuditEntriesTable;
  child_accounts: ChildAccountsTable;
  child_mood_checkins: ChildMoodCheckInsTable;
  child_profiles: ChildProfilesTable;
  child_trusted_adults: ChildTrustedAdultsTable;
  content_commands: ContentCommandsTable;
  content_items: ContentItemsTable;
  content_reviews: ContentReviewsTable;
  content_versions: ContentVersionsTable;
  enrollments: EnrollmentsTable;
  guardian_accounts: GuardianAccountsTable;
  guardian_child_links: GuardianChildLinksTable;
  guardian_consents: GuardianConsentsTable;
  generation_control_changes: GenerationControlChangesTable;
  generation_controls: GenerationControlsTable;
  growth_attempts: GrowthAttemptsTable;
  pilot_invitations: PilotInvitationsTable;
  policy_versions: PolicyVersionsTable;
  safety_access_grants: SafetyAccessGrantsTable;
  safety_event_overrides: SafetyEventOverridesTable;
  safety_events: SafetyEventsTable;
  sites: SitesTable;
}
