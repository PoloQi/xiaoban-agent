import type { Kysely } from "kysely";

import type { DatabaseSchema } from "../database/types.js";
import { LOCAL_TEST_ACCOUNT } from "../identity/local-test-account.js";

const SEEDED_AT = new Date("2026-09-10T00:00:00.000Z");

interface TrustedAdultSeed {
  id: string;
  label: string;
  relationshipKind: "family" | "teacher" | "other";
  contactChannel: "face_to_face" | "scheduled_contact" | "not_configured";
  reachability: "available_now" | "by_appointment" | "unavailable";
  verificationSource: "guardian_enrollment" | "pilot_site";
  guardianId: string | null;
}

const TRUSTED_ADULT_SEEDS: readonly TrustedAdultSeed[] = [
  {
    id: "d2400000-0000-4000-8000-00000000000a",
    label: "外婆",
    relationshipKind: "family",
    contactChannel: "face_to_face",
    reachability: "available_now",
    verificationSource: "guardian_enrollment",
    guardianId: LOCAL_TEST_ACCOUNT.guardianId,
  },
  {
    id: "d2400000-0000-4000-8000-00000000000b",
    label: "林老师",
    relationshipKind: "teacher",
    contactChannel: "scheduled_contact",
    reachability: "by_appointment",
    verificationSource: "pilot_site",
    guardianId: null,
  },
];

export async function seedLocalTrustedAdults(
  database: Kysely<DatabaseSchema>,
): Promise<{ created: number; existing: number }> {
  return database.transaction().execute(async (transaction) => {
    const child = await transaction
      .selectFrom("child_accounts")
      .select("id")
      .where("id", "=", LOCAL_TEST_ACCOUNT.childId)
      .executeTakeFirst();
    if (child === undefined) {
      throw new Error("Trusted adult seed requires the local synthetic test account.");
    }

    let created = 0;
    let existing = 0;
    for (const seed of TRUSTED_ADULT_SEEDS) {
      const row = await transaction
        .selectFrom("child_trusted_adults")
        .select("id")
        .where("id", "=", seed.id)
        .executeTakeFirst();
      if (row !== undefined) {
        existing += 1;
        continue;
      }
      await transaction.insertInto("child_trusted_adults").values({
        id: seed.id,
        child_id: LOCAL_TEST_ACCOUNT.childId,
        guardian_id: seed.guardianId,
        adult_label: seed.label,
        relationship_kind: seed.relationshipKind,
        contact_channel: seed.contactChannel,
        reachability: seed.reachability,
        verification_source: seed.verificationSource,
        verified_at: SEEDED_AT,
        status: "active",
        created_at: SEEDED_AT,
        updated_at: SEEDED_AT,
      }).execute();
      created += 1;
    }
    return { created, existing };
  });
}
