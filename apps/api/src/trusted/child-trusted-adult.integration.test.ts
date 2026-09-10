import { randomBytes, randomUUID } from "node:crypto";

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  CHILD_NOTICE_VERSION,
  GUARDIAN_CONSENT_VERSION,
  childTrustedAdultsResponseSchema,
  errorResponseSchema,
} from "@xiaoban/contracts";

import { buildApp } from "../app.js";
import { loadDatabaseConfig } from "../config.js";
import { createDatabase } from "../database/client.js";
import { EnrollmentService, hashSecret } from "../identity/service.js";
import { ChildTrustedAdultService } from "./child-trusted-adult-service.js";

const config = loadDatabaseConfig(process.env, "test");
if (config.database !== "xiaoban_test") {
  throw new Error("Trusted adult cleanup is restricted to xiaoban_test.");
}
const database = createDatabase(config);
const enrollmentService = new EnrollmentService(database);
const verifiedAt = new Date("2026-09-10T00:00:00.000Z");
const app = buildApp({ childTrustedAdultService: new ChildTrustedAdultService(database) });

function sessionToken(): string {
  return randomBytes(32).toString("base64url");
}

function authorization(value: string) {
  return { authorization: `Bearer ${value}` };
}

async function clearSyntheticData(): Promise<void> {
  await database.deleteFrom("child_trusted_adults").execute();
  for (const table of [
    "audit_entries",
    "access_sessions",
    "guardian_child_links",
    "guardian_consents",
    "enrollments",
    "child_accounts",
    "guardian_accounts",
    "pilot_invitations",
    "sites",
  ] as const) {
    await database.deleteFrom(table).execute();
  }
}

async function createChild() {
  const invitationCode = `SYNTHETIC-${randomUUID()}`;
  const siteId = randomUUID();
  await database.insertInto("sites").values({
    id: siteId,
    display_name: "青禾信任大人测试站（虚构）",
    status: "active",
    created_at: verifiedAt,
  }).execute();
  await database.insertInto("pilot_invitations").values({
    id: randomUUID(),
    site_id: siteId,
    batch_name: "合成信任大人测试批次",
    code_hash: hashSecret(invitationCode),
    status: "active",
    expires_at: new Date("2027-09-01T00:00:00.000Z"),
    created_at: verifiedAt,
    updated_at: verifiedAt,
  }).execute();
  const guardianToken = sessionToken();
  const childToken = sessionToken();
  await enrollmentService.confirmGuardian({
    requestId: randomUUID(), invitationCode, guardianAlias: "青禾阿姨",
    policyVersion: GUARDIAN_CONSENT_VERSION, consentAccepted: true,
    guardianSessionToken: guardianToken,
  });
  await enrollmentService.activateChild(guardianToken, {
    requestId: randomUUID(), childAlias: "小山雀", ageBand: "9_11",
    childNoticeVersion: CHILD_NOTICE_VERSION, noticeAccepted: true,
    childSessionToken: childToken,
  });
  const child = await database.selectFrom("child_accounts")
    .select("id")
    .where("alias", "=", "小山雀")
    .executeTakeFirstOrThrow();
  const guardian = await database.selectFrom("guardian_accounts")
    .select("id")
    .where("alias", "=", "青禾阿姨")
    .executeTakeFirstOrThrow();
  return { childId: child.id, guardianId: guardian.id, childToken, guardianToken };
}

async function insertAdult(input: {
  childId: string;
  guardianId: string | null;
  label: string;
  relationshipKind: "family" | "teacher" | "other";
  contactChannel: "face_to_face" | "scheduled_contact" | "not_configured";
  reachability: "available_now" | "by_appointment" | "unavailable";
  verificationSource: "guardian_enrollment" | "pilot_site";
  status: "active" | "inactive";
  verifiedAt: Date;
}): Promise<string> {
  const id = randomUUID();
  await database.insertInto("child_trusted_adults").values({
    id,
    child_id: input.childId,
    guardian_id: input.guardianId,
    adult_label: input.label,
    relationship_kind: input.relationshipKind,
    contact_channel: input.contactChannel,
    reachability: input.reachability,
    verification_source: input.verificationSource,
    verified_at: input.verifiedAt,
    status: input.status,
    created_at: verifiedAt,
    updated_at: verifiedAt,
  }).execute();
  return id;
}

beforeAll(async () => app.ready());
beforeEach(async () => {
  await clearSyntheticData();
});
afterAll(async () => {
  await clearSyntheticData();
  await app.close();
  await database.destroy();
});

describe("child trusted adult APIs", () => {
  it("returns only verified active adults with an explicit reachability label", async () => {
    const { childId, guardianId, childToken } = await createChild();
    await insertAdult({
      childId, guardianId, label: "外婆", relationshipKind: "family",
      contactChannel: "face_to_face", reachability: "available_now",
      verificationSource: "guardian_enrollment", status: "active",
      verifiedAt: new Date("2026-09-01T00:00:00.000Z"),
    });
    await insertAdult({
      childId, guardianId: null, label: "林老师", relationshipKind: "teacher",
      contactChannel: "scheduled_contact", reachability: "by_appointment",
      verificationSource: "pilot_site", status: "active",
      verifiedAt: new Date("2026-09-02T00:00:00.000Z"),
    });
    await insertAdult({
      childId, guardianId: null, label: "已停用的大人", relationshipKind: "other",
      contactChannel: "not_configured", reachability: "unavailable",
      verificationSource: "pilot_site", status: "inactive",
      verifiedAt: new Date("2026-09-03T00:00:00.000Z"),
    });

    const response = await app.inject({
      method: "GET", url: "/api/v1/child/trusted-adults", headers: authorization(childToken),
    });
    expect(response.statusCode).toBe(200);
    const body = childTrustedAdultsResponseSchema.parse(response.json());
    expect(body.notificationStatus).toBe("not_sent");
    expect(body.adults.map((adult) => adult.label)).toEqual(["外婆", "林老师"]);
    expect(body.adults[0]).toMatchObject({
      relationship: "family",
      relationshipLabel: "家人",
      channelLabel: "在家，可以当面说",
      reachability: "available_now",
      reachabilityLabel: "现在就可以找",
      verifiedAt: "2026-09-01T00:00:00.000Z",
    });
    expect(body.adults[1]).toMatchObject({
      relationship: "teacher",
      reachability: "by_appointment",
      reachabilityLabel: "需要先约时间",
    });
    expect(response.body).not.toContain("phone");
    expect(response.body).not.toContain("已停用的大人");
  });

  it("returns an empty list instead of a fabricated contact", async () => {
    const { childToken } = await createChild();
    const response = await app.inject({
      method: "GET", url: "/api/v1/child/trusted-adults", headers: authorization(childToken),
    });
    expect(response.statusCode).toBe(200);
    expect(childTrustedAdultsResponseSchema.parse(response.json()).adults).toHaveLength(0);
  });

  it("rejects guardian sessions and deactivated children", async () => {
    const { childId, guardianToken, childToken } = await createChild();
    const forbidden = await app.inject({
      method: "GET", url: "/api/v1/child/trusted-adults", headers: authorization(guardianToken),
    });
    expect(forbidden.statusCode).toBe(403);
    expect(errorResponseSchema.parse(forbidden.json()).error.code).toBe("FORBIDDEN");

    await database.updateTable("child_accounts")
      .set({ status: "deactivated" })
      .where("id", "=", childId)
      .execute();
    const deactivated = await app.inject({
      method: "GET", url: "/api/v1/child/trusted-adults", headers: authorization(childToken),
    });
    expect(deactivated.statusCode).toBe(403);
    expect(errorResponseSchema.parse(deactivated.json()).error.code).toBe("ACCOUNT_DEACTIVATED");
  });
});
