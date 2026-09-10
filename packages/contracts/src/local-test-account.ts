import { z } from "zod";

const localTestAliasSchema = z
  .string()
  .trim()
  .min(2)
  .max(20)
  .regex(/^[\p{L}\p{N}·_-]+$/u);

const localTestAgeBandSchema = z.enum(["9_11", "12_14"]);

export const localTestAccountSessionRequestSchema = z.strictObject({
  alias: localTestAliasSchema,
  ageBand: localTestAgeBandSchema,
});

export const localTestAccountSessionResponseSchema = z.strictObject({
  schemaVersion: z.literal("local-test-account-session-2026-08-v1"),
  account: z.strictObject({
    alias: localTestAliasSchema,
    ageBand: localTestAgeBandSchema,
    minorMode: z.literal(true),
  }),
  childSessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
});

export const localTestGuardianSessionResponseSchema = z.strictObject({
  schemaVersion: z.literal("local-test-guardian-session-2026-09-v1"),
  account: z.strictObject({
    alias: localTestAliasSchema,
    relationshipStatus: z.literal("verified"),
    synthetic: z.literal(true),
  }),
  guardianSessionToken: z.string().regex(/^[A-Za-z0-9_-]{43}$/u),
});

export type LocalTestAccountSessionRequest = z.infer<
  typeof localTestAccountSessionRequestSchema
>;

export type LocalTestAccountSessionResponse = z.infer<
  typeof localTestAccountSessionResponseSchema
>;

export type LocalTestGuardianSessionResponse = z.infer<
  typeof localTestGuardianSessionResponseSchema
>;
