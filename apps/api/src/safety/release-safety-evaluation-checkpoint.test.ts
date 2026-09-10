import { describe, expect, it } from "vitest";

import {
  appendDiagnosticAttempt,
  appendInitialResults,
  assertDiagnosticAttemptAllowed,
  effectiveCheckpointResults,
  migrateLegacyCheckpointResults,
} from "./release-safety-evaluation-checkpoint.js";

const passedResult = {
  caseId: "release-eval-ordinary-001",
  blockingFailure: false,
  status: "passed" as const,
};
const initialError = {
  caseId: "release-eval-ordinary-051",
  blockingFailure: true,
  status: "error" as const,
  reasonCodes: ["RISK_MODEL_RESPONSE_INVALID"],
};

describe("release safety evaluation checkpoint attempts", () => {
  it("migrates legacy results into immutable initial attempts", () => {
    const attempts = migrateLegacyCheckpointResults(
      [passedResult, initialError],
      "2026-08-20T14:25:00.000Z",
    );

    expect(attempts).toEqual([
      expect.objectContaining({
        attemptId: "release-eval-ordinary-001-attempt-001",
        attemptNumber: 1,
        authorization: "initial",
        result: passedResult,
      }),
      expect.objectContaining({
        attemptId: "release-eval-ordinary-051-attempt-001",
        attemptNumber: 1,
        authorization: "initial",
        result: initialError,
      }),
    ]);
  });

  it("appends one diagnostic attempt without replacing the first error", () => {
    const initialAttempts = migrateLegacyCheckpointResults(
      [initialError],
      "2026-08-20T14:25:00.000Z",
    );
    const retryResult = {
      ...initialError,
      status: "passed" as const,
      blockingFailure: false,
      reasonCodes: ["exact_match"],
    };
    const attempts = appendDiagnosticAttempt(
      initialAttempts,
      retryResult,
      "2026-08-20T14:40:00.000Z",
    );

    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toEqual(initialAttempts[0]);
    expect(attempts[1]).toMatchObject({
      attemptId: "release-eval-ordinary-051-attempt-002",
      attemptNumber: 2,
      authorization: "manual_diagnostic",
      result: retryResult,
    });
    expect(effectiveCheckpointResults(attempts)).toEqual([retryResult]);
    expect(() => assertDiagnosticAttemptAllowed(
      attempts,
      retryResult.caseId,
    )).toThrowError("RELEASE_EVALUATION_DIAGNOSTIC_RETRY_NOT_ALLOWED");
    expect(() => appendDiagnosticAttempt(
      attempts,
      retryResult,
      "2026-08-20T14:41:00.000Z",
    )).toThrowError("RELEASE_EVALUATION_DIAGNOSTIC_RETRY_NOT_ALLOWED");
  });

  it("requires the authorized diagnostic reason code when one is specified", () => {
    const initialAttempts = migrateLegacyCheckpointResults(
      [initialError],
      "2026-08-20T14:25:00.000Z",
    );

    expect(() => assertDiagnosticAttemptAllowed(
      initialAttempts,
      initialError.caseId,
      "RISK_MODEL_CANDIDATE_INVALID",
    )).toThrowError("RELEASE_EVALUATION_DIAGNOSTIC_RETRY_NOT_ALLOWED");
    expect(() => assertDiagnosticAttemptAllowed(
      initialAttempts,
      initialError.caseId,
      "RISK_MODEL_RESPONSE_INVALID",
    )).not.toThrow();
  });

  it("only appends initial results for cases without an attempt", () => {
    const attempts = migrateLegacyCheckpointResults(
      [initialError],
      "2026-08-20T14:25:00.000Z",
    );
    const next = appendInitialResults(
      attempts,
      [initialError, passedResult],
      "2026-08-20T14:45:00.000Z",
    );

    expect(next).toHaveLength(2);
    expect(next[0]).toEqual(attempts[0]);
    expect(next[1]).toMatchObject({
      caseId: passedResult.caseId,
      attemptNumber: 1,
      authorization: "initial",
      result: passedResult,
    });
  });
});
