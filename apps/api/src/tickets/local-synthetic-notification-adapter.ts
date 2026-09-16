import { requestIdSchema } from "@xiaoban/contracts";

export interface LocalSyntheticNotificationAttemptInput {
  synthetic: true;
  failureMode?: "local_simulated_failure";
  ticketId: string;
  outboxId: string;
  channel: "in_app" | "off_site_backup";
  claimRequestId: string;
  workerId: string;
  leaseToken: string;
}

export type LocalSyntheticNotificationAttemptReceipt =
  | {
      outcome: "locally_attempted";
      networkCallMade: false;
      delivered: false;
      attemptedAt: string;
    }
  | {
      outcome: "local_simulated_failure";
      networkCallMade: false;
      delivered: false;
      attemptedAt: string;
    };

export class LocalSyntheticNotificationAdapterError extends Error {
  constructor(readonly code: "LOCAL_SYNTHETIC_NOTIFICATION_INVALID") {
    super(code);
    this.name = "LocalSyntheticNotificationAdapterError";
  }
}

export class LocalSyntheticNotificationAdapter {
  constructor(
    private readonly now: () => Date = () => new Date(),
    private readonly configuredOutcome: "locally_attempted" | "local_simulated_failure" = "locally_attempted",
  ) {}

  async attempt(rawInput: unknown): Promise<LocalSyntheticNotificationAttemptReceipt> {
    if (rawInput === null || typeof rawInput !== "object") {
      throw new LocalSyntheticNotificationAdapterError("LOCAL_SYNTHETIC_NOTIFICATION_INVALID");
    }
    const input = rawInput as Record<string, unknown>;
    const allowedFields = new Set([
      "synthetic",
      "ticketId",
      "outboxId",
      "channel",
      "claimRequestId",
      "workerId",
      "leaseToken",
      "failureMode",
    ]);
    if (Object.keys(input).some((key) => !allowedFields.has(key))) {
      throw new LocalSyntheticNotificationAdapterError("LOCAL_SYNTHETIC_NOTIFICATION_INVALID");
    }
    const idFields = [
      requestIdSchema.safeParse(input.ticketId),
      requestIdSchema.safeParse(input.outboxId),
      requestIdSchema.safeParse(input.claimRequestId),
      requestIdSchema.safeParse(input.workerId),
      requestIdSchema.safeParse(input.leaseToken),
    ];
    const validIds = idFields.every((result) => result.success);
    const validChannel = input.channel === "in_app" || input.channel === "off_site_backup";
    if (input.synthetic !== true || !validIds || !validChannel) {
      throw new LocalSyntheticNotificationAdapterError("LOCAL_SYNTHETIC_NOTIFICATION_INVALID");
    }

    if (input.failureMode !== undefined && input.failureMode !== "local_simulated_failure") {
      throw new LocalSyntheticNotificationAdapterError("LOCAL_SYNTHETIC_NOTIFICATION_INVALID");
    }

    return {
      outcome: input.failureMode ?? this.configuredOutcome,
      networkCallMade: false,
      delivered: false,
      attemptedAt: this.now().toISOString(),
    };
  }
}

