import { randomUUID } from "node:crypto";

import { loadDatabaseConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "./client.js";
import { seedDevContent } from "./dev-content-seed.js";
import { hashSecret } from "../identity/service.js";
import { seedLocalTestAccount } from "../identity/local-test-account.js";
import { seedLocalTrustedAdults } from "../trusted/trusted-adult-seed.js";

export const DEMO_INVITATION_CODE = "XIAOBAN-DEMO-2026-02";

const database = createDatabase(loadDatabaseConfig(process.env, "migration"));

try {
  await assertDatabaseBaseline(database);
  const codeHash = hashSecret(DEMO_INVITATION_CODE);
  const existing = await database
    .selectFrom("pilot_invitations")
    .select("status")
    .where("code_hash", "=", codeHash)
    .executeTakeFirst();

  if (existing === undefined) {
    const now = new Date();
    const siteId = randomUUID();
    await database.transaction().execute(async (transaction) => {
      await transaction
        .insertInto("sites")
        .values({
          id: siteId,
          display_name: "青禾成长站（虚构）",
          status: "active",
          created_at: now,
        })
        .execute();
      await transaction
        .insertInto("pilot_invitations")
        .values({
          id: randomUUID(),
          site_id: siteId,
          batch_name: "2026秋季合成验证批次",
          code_hash: codeHash,
          status: "active",
          expires_at: new Date("2027-08-17T00:00:00.000Z"),
          created_at: now,
          updated_at: now,
        })
        .execute();
    });
    console.log(`Synthetic local invitation created: ${DEMO_INVITATION_CODE}`);
  } else {
    console.log(`Synthetic local invitation already exists with status: ${existing.status}.`);
  }
  const contentResult = await seedDevContent(database);
  console.log(
    `Synthetic dev content seed complete: ${contentResult.created} created, ${contentResult.existing} existing.`,
  );
  const testAccountResult = await seedLocalTestAccount(database);
  console.log(`Synthetic local test account seed complete: ${testAccountResult}.`);
  const trustedAdultResult = await seedLocalTrustedAdults(database);
  console.log(
    `Synthetic trusted adult seed complete: ${trustedAdultResult.created} created, ${trustedAdultResult.existing} existing.`,
  );
} catch {
  console.error("Synthetic dev seed failed without exposing connection details.");
  process.exitCode = 1;
} finally {
  await database.destroy();
}
