import { describe, expect, it } from "vitest";

import {
  LocalSyntheticNotificationAdapter,
  LocalSyntheticNotificationAdapterError,
} from "./local-synthetic-notification-adapter.js";

const fixedNow = new Date("2026-09-16T12:15:00.000Z");
const validInput = {
  synthetic: true,
  ticketId: "019c3000-0001-4001-8001-000000000001",
  outboxId: "019c3000-0002-4002-8002-000000000001",
  channel: "in_app" as const,
  claimRequestId: "019c3000-0003-4003-8003-000000000001",
  workerId: "019c3000-0004-4004-8004-000000000001",
  leaseToken: "019c3000-0005-4005-8005-000000000001",
};

describe("phase 6A.4/6A.5 local synthetic notification adapter", () => {
  it("records only a local attempt and explicitly remains not delivered", async () => {
    const adapter = new LocalSyntheticNotificationAdapter(() => fixedNow);
    const receipt = await adapter.attempt(validInput);
    expect(receipt).toEqual({
      outcome: "locally_attempted",
      networkCallMade: false,
      delivered: false,
      attemptedAt: "2026-09-16T12:15:00.000Z",
    });
  });

  it("supports the two approved synthetic channels", async () => {
    const adapter = new LocalSyntheticNotificationAdapter(() => fixedNow);
    await expect(adapter.attempt({ ...validInput, channel: "off_site_backup" })).resolves.toMatchObject({
      outcome: "locally_attempted",
      networkCallMade: false,
      delivered: false,
    });
  });

  it("rejects non-synthetic data, unknown channels, and malformed identifiers", async () => {
    const adapter = new LocalSyntheticNotificationAdapter(() => fixedNow);
    await expect(adapter.attempt({ ...validInput, synthetic: false }))
      .rejects.toEqual(new LocalSyntheticNotificationAdapterError("LOCAL_SYNTHETIC_NOTIFICATION_INVALID"));
    await expect(adapter.attempt({ ...validInput, channel: "sms" }))
      .rejects.toEqual(new LocalSyntheticNotificationAdapterError("LOCAL_SYNTHETIC_NOTIFICATION_INVALID"));
    await expect(adapter.attempt({ ...validInput, ticketId: "not-a-uuid" }))
      .rejects.toEqual(new LocalSyntheticNotificationAdapterError("LOCAL_SYNTHETIC_NOTIFICATION_INVALID"));
    await expect(adapter.attempt({ ...validInput, phoneNumber: "13800000000" }))
      .rejects.toEqual(new LocalSyntheticNotificationAdapterError("LOCAL_SYNTHETIC_NOTIFICATION_INVALID"));
  });

  it("supports deterministic local simulated failure without network or delivery", async () => {
    const adapter = new LocalSyntheticNotificationAdapter(() => fixedNow);
    await expect(adapter.attempt({ ...validInput, failureMode: "local_simulated_failure" }))
      .resolves.toEqual({
        outcome: "local_simulated_failure",
        networkCallMade: false,
        delivered: false,
        attemptedAt: "2026-09-16T12:15:00.000Z",
      });
    await expect(adapter.attempt({ ...validInput, failureMode: "network_sms" }))
      .rejects.toEqual(new LocalSyntheticNotificationAdapterError("LOCAL_SYNTHETIC_NOTIFICATION_INVALID"));
  });
});

