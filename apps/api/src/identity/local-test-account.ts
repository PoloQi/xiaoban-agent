import { randomBytes, randomUUID } from "node:crypto";

import type { Kysely, Transaction } from "kysely";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
} from "@xiaoban/contracts";
import type {
  LocalTestAccountSessionRequest,
  LocalTestAccountSessionResponse,
  LocalTestGuardianSessionResponse,
} from "@xiaoban/contracts/local-test-account";

import type { DatabaseSchema } from "../database/types.js";
import { PublicAppError } from "../errors.js";
import { hashSecret } from "./service.js";

const CREATED_AT = new Date("2026-08-22T00:00:00.000Z");
const EXPIRES_AT = new Date("2030-12-31T00:00:00.000Z");
const INTERNAL_INVITATION_CODE = "XIAOBAN-LOCAL-TEST-ACCOUNT-2026-08";

export const LOCAL_TEST_ACCOUNT = {
  siteId: "d2400000-0000-4000-8000-000000000001",
  invitationId: "d2400000-0000-4000-8000-000000000002",
  guardianId: "d2400000-0000-4000-8000-000000000003",
  childId: "d2400000-0000-4000-8000-000000000004",
  enrollmentId: "d2400000-0000-4000-8000-000000000005",
  consentId: "d2400000-0000-4000-8000-000000000006",
  linkId: "d2400000-0000-4000-8000-000000000007",
  guardianRequestId: "d2400000-0000-4000-8000-000000000008",
  childRequestId: "d2400000-0000-4000-8000-000000000009",
  siteName: "青禾本地验收站（虚构）",
  guardianAlias: "青禾测试监护人",
  childAlias: "小树",
  ageBand: "9_11" as const,
};

async function hasIdentityCollision(
  transaction: Transaction<DatabaseSchema>,
): Promise<boolean> {
  const checks = await Promise.all([
    transaction.selectFrom("sites").select("id").where("id", "=", LOCAL_TEST_ACCOUNT.siteId).executeTakeFirst(),
    transaction.selectFrom("pilot_invitations").select("id").where("id", "=", LOCAL_TEST_ACCOUNT.invitationId).executeTakeFirst(),
    transaction.selectFrom("pilot_invitations").select("id").where("code_hash", "=", hashSecret(INTERNAL_INVITATION_CODE)).executeTakeFirst(),
    transaction.selectFrom("guardian_accounts").select("id").where("id", "=", LOCAL_TEST_ACCOUNT.guardianId).executeTakeFirst(),
    transaction.selectFrom("enrollments").select("id").where("id", "=", LOCAL_TEST_ACCOUNT.enrollmentId).executeTakeFirst(),
    transaction.selectFrom("guardian_consents").select("id").where("id", "=", LOCAL_TEST_ACCOUNT.consentId).executeTakeFirst(),
    transaction.selectFrom("guardian_child_links").select("id").where("id", "=", LOCAL_TEST_ACCOUNT.linkId).executeTakeFirst(),
  ]);
  return checks.some((value) => value !== undefined);
}

async function existingAccountIsValid(
  transaction: Transaction<DatabaseSchema>,
): Promise<boolean> {
  const account = await transaction
    .selectFrom("child_accounts as child")
    .innerJoin("enrollments as enrollment", "enrollment.child_id", "child.id")
    .innerJoin("guardian_consents as consent", "consent.enrollment_id", "enrollment.id")
    .innerJoin("guardian_child_links as link", "link.child_id", "child.id")
    .select([
      "child.minor_mode as minorMode",
      "child.status as childStatus",
      "enrollment.id as enrollmentId",
      "enrollment.status as enrollmentStatus",
      "consent.status as consentStatus",
      "link.deactivated_at as linkDeactivatedAt",
    ])
    .where("child.id", "=", LOCAL_TEST_ACCOUNT.childId)
    .where("enrollment.id", "=", LOCAL_TEST_ACCOUNT.enrollmentId)
    .where("consent.id", "=", LOCAL_TEST_ACCOUNT.consentId)
    .where("link.id", "=", LOCAL_TEST_ACCOUNT.linkId)
    .executeTakeFirst();

  return account !== undefined
    && account.minorMode === 1
    && account.childStatus === "active"
    && account.enrollmentStatus === "active"
    && account.consentStatus === "active"
    && account.linkDeactivatedAt === null;
}

export async function seedLocalTestAccount(
  database: Kysely<DatabaseSchema>,
): Promise<"created" | "existing"> {
  return database.transaction().execute(async (transaction) => {
    const child = await transaction
      .selectFrom("child_accounts")
      .select("id")
      .where("id", "=", LOCAL_TEST_ACCOUNT.childId)
      .executeTakeFirst();
    if (child !== undefined) {
      if (await existingAccountIsValid(transaction)) return "existing";
      throw new Error("Local test account seed conflicts with existing data.");
    }
    if (await hasIdentityCollision(transaction)) {
      throw new Error("Local test account seed identity collision.");
    }

    await transaction.insertInto("sites").values({
      id: LOCAL_TEST_ACCOUNT.siteId,
      display_name: LOCAL_TEST_ACCOUNT.siteName,
      status: "active",
      created_at: CREATED_AT,
    }).execute();
    await transaction.insertInto("pilot_invitations").values({
      id: LOCAL_TEST_ACCOUNT.invitationId,
      site_id: LOCAL_TEST_ACCOUNT.siteId,
      batch_name: "本地人工验收账号",
      code_hash: hashSecret(INTERNAL_INVITATION_CODE),
      status: "consumed",
      expires_at: EXPIRES_AT,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    }).execute();
    await transaction.insertInto("guardian_accounts").values({
      id: LOCAL_TEST_ACCOUNT.guardianId,
      alias: LOCAL_TEST_ACCOUNT.guardianAlias,
      verification_method: "controlled_site_invite",
      status: "active",
      created_at: CREATED_AT,
    }).execute();
    await transaction.insertInto("child_accounts").values({
      id: LOCAL_TEST_ACCOUNT.childId,
      site_id: LOCAL_TEST_ACCOUNT.siteId,
      alias: LOCAL_TEST_ACCOUNT.childAlias,
      age_band: LOCAL_TEST_ACCOUNT.ageBand,
      minor_mode: 1,
      status: "active",
      child_notice_version: CHILD_NOTICE_VERSION,
      notice_acknowledged_at: CREATED_AT,
      created_at: CREATED_AT,
      updated_at: CREATED_AT,
    }).execute();
    await transaction.insertInto("enrollments").values({
      id: LOCAL_TEST_ACCOUNT.enrollmentId,
      invitation_id: LOCAL_TEST_ACCOUNT.invitationId,
      guardian_id: LOCAL_TEST_ACCOUNT.guardianId,
      child_id: LOCAL_TEST_ACCOUNT.childId,
      status: "active",
      guardian_request_id: LOCAL_TEST_ACCOUNT.guardianRequestId,
      child_request_id: LOCAL_TEST_ACCOUNT.childRequestId,
      created_at: CREATED_AT,
      completed_at: CREATED_AT,
      updated_at: CREATED_AT,
    }).execute();
    await transaction.insertInto("guardian_consents").values({
      id: LOCAL_TEST_ACCOUNT.consentId,
      enrollment_id: LOCAL_TEST_ACCOUNT.enrollmentId,
      guardian_id: LOCAL_TEST_ACCOUNT.guardianId,
      child_id: LOCAL_TEST_ACCOUNT.childId,
      policy_version: GUARDIAN_CONSENT_VERSION,
      scope_code: "pilot_account_safety",
      status: "active",
      granted_at: CREATED_AT,
      withdrawn_at: null,
      withdraw_reason_code: null,
      withdraw_request_id: null,
    }).execute();
    await transaction.insertInto("guardian_child_links").values({
      id: LOCAL_TEST_ACCOUNT.linkId,
      guardian_id: LOCAL_TEST_ACCOUNT.guardianId,
      child_id: LOCAL_TEST_ACCOUNT.childId,
      relationship_role: "guardian",
      verification_status: "verified",
      verified_at: CREATED_AT,
      deactivated_at: null,
    }).execute();
    return "created";
  });
}

export interface LocalTestAccountSessionIssuer {
  createSession(input: LocalTestAccountSessionRequest): Promise<LocalTestAccountSessionResponse>;
  createGuardianSession(): Promise<LocalTestGuardianSessionResponse>;
  resumeSession(): Promise<LocalTestAccountSessionResponse>;
}

export class LocalTestAccountService implements LocalTestAccountSessionIssuer {
  constructor(private readonly database: Kysely<DatabaseSchema>) {}

  async createSession(
    input: LocalTestAccountSessionRequest,
  ): Promise<LocalTestAccountSessionResponse> {
    return this.issueSession(input);
  }

  async resumeSession(): Promise<LocalTestAccountSessionResponse> {
    return this.issueSession();
  }

  async createGuardianSession(): Promise<LocalTestGuardianSessionResponse> {
    const guardianSessionToken = randomBytes(32).toString("base64url");
    const now = new Date();
    await this.database.transaction().execute(async (transaction) => {
      if (!(await existingAccountIsValid(transaction))) {
        throw new PublicAppError("DEPENDENCY_UNAVAILABLE", 503);
      }
      await transaction.updateTable("access_sessions")
        .set({ revoked_at: now })
        .where("role", "=", "guardian")
        .where("subject_id", "=", LOCAL_TEST_ACCOUNT.guardianId)
        .where("revoked_at", "is", null)
        .execute();
      await transaction.insertInto("access_sessions").values({
        id: randomUUID(),
        enrollment_id: LOCAL_TEST_ACCOUNT.enrollmentId,
        role: "guardian",
        subject_id: LOCAL_TEST_ACCOUNT.guardianId,
        child_id: null,
        token_hash: hashSecret(guardianSessionToken),
        created_at: now,
        revoked_at: null,
      }).execute();
    });
    return {
      schemaVersion: "local-test-guardian-session-2026-09-v1",
      account: {
        alias: LOCAL_TEST_ACCOUNT.guardianAlias,
        relationshipStatus: "verified",
        synthetic: true,
      },
      guardianSessionToken,
    };
  }

  private async issueSession(
    input?: LocalTestAccountSessionRequest,
  ): Promise<LocalTestAccountSessionResponse> {
    const childSessionToken = randomBytes(32).toString("base64url");
    const now = new Date();
    let account: { alias: string; ageBand: "9_11" | "12_14" } | undefined;

    await this.database.transaction().execute(async (transaction) => {
      if (!(await existingAccountIsValid(transaction))) {
        throw new PublicAppError("DEPENDENCY_UNAVAILABLE", 503);
      }
      if (input !== undefined) {
        await transaction
          .updateTable("child_accounts")
          .set({ alias: input.alias, age_band: input.ageBand, updated_at: now })
          .where("id", "=", LOCAL_TEST_ACCOUNT.childId)
          .execute();
        account = input;
      } else {
        const child = await transaction.selectFrom("child_accounts")
          .select(["alias", "age_band as ageBand"])
          .where("id", "=", LOCAL_TEST_ACCOUNT.childId)
          .executeTakeFirstOrThrow();
        account = child;
      }
      await transaction
        .updateTable("access_sessions")
        .set({ revoked_at: now })
        .where("role", "=", "child")
        .where("child_id", "=", LOCAL_TEST_ACCOUNT.childId)
        .where("revoked_at", "is", null)
        .execute();
      await transaction.insertInto("access_sessions").values({
        id: randomUUID(),
        enrollment_id: LOCAL_TEST_ACCOUNT.enrollmentId,
        role: "child",
        subject_id: LOCAL_TEST_ACCOUNT.childId,
        child_id: LOCAL_TEST_ACCOUNT.childId,
        token_hash: hashSecret(childSessionToken),
        created_at: now,
        revoked_at: null,
      }).execute();
    });

    return {
      schemaVersion: "local-test-account-session-2026-08-v1",
      account: {
        alias: account!.alias,
        ageBand: account!.ageBand,
        minorMode: true,
      },
      childSessionToken,
    };
  }
}
