export const RELEASE_EVALUATION_CHECKPOINT_SCHEMA_VERSION =
  "release-evaluation-checkpoint-v2" as const;

export interface CheckpointResult {
  caseId: string;
  status: "passed" | "failed" | "error";
  blockingFailure: boolean;
  reasonCodes?: readonly string[];
}

export interface ReleaseEvaluationAttempt<TResult extends CheckpointResult = CheckpointResult> {
  attemptId: string;
  caseId: string;
  attemptNumber: number;
  authorization: "initial" | "manual_diagnostic";
  recordedAt: string;
  result: TResult;
}

function attemptId(caseId: string, attemptNumber: number): string {
  return `${caseId}-attempt-${String(attemptNumber).padStart(3, "0")}`;
}

export function migrateLegacyCheckpointResults<TResult extends CheckpointResult>(
  results: readonly TResult[],
  recordedAt: string,
): ReleaseEvaluationAttempt<TResult>[] {
  return results.map((result) => ({
    attemptId: attemptId(result.caseId, 1),
    caseId: result.caseId,
    attemptNumber: 1,
    authorization: "initial",
    recordedAt,
    result,
  }));
}

export function effectiveCheckpointResults<TResult extends CheckpointResult>(
  attempts: readonly ReleaseEvaluationAttempt<TResult>[],
): TResult[] {
  const effective = new Map<string, TResult>();
  for (const attempt of attempts) effective.set(attempt.caseId, attempt.result);
  return [...effective.values()];
}

export function appendInitialResults<TResult extends CheckpointResult>(
  attempts: readonly ReleaseEvaluationAttempt<TResult>[],
  results: readonly TResult[],
  recordedAt: string,
): ReleaseEvaluationAttempt<TResult>[] {
  const next = [...attempts];
  const attemptedCaseIds = new Set(attempts.map((attempt) => attempt.caseId));
  for (const result of results) {
    if (attemptedCaseIds.has(result.caseId)) continue;
    next.push({
      attemptId: attemptId(result.caseId, 1),
      caseId: result.caseId,
      attemptNumber: 1,
      authorization: "initial",
      recordedAt,
      result,
    });
    attemptedCaseIds.add(result.caseId);
  }
  return next;
}

export function appendDiagnosticAttempt<TResult extends CheckpointResult>(
  attempts: readonly ReleaseEvaluationAttempt<TResult>[],
  result: TResult,
  recordedAt: string,
): ReleaseEvaluationAttempt<TResult>[] {
  assertDiagnosticAttemptAllowed(attempts, result.caseId);
  const caseAttempts = attempts.filter((attempt) => attempt.caseId === result.caseId);
  const latest = caseAttempts.at(-1)!;
  const attemptNumber = latest.attemptNumber + 1;
  return [
    ...attempts,
    {
      attemptId: attemptId(result.caseId, attemptNumber),
      caseId: result.caseId,
      attemptNumber,
      authorization: "manual_diagnostic",
      recordedAt,
      result,
    },
  ];
}

export function assertDiagnosticAttemptAllowed<TResult extends CheckpointResult>(
  attempts: readonly ReleaseEvaluationAttempt<TResult>[],
  caseId: string,
  expectedReasonCode?: string,
): void {
  const caseAttempts = attempts.filter((attempt) => attempt.caseId === caseId);
  const latest = caseAttempts.at(-1);
  if (
    latest?.result.status !== "error"
    || !latest.result.blockingFailure
    || caseAttempts.some((attempt) => attempt.authorization === "manual_diagnostic")
    || (
      expectedReasonCode !== undefined
      && !latest.result.reasonCodes?.includes(expectedReasonCode)
    )
  ) {
    throw new Error("RELEASE_EVALUATION_DIAGNOSTIC_RETRY_NOT_ALLOWED");
  }
}
