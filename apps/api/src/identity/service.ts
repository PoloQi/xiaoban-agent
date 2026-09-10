import { createHash, randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
  type ChildActivationRequest,
  type ChildActivationResponse,
  type ChildModeResponse,
  type ConsentWithdrawalRequest,
  type ConsentWithdrawalResponse,
  type GuardianConfirmationRequest,
  type GuardianConfirmationResponse,
  type GuardianEnrollmentResponse,
  type InvitationPreviewResponse,
} from "@xiaoban/contracts";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";

const guardianPolicySummary = [
  "只创建受控试点所需账号",
  "普通聊天默认不向成人展示",
  "可以随时撤回并立即停用儿童功能",
  "本阶段不采集身份证、人脸或联系方式",
];

type DatabaseExecutor = Kysely<DatabaseSchema> | Transaction<DatabaseSchema>;

interface SessionPrincipal {
  childId: string | null;
  enrollmentId: string;
  role: "guardian" | "child";
  subjectId: string;
}

export function hashSecret(secret: string): Buffer {
  return createHash("sha256").update(secret, "utf8").digest();
}

function toIso(value: Date): string {
  return value.toISOString();
}

async function writeAudit(
  database: DatabaseExecutor,
  input: {
    actorType: "system" | "guardian" | "child";
    actorId: string | null;
    action: string;
    targetType: string;
    targetId: string;
    requestId: string;
    metadata: Record<string, unknown>;
    now: Date;
  },
): Promise<void> {
  await database
    .insertInto("audit_entries")
    .values({
      id: randomUUID(),
      actor_type: input.actorType,
      actor_id: input.actorId,
      action: input.action,
      target_type: input.targetType,
      target_id: input.targetId,
      request_id: input.requestId,
      metadata: JSON.stringify(input.metadata),
      created_at: input.now,
    })
    .execute();
}

export class EnrollmentService {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async previewInvitation(invitationCode: string): Promise<InvitationPreviewResponse> {
    const invitation = await this.database
      .selectFrom("pilot_invitations as invitation")
      .innerJoin("sites as site", "site.id", "invitation.site_id")
      .select([
        "invitation.status",
        "invitation.expires_at as expiresAt",
        "invitation.batch_name as batchName",
        "site.display_name as siteName",
        "site.status as siteStatus",
      ])
      .where("invitation.code_hash", "=", hashSecret(invitationCode))
      .executeTakeFirst();

    if (invitation === undefined || invitation.siteStatus !== "active") {
      throw new PublicAppError("INVITATION_INVALID", 404);
    }
    if (invitation.expiresAt.getTime() <= Date.now()) {
      throw new PublicAppError("INVITATION_EXPIRED", 410);
    }
    if (invitation.status !== "active") {
      throw new PublicAppError("INVITATION_USED", 410);
    }

    return {
      invitation: {
        siteName: invitation.siteName,
        batchName: invitation.batchName,
        expiresAt: toIso(invitation.expiresAt),
        verificationMethod: "controlled_site_invite",
      },
      policy: {
        version: GUARDIAN_CONSENT_VERSION,
        summary: guardianPolicySummary,
      },
    };
  }

  async confirmGuardian(
    input: GuardianConfirmationRequest,
  ): Promise<GuardianConfirmationResponse> {
    if (!input.consentAccepted) {
      throw new PublicAppError("CONSENT_REQUIRED", 422);
    }
    if (input.policyVersion !== GUARDIAN_CONSENT_VERSION) {
      throw new PublicAppError("POLICY_VERSION_MISMATCH", 409);
    }

    return this.database.transaction().execute(async (transaction) => {
      const invitationHash = hashSecret(input.invitationCode);
      const sessionHash = hashSecret(input.guardianSessionToken);
      const existing = await transaction
        .selectFrom("enrollments as enrollment")
        .innerJoin(
          "pilot_invitations as invitation",
          "invitation.id",
          "enrollment.invitation_id",
        )
        .select(["enrollment.id", "enrollment.guardian_id as guardianId"])
        .where("enrollment.guardian_request_id", "=", input.requestId)
        .where("invitation.code_hash", "=", invitationHash)
        .executeTakeFirst();

      if (existing !== undefined) {
        const session = await transaction
          .selectFrom("access_sessions")
          .select("id")
          .where("enrollment_id", "=", existing.id)
          .where("role", "=", "guardian")
          .where("subject_id", "=", existing.guardianId)
          .where("token_hash", "=", sessionHash)
          .executeTakeFirst();
        if (session === undefined) {
          throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
        }
        return {
          enrollmentId: existing.id,
          status: "guardian_confirmed",
          policyVersion: GUARDIAN_CONSENT_VERSION,
          nextAction: "child_notice",
        };
      }

      const invitation = await transaction
        .selectFrom("pilot_invitations")
        .innerJoin("sites", "sites.id", "pilot_invitations.site_id")
        .select([
          "pilot_invitations.id",
          "pilot_invitations.status",
          "pilot_invitations.expires_at as expiresAt",
          "sites.status as siteStatus",
        ])
        .where("pilot_invitations.code_hash", "=", invitationHash)
        .forUpdate()
        .executeTakeFirst();

      if (invitation === undefined || invitation.siteStatus !== "active") {
        throw new PublicAppError("INVITATION_INVALID", 404);
      }
      if (invitation.expiresAt.getTime() <= Date.now()) {
        await transaction
          .updateTable("pilot_invitations")
          .set({ status: "expired", updated_at: new Date() })
          .where("id", "=", invitation.id)
          .execute();
        throw new PublicAppError("INVITATION_EXPIRED", 410);
      }
      if (invitation.status !== "active") {
        throw new PublicAppError("INVITATION_USED", 410);
      }

      const policy = await transaction
        .selectFrom("policy_versions")
        .select("id")
        .where("id", "=", GUARDIAN_CONSENT_VERSION)
        .where("policy_type", "=", "guardian_consent")
        .where("status", "=", "active")
        .executeTakeFirst();
      if (policy === undefined) {
        throw new PublicAppError("POLICY_VERSION_MISMATCH", 409);
      }

      const now = new Date();
      const guardianId = randomUUID();
      const enrollmentId = randomUUID();
      await transaction
        .insertInto("guardian_accounts")
        .values({
          id: guardianId,
          alias: input.guardianAlias,
          verification_method: "controlled_site_invite",
          status: "active",
          created_at: now,
        })
        .execute();
      await transaction
        .insertInto("enrollments")
        .values({
          id: enrollmentId,
          invitation_id: invitation.id,
          guardian_id: guardianId,
          child_id: null,
          status: "guardian_confirmed",
          guardian_request_id: input.requestId,
          child_request_id: null,
          created_at: now,
          completed_at: null,
          updated_at: now,
        })
        .execute();
      await transaction
        .insertInto("guardian_consents")
        .values({
          id: randomUUID(),
          enrollment_id: enrollmentId,
          guardian_id: guardianId,
          child_id: null,
          policy_version: GUARDIAN_CONSENT_VERSION,
          scope_code: "pilot_account_safety",
          status: "active",
          granted_at: now,
          withdrawn_at: null,
          withdraw_reason_code: null,
          withdraw_request_id: null,
        })
        .execute();
      await transaction
        .insertInto("access_sessions")
        .values({
          id: randomUUID(),
          enrollment_id: enrollmentId,
          role: "guardian",
          subject_id: guardianId,
          child_id: null,
          token_hash: sessionHash,
          created_at: now,
          revoked_at: null,
        })
        .execute();
      await transaction
        .updateTable("pilot_invitations")
        .set({ status: "guardian_confirmed", updated_at: now })
        .where("id", "=", invitation.id)
        .execute();
      await writeAudit(transaction, {
        actorType: "guardian",
        actorId: guardianId,
        action: "guardian_consent.granted",
        targetType: "enrollment",
        targetId: enrollmentId,
        requestId: input.requestId,
        metadata: { policyVersion: GUARDIAN_CONSENT_VERSION },
        now,
      });

      return {
        enrollmentId,
        status: "guardian_confirmed",
        policyVersion: GUARDIAN_CONSENT_VERSION,
        nextAction: "child_notice",
      };
    });
  }

  async activateChild(
    guardianToken: string,
    input: ChildActivationRequest,
  ): Promise<ChildActivationResponse> {
    if (!input.noticeAccepted) {
      throw new PublicAppError("CONSENT_REQUIRED", 422);
    }
    if (input.childNoticeVersion !== CHILD_NOTICE_VERSION) {
      throw new PublicAppError("POLICY_VERSION_MISMATCH", 409);
    }
    const guardian = await this.authenticate(guardianToken, "guardian");

    return this.database.transaction().execute(async (transaction) => {
      const childSessionHash = hashSecret(input.childSessionToken);
      const enrollment = await transaction
        .selectFrom("enrollments as enrollment")
        .innerJoin(
          "pilot_invitations as invitation",
          "invitation.id",
          "enrollment.invitation_id",
        )
        .select([
          "enrollment.id",
          "enrollment.guardian_id as guardianId",
          "enrollment.child_id as childId",
          "enrollment.status",
          "enrollment.child_request_id as childRequestId",
          "invitation.id as invitationId",
          "invitation.site_id as siteId",
        ])
        .where("enrollment.id", "=", guardian.enrollmentId)
        .forUpdate()
        .executeTakeFirst();

      if (enrollment === undefined || enrollment.guardianId !== guardian.subjectId) {
        throw new PublicAppError("FORBIDDEN", 403);
      }
      if (enrollment.childRequestId === input.requestId && enrollment.childId !== null) {
        const matchingSession = await transaction
          .selectFrom("access_sessions")
          .select("id")
          .where("role", "=", "child")
          .where("child_id", "=", enrollment.childId)
          .where("token_hash", "=", childSessionHash)
          .executeTakeFirst();
        if (matchingSession === undefined) {
          throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
        }
        return this.readChildActivation(transaction, enrollment.id, enrollment.childId);
      }
      if (enrollment.status !== "guardian_confirmed" || enrollment.childId !== null) {
        throw new PublicAppError("IDEMPOTENCY_CONFLICT", 409);
      }

      const policy = await transaction
        .selectFrom("policy_versions")
        .select("id")
        .where("id", "=", CHILD_NOTICE_VERSION)
        .where("policy_type", "=", "child_notice")
        .where("status", "=", "active")
        .executeTakeFirst();
      if (policy === undefined) {
        throw new PublicAppError("POLICY_VERSION_MISMATCH", 409);
      }

      const consent = await transaction
        .selectFrom("guardian_consents")
        .select("id")
        .where("enrollment_id", "=", enrollment.id)
        .where("status", "=", "active")
        .executeTakeFirst();
      if (consent === undefined) {
        throw new PublicAppError("CONSENT_REQUIRED", 422);
      }

      const now = new Date();
      const childId = randomUUID();
      await transaction
        .insertInto("child_accounts")
        .values({
          id: childId,
          site_id: enrollment.siteId,
          alias: input.childAlias,
          age_band: input.ageBand,
          minor_mode: 1,
          status: "active",
          child_notice_version: CHILD_NOTICE_VERSION,
          notice_acknowledged_at: now,
          created_at: now,
          updated_at: now,
        })
        .execute();
      await transaction
        .updateTable("enrollments")
        .set({
          child_id: childId,
          child_request_id: input.requestId,
          status: "active",
          completed_at: now,
          updated_at: now,
        })
        .where("id", "=", enrollment.id)
        .execute();
      await transaction
        .updateTable("guardian_consents")
        .set({ child_id: childId })
        .where("id", "=", consent.id)
        .execute();
      await transaction
        .insertInto("guardian_child_links")
        .values({
          id: randomUUID(),
          guardian_id: guardian.subjectId,
          child_id: childId,
          relationship_role: "guardian",
          verification_status: "verified",
          verified_at: now,
          deactivated_at: null,
        })
        .execute();
      await transaction
        .insertInto("access_sessions")
        .values({
          id: randomUUID(),
          enrollment_id: enrollment.id,
          role: "child",
          subject_id: childId,
          child_id: childId,
          token_hash: childSessionHash,
          created_at: now,
          revoked_at: null,
        })
        .execute();
      await transaction
        .updateTable("pilot_invitations")
        .set({ status: "consumed", updated_at: now })
        .where("id", "=", enrollment.invitationId)
        .execute();
      await writeAudit(transaction, {
        actorType: "child",
        actorId: childId,
        action: "child_account.activated",
        targetType: "child_account",
        targetId: childId,
        requestId: input.requestId,
        metadata: {
          childNoticeVersion: CHILD_NOTICE_VERSION,
          minorMode: true,
        },
        now,
      });

      return {
        enrollmentId: enrollment.id,
        status: "active",
        child: {
          alias: input.childAlias,
          ageBand: input.ageBand,
          minorMode: true,
        },
        childNoticeVersion: CHILD_NOTICE_VERSION,
      };
    });
  }

  async getGuardianEnrollment(guardianToken: string): Promise<GuardianEnrollmentResponse> {
    const guardian = await this.authenticate(guardianToken, "guardian");
    const row = await this.database
      .selectFrom("enrollments as enrollment")
      .innerJoin(
        "guardian_consents as consent",
        "consent.enrollment_id",
        "enrollment.id",
      )
      .leftJoin("child_accounts as child", "child.id", "enrollment.child_id")
      .select([
        "enrollment.id",
        "enrollment.status",
        "consent.status as consentStatus",
        "consent.policy_version as policyVersion",
        "consent.granted_at as grantedAt",
        "consent.withdrawn_at as withdrawnAt",
        "child.alias as childAlias",
        "child.age_band as ageBand",
        "child.minor_mode as minorMode",
        "child.status as childStatus",
      ])
      .where("enrollment.id", "=", guardian.enrollmentId)
      .executeTakeFirstOrThrow();

    return {
      enrollmentId: row.id,
      status: row.status,
      consent: {
        status: row.consentStatus,
        policyVersion: GUARDIAN_CONSENT_VERSION,
        grantedAt: toIso(row.grantedAt),
        withdrawnAt: row.withdrawnAt === null ? null : toIso(row.withdrawnAt),
      },
      child:
        row.childAlias === null || row.ageBand === null || row.childStatus === null
          ? null
          : {
              alias: row.childAlias,
              ageBand: row.ageBand,
              minorMode: true,
              status: row.childStatus,
            },
    };
  }

  async withdrawConsent(
    guardianToken: string,
    input: ConsentWithdrawalRequest,
  ): Promise<ConsentWithdrawalResponse> {
    if (!input.confirmed) {
      throw new PublicAppError("CONSENT_REQUIRED", 422);
    }
    const guardian = await this.authenticate(guardianToken, "guardian");

    return this.database.transaction().execute(async (transaction) => {
      const consent = await transaction
        .selectFrom("guardian_consents as consent")
        .innerJoin("enrollments as enrollment", "enrollment.id", "consent.enrollment_id")
        .select([
          "consent.id",
          "consent.status",
          "consent.withdrawn_at as withdrawnAt",
          "consent.withdraw_request_id as withdrawRequestId",
          "enrollment.child_id as childId",
        ])
        .where("consent.enrollment_id", "=", guardian.enrollmentId)
        .where("consent.guardian_id", "=", guardian.subjectId)
        .forUpdate()
        .executeTakeFirst();

      if (consent === undefined || consent.childId === null) {
        throw new PublicAppError("CONSENT_REQUIRED", 422);
      }
      if (consent.status === "withdrawn" && consent.withdrawnAt !== null) {
        return {
          status: "withdrawn",
          childStatus: "deactivated",
          effectiveAt: toIso(consent.withdrawnAt),
        };
      }

      const now = new Date();
      await transaction
        .updateTable("guardian_consents")
        .set({
          status: "withdrawn",
          withdrawn_at: now,
          withdraw_reason_code: input.reasonCode,
          withdraw_request_id: input.requestId,
        })
        .where("id", "=", consent.id)
        .execute();
      await transaction
        .updateTable("enrollments")
        .set({ status: "withdrawn", updated_at: now })
        .where("id", "=", guardian.enrollmentId)
        .execute();
      await transaction
        .updateTable("child_accounts")
        .set({ status: "deactivated", updated_at: now })
        .where("id", "=", consent.childId)
        .execute();
      await transaction
        .updateTable("guardian_child_links")
        .set({ deactivated_at: now })
        .where("child_id", "=", consent.childId)
        .execute();
      await transaction
        .updateTable("access_sessions")
        .set({ revoked_at: now })
        .where("role", "=", "child")
        .where("child_id", "=", consent.childId)
        .where("revoked_at", "is", null)
        .execute();
      await writeAudit(transaction, {
        actorType: "guardian",
        actorId: guardian.subjectId,
        action: "guardian_consent.withdrawn",
        targetType: "child_account",
        targetId: consent.childId,
        requestId: input.requestId,
        metadata: { reasonCode: input.reasonCode },
        now,
      });
      await writeAudit(transaction, {
        actorType: "system",
        actorId: null,
        action: "child_account.deactivated",
        targetType: "child_account",
        targetId: consent.childId,
        requestId: input.requestId,
        metadata: { source: "guardian_consent_withdrawal" },
        now,
      });

      return {
        status: "withdrawn",
        childStatus: "deactivated",
        effectiveAt: toIso(now),
      };
    });
  }

  async getChildMode(childToken: string): Promise<ChildModeResponse> {
    const principal = await this.authenticate(childToken, "child");
    const child = await this.database
      .selectFrom("child_accounts")
      .select(["alias", "age_band as ageBand", "minor_mode as minorMode"])
      .where("id", "=", principal.subjectId)
      .executeTakeFirstOrThrow();

    return {
      status: "active",
      child: {
        alias: child.alias,
        ageBand: child.ageBand,
        minorMode: true,
      },
      boundaries: {
        aiIdentity: "AI成长助手",
        privacy: "不向监护人展示完整普通聊天",
        help: "遇到困难可以随时找可信任成年人",
      },
    };
  }

  private async authenticate(
    token: string,
    expectedRole: "guardian" | "child",
  ): Promise<SessionPrincipal> {
    if (!/^[A-Za-z0-9_-]{43}$/u.test(token)) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    const session = await this.database
      .selectFrom("access_sessions")
      .select([
        "enrollment_id as enrollmentId",
        "role",
        "subject_id as subjectId",
        "child_id as childId",
        "revoked_at as revokedAt",
      ])
      .where("token_hash", "=", hashSecret(token))
      .executeTakeFirst();

    if (session === undefined) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    if (session.role !== expectedRole) {
      throw new PublicAppError("FORBIDDEN", 403);
    }
    if (session.enrollmentId === null) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }
    if (session.role === "child") {
      const child = await this.database
        .selectFrom("child_accounts")
        .select("status")
        .where("id", "=", session.subjectId)
        .executeTakeFirst();
      if (session.revokedAt !== null || child?.status !== "active") {
        throw new PublicAppError("ACCOUNT_DEACTIVATED", 403);
      }
    } else if (session.revokedAt !== null) {
      throw new PublicAppError("UNAUTHORIZED", 401);
    }

    return {
      enrollmentId: session.enrollmentId,
      role: session.role,
      subjectId: session.subjectId,
      childId: session.childId,
    };
  }

  private async readChildActivation(
    database: DatabaseExecutor,
    enrollmentId: string,
    childId: string,
  ): Promise<ChildActivationResponse> {
    const child = await database
      .selectFrom("child_accounts")
      .select(["alias", "age_band as ageBand", "minor_mode as minorMode"])
      .where("id", "=", childId)
      .executeTakeFirstOrThrow();
    return {
      enrollmentId,
      status: "active",
      child: {
        alias: child.alias,
        ageBand: child.ageBand,
        minorMode: true,
      },
      childNoticeVersion: CHILD_NOTICE_VERSION,
    };
  }
}
