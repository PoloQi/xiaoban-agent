import { buildApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { assertDatabaseBaseline, createDatabase } from "./database/client.js";
import { ChildContentService } from "./content/child-content-service.js";
import { ContentService } from "./content/service.js";
import { EnrollmentService } from "./identity/service.js";
import { LocalTestAccountService } from "./identity/local-test-account.js";
import { createChildChatService } from "./chat/child-chat-runtime.js";
import { ChildGrowthService } from "./growth/child-growth-service.js";
import { ChildOnboardingService } from "./onboarding/child-onboarding-service.js";
import { ChildMoodService } from "./mood/child-mood-service.js";
import { ChildTrustedAdultService } from "./trusted/child-trusted-adult-service.js";
import { GuardianDashboardService } from "./guardian/guardian-dashboard-service.js";
import { RiskConsoleService } from "./tickets/risk-console-service.js";
import { LOCAL_TEST_ACCOUNT } from "./identity/local-test-account.js";

const LOOPBACK_HOSTS = new Set(["127.0.0.1", "localhost", "::1"]);

try {
  const config = loadConfig();
  const database = createDatabase(config.database);
  await assertDatabaseBaseline(database);
  const localDevAllowed =
    config.nodeEnv !== "production" && LOOPBACK_HOSTS.has(config.host.toLowerCase());
  const app = buildApp({
    childChatService: createChildChatService({
      configSource: process.env,
      database,
    }),
    childContentService: new ChildContentService(database),
    childGrowthService: new ChildGrowthService(database),
    childOnboardingService: new ChildOnboardingService(database),
    childMoodService: new ChildMoodService(database),
    childTrustedAdultService: new ChildTrustedAdultService(database),
    closeDatabase: () => database.destroy(),
    contentService: new ContentService(database),
    enrollmentService: new EnrollmentService(database),
    guardianDashboardService: new GuardianDashboardService(database, {
      ...(localDevAllowed
        ? { syntheticPreviewGuardianId: LOCAL_TEST_ACCOUNT.guardianId }
        : {}),
    }),
    riskConsoleService: new RiskConsoleService(database),
    probeDatabase: () => assertDatabaseBaseline(database),
    ...(localDevAllowed
      ? { localTestAccountService: new LocalTestAccountService(database) }
      : {}),
  });

  await app.listen({ host: config.host, port: config.port });
} catch (error) {
  if (error instanceof ConfigError) {
    console.error(error.message);
  } else {
    console.error("API failed to start.");
  }
  process.exitCode = 1;
}
