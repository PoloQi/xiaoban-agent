import { randomBytes, randomUUID } from "node:crypto";

import { loadConfig } from "../config.js";
import { assertDatabaseBaseline, createDatabase } from "../database/client.js";
import { hashSecret } from "../identity/service.js";
import { GenerationControlStore } from "./generation-control-store.js";

const GENERATION_CLI_ACTOR_ID = "00000000-0000-4000-8000-000000000033";

const TARGETS = {
  on: {
    state: "running",
    reasonCode: "manual_resume",
    reasonNote: "虚构演练：本地开发验证，打开生成开关。",
  },
  off: {
    state: "stopped",
    reasonCode: "manual_safety_stop",
    reasonNote: "虚构演练：本地开发验证，恢复生成开关关闭。",
  },
} as const;

async function main(): Promise<void> {
  const target = TARGETS[process.argv[2] as keyof typeof TARGETS];
  if (target === undefined) {
    console.error("Usage: generation-control-cli.ts <on|off>");
    process.exitCode = 1;
    return;
  }

  const config = loadConfig().database;
  if (config.database !== "xiaoban_dev") {
    throw new Error("GENERATION_CLI_DEV_ONLY");
  }

  const database = createDatabase(config);
  try {
    await assertDatabaseBaseline(database);
    const store = new GenerationControlStore(database);

    const current = await store.read();
    if (current.state === target.state) {
      console.log(`Generation control already ${target.state} (version ${current.version}).`);
      return;
    }

    const officerToken = randomBytes(32).toString("base64url");
    const now = new Date();
    const grantId = randomUUID();
    await database.insertInto("safety_access_grants").values({
      id: grantId,
      actor_id: GENERATION_CLI_ACTOR_ID,
      role: "duty_safety_officer",
      token_hash: hashSecret(officerToken),
      created_at: now,
      revoked_at: null,
    }).execute();

    const result = await store.change(officerToken, {
      requestId: randomUUID(),
      targetState: target.state,
      reasonCode: target.reasonCode,
      reasonNote: target.reasonNote,
    });

    await database.updateTable("safety_access_grants")
      .set({ revoked_at: new Date() })
      .where("id", "=", grantId)
      .execute();

    console.log(JSON.stringify({
      status: "ok",
      state: result.state,
      reasonCode: result.reasonCode,
      version: result.version,
      temporaryGrantRevoked: true,
    }));
  } finally {
    await database.destroy();
  }
}

try {
  await main();
} catch (error) {
  if (error instanceof Error && error.message === "GENERATION_CLI_DEV_ONLY") {
    console.error("Generation control CLI failed safely: GENERATION_CLI_DEV_ONLY");
  } else {
    console.error("Generation control CLI failed safely: INTERNAL_ERROR");
  }
  process.exitCode = 1;
}
