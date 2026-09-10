import { constants } from "node:fs";
import { copyFile, mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  RELEASE_SAFETY_EVALUATION_DATASET_VERSION,
  releaseSafetyAdversarialThreatSchema,
  releaseSafetyEvaluationManifest,
  releaseSafetyEvaluationTrackSchema,
  releaseSafetyForbiddenOutcomeSchema,
  riskCategorySchema,
  riskLevelSchema,
  riskModelStructureTraceSchema,
} from "@xiaoban/contracts";
import { z } from "zod";

import { DeepSeekGateway } from "../ai/deepseek-gateway.js";
import { loadDeepSeekConfig } from "../ai/model-config.js";
import { DeepSeekRiskClassifier } from "./deepseek-risk-classifier.js";
import {
  appendDiagnosticAttempt,
  appendInitialResults,
  assertDiagnosticAttemptAllowed,
  effectiveCheckpointResults,
  migrateLegacyCheckpointResults,
  RELEASE_EVALUATION_CHECKPOINT_SCHEMA_VERSION,
  type ReleaseEvaluationAttempt,
} from "./release-safety-evaluation-checkpoint.js";
import { executeReleaseSafetyBatches } from "./release-safety-evaluation-runner.js";
import { releaseSafetyEvaluationCases } from "./release-safety-evaluation-dataset.js";
import {
  buildReleaseSafetyEvaluationReport,
  evaluateReleaseSafetyCase,
  releaseSafetyErrorResult,
  type ReleaseSafetyEvaluationResult,
} from "./release-safety-evaluator.js";

const ORIGINAL_DIAGNOSTIC_CASE_ID = "release-eval-ordinary-051";
const INPUT_BOUNDARY_DIAGNOSTIC_CASE_IDS = [
  "release-eval-risk-l2-031",
  "release-eval-risk-l2-032",
] as const;
const CANDIDATE_DIAGNOSTIC_CASE_ID = "release-eval-risk-l2-044";
const L3_CANDIDATE_DIAGNOSTIC_CASE_ID = "release-eval-risk-l3-025";
const L1_CANDIDATE_DIAGNOSTIC_CASE_ID = "release-eval-risk-l1-009";
const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../../..");
const outputDirectory = join(
  projectRoot,
  ".local",
  "evaluation",
  RELEASE_SAFETY_EVALUATION_DATASET_VERSION,
);
const checkpointPath = join(outputDirectory, "checkpoint.json");

const usageSchema = z.object({
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  totalTokens: z.number().int().min(0),
}).strict();

const checkpointResultSchema = z.object({
  caseId: z.string().regex(/^release-eval-[a-z0-9-]+-\d{3}$/u),
  track: releaseSafetyEvaluationTrackSchema,
  status: z.enum(["passed", "failed", "error"]),
  blockingFailure: z.boolean(),
  reasonCodes: z.array(z.string().min(1).max(80)).max(10),
  modelCall: z.boolean(),
  durationMs: z.number().int().min(0),
  usage: usageSchema,
  expectedLevel: riskLevelSchema.optional(),
  expectedCategory: riskCategorySchema.optional(),
  expectedRoute: z.enum(["reviewed_ai", "support_and_offer_adult", "fixed_safety"]).optional(),
  actualLevel: riskLevelSchema.optional(),
  actualCategory: riskCategorySchema.optional(),
  actualRoute: z.enum([
    "reviewed_ai",
    "support_and_offer_adult",
    "fixed_safety",
    "static_only",
  ]).optional(),
  ruleLevel: riskLevelSchema.optional(),
  modelLevel: riskLevelSchema.optional(),
  inputBoundaryDecision: z.enum(["allow", "allow_redacted", "block"]).optional(),
  inputBoundaryReasonCodes: z.array(z.string().min(1).max(80)).max(10).optional(),
  inputBoundaryPass: z.boolean().optional(),
  classificationEvaluationMode: z.enum([
    "product_sanitized",
    "synthetic_evaluation_only",
  ]).optional(),
  exactMatch: z.boolean().optional(),
  routePass: z.boolean().optional(),
  forbiddenOutcome: releaseSafetyForbiddenOutcomeSchema.optional(),
  candidateIntent: z.enum([
    "general_support",
    "activity_suggestion",
    "knowledge_answer",
    "decline",
  ]).optional(),
  outputDecision: z.enum(["approve", "fallback"]).optional(),
  outputReasonCodes: z.array(z.string().min(1).max(80)).max(10).optional(),
  threat: releaseSafetyAdversarialThreatSchema.optional(),
  expectedDecision: z.enum(["block", "allow_redacted"]).optional(),
  actualDecision: z.enum(["block", "allow", "allow_redacted"]).optional(),
  actualReasonCodes: z.array(z.string().min(1).max(80)).max(10).optional(),
  riskModelStructure: riskModelStructureTraceSchema.optional(),
}).strict();

const legacyCheckpointSchema = z.object({
  datasetVersion: z.literal(RELEASE_SAFETY_EVALUATION_DATASET_VERSION),
  versions: z.record(z.string(), z.string()),
  updatedAt: z.iso.datetime(),
  results: z.array(checkpointResultSchema).max(500),
}).strict();

const checkpointAttemptSchema = z.object({
  attemptId: z.string().regex(/^release-eval-[a-z0-9-]+-\d{3}-attempt-\d{3}$/u),
  caseId: z.string().regex(/^release-eval-[a-z0-9-]+-\d{3}$/u),
  attemptNumber: z.number().int().min(1).max(2),
  authorization: z.enum(["initial", "manual_diagnostic"]),
  recordedAt: z.iso.datetime(),
  result: checkpointResultSchema,
}).strict();

const checkpointSchema = z.object({
  schemaVersion: z.literal(RELEASE_EVALUATION_CHECKPOINT_SCHEMA_VERSION),
  datasetVersion: z.literal(RELEASE_SAFETY_EVALUATION_DATASET_VERSION),
  versions: z.record(z.string(), z.string()),
  updatedAt: z.iso.datetime(),
  attempts: z.array(checkpointAttemptSchema).max(
    releaseSafetyEvaluationManifest.totalCases + 5,
  ),
}).strict();

type RunMode =
  | "preflight"
  | "full"
  | "diagnostic"
  | "diagnostic-input-boundary"
  | "diagnostic-candidate"
  | "diagnostic-l3-candidate"
  | "diagnostic-l1-candidate";

interface CheckpointState {
  attempts: ReleaseEvaluationAttempt<ReleaseSafetyEvaluationResult>[];
  source: "legacy" | "attempts" | "empty";
}

function parseMode(): RunMode {
  const argumentsList = process.argv.slice(2);
  const mode = argumentsList.find((value) => value.startsWith("--mode="));
  const caseId = argumentsList.find((value) => value.startsWith("--case-id="));
  if (mode === "--mode=preflight" && caseId === undefined) return "preflight";
  if (mode === "--mode=full" && caseId === undefined) return "full";
  if (
    mode === "--mode=diagnostic"
    && caseId === `--case-id=${ORIGINAL_DIAGNOSTIC_CASE_ID}`
  ) return "diagnostic";
  if (mode === "--mode=diagnostic-input-boundary" && caseId === undefined) {
    return "diagnostic-input-boundary";
  }
  if (mode === "--mode=diagnostic-candidate" && caseId === undefined) {
    return "diagnostic-candidate";
  }
  if (mode === "--mode=diagnostic-l3-candidate" && caseId === undefined) {
    return "diagnostic-l3-candidate";
  }
  if (mode === "--mode=diagnostic-l1-candidate" && caseId === undefined) {
    return "diagnostic-l1-candidate";
  }
  throw new Error("RELEASE_EVALUATION_MODE_INVALID");
}

function validateAttempts(
  attempts: readonly ReleaseEvaluationAttempt<ReleaseSafetyEvaluationResult>[],
): void {
  const knownIds = new Set(releaseSafetyEvaluationCases.map((item) => item.id));
  const attemptIds = new Set<string>();
  const byCase = new Map<string, ReleaseEvaluationAttempt<ReleaseSafetyEvaluationResult>[]>();
  for (const attempt of attempts) {
    if (
      !knownIds.has(attempt.caseId)
      || attempt.result.caseId !== attempt.caseId
      || attemptIds.has(attempt.attemptId)
    ) throw new Error("RELEASE_EVALUATION_CHECKPOINT_INVALID");
    attemptIds.add(attempt.attemptId);
    const caseAttempts = byCase.get(attempt.caseId) ?? [];
    caseAttempts.push(attempt);
    byCase.set(attempt.caseId, caseAttempts);
  }
  for (const [caseId, caseAttempts] of byCase) {
    if (caseAttempts.length > 2) throw new Error("RELEASE_EVALUATION_CHECKPOINT_INVALID");
    caseAttempts.forEach((attempt, index) => {
      const number = index + 1;
      const authorization = number === 1 ? "initial" : "manual_diagnostic";
      const expectedId = `${caseId}-attempt-${String(number).padStart(3, "0")}`;
      if (
        attempt.attemptNumber !== number
        || attempt.authorization !== authorization
        || attempt.attemptId !== expectedId
      ) throw new Error("RELEASE_EVALUATION_CHECKPOINT_INVALID");
    });
  }
}

function validateVersions(versions: Record<string, string>): void {
  if (JSON.stringify(versions) !== JSON.stringify(releaseSafetyEvaluationManifest.versions)) {
    throw new Error("RELEASE_EVALUATION_CHECKPOINT_INVALID");
  }
}

async function readCheckpoint(): Promise<CheckpointState> {
  let serialized: string;
  try {
    serialized = await readFile(checkpointPath, "utf8");
  } catch (error) {
    if (error !== null && typeof error === "object" && "code" in error && error.code === "ENOENT") {
      return { attempts: [], source: "empty" };
    }
    throw new Error("RELEASE_EVALUATION_CHECKPOINT_UNAVAILABLE");
  }
  let raw: unknown;
  try {
    raw = JSON.parse(serialized);
  } catch {
    throw new Error("RELEASE_EVALUATION_CHECKPOINT_INVALID");
  }
  const current = checkpointSchema.safeParse(raw);
  if (current.success) {
    validateVersions(current.data.versions);
    const attempts = current.data.attempts as unknown as ReleaseEvaluationAttempt<
      ReleaseSafetyEvaluationResult
    >[];
    validateAttempts(attempts);
    return { attempts, source: "attempts" };
  }
  const legacy = legacyCheckpointSchema.safeParse(raw);
  if (!legacy.success) throw new Error("RELEASE_EVALUATION_CHECKPOINT_INVALID");
  validateVersions(legacy.data.versions);
  const results = legacy.data.results as unknown as ReleaseSafetyEvaluationResult[];
  if (new Set(results.map((item) => item.caseId)).size !== results.length) {
    throw new Error("RELEASE_EVALUATION_CHECKPOINT_INVALID");
  }
  const attempts = migrateLegacyCheckpointResults(results, legacy.data.updatedAt);
  validateAttempts(attempts);
  return { attempts, source: "legacy" };
}

async function writeJsonSafely(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const temporaryPath = `${path}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await copyFile(temporaryPath, path);
  await unlink(temporaryPath);
}

async function writeCheckpoint(
  previous: readonly ReleaseEvaluationAttempt<ReleaseSafetyEvaluationResult>[],
  attempts: readonly ReleaseEvaluationAttempt<ReleaseSafetyEvaluationResult>[],
): Promise<void> {
  if (
    attempts.length < previous.length
    || JSON.stringify(attempts.slice(0, previous.length)) !== JSON.stringify(previous)
  ) throw new Error("RELEASE_EVALUATION_CHECKPOINT_APPEND_ONLY_VIOLATION");
  validateAttempts(attempts);
  await writeJsonSafely(checkpointPath, {
    schemaVersion: RELEASE_EVALUATION_CHECKPOINT_SCHEMA_VERSION,
    datasetVersion: RELEASE_SAFETY_EVALUATION_DATASET_VERSION,
    versions: releaseSafetyEvaluationManifest.versions,
    updatedAt: new Date().toISOString(),
    attempts,
  });
}

async function archivePartialFullReport(targetName: string): Promise<void> {
  const source = join(outputDirectory, "full-report.json");
  const target = join(outputDirectory, targetName);
  try {
    await copyFile(source, target, constants.COPYFILE_EXCL);
  } catch (error) {
    if (
      error !== null
      && typeof error === "object"
      && "code" in error
      && (error.code === "EEXIST" || error.code === "ENOENT")
    ) return;
    throw new Error("RELEASE_EVALUATION_CHECKPOINT_UNAVAILABLE");
  }
}

function attemptSummary(
  attempts: readonly ReleaseEvaluationAttempt<ReleaseSafetyEvaluationResult>[],
) {
  return {
    totalAttempts: attempts.length,
    diagnosticAttempts: attempts.filter(
      (attempt) => attempt.authorization === "manual_diagnostic",
    ).length,
    casesWithMultipleAttempts: new Set(
      attempts.filter((attempt) => attempt.attemptNumber > 1).map((attempt) => attempt.caseId),
    ).size,
  };
}

async function main(): Promise<void> {
  const mode = parseMode();
  const checkpoint = await readCheckpoint();
  const config = loadDeepSeekConfig(process.env);
  const classifier = new DeepSeekRiskClassifier(config);
  const gateway = new DeepSeekGateway(config);
  const evaluate = async (
    evaluationCase: (typeof releaseSafetyEvaluationCases)[number],
  ): Promise<ReleaseSafetyEvaluationResult> => {
    const startedAt = performance.now();
    let modelCall = false;
    try {
      return await evaluateReleaseSafetyCase(evaluationCase, {
        classify: (request) => {
          modelCall = true;
          return classifier.classify(request);
        },
        generate: (request) => {
          modelCall = true;
          return gateway.generate(request);
        },
      });
    } catch (error) {
      return releaseSafetyErrorResult(
        evaluationCase,
        error,
        performance.now() - startedAt,
        modelCall,
      );
    }
  };

  if (
    mode === "diagnostic"
    || mode === "diagnostic-input-boundary"
    || mode === "diagnostic-candidate"
    || mode === "diagnostic-l3-candidate"
    || mode === "diagnostic-l1-candidate"
  ) {
    const caseIds: readonly string[] = mode === "diagnostic"
      ? [ORIGINAL_DIAGNOSTIC_CASE_ID]
      : mode === "diagnostic-input-boundary"
        ? INPUT_BOUNDARY_DIAGNOSTIC_CASE_IDS
        : mode === "diagnostic-candidate"
          ? [CANDIDATE_DIAGNOSTIC_CASE_ID]
          : mode === "diagnostic-l3-candidate"
            ? [L3_CANDIDATE_DIAGNOSTIC_CASE_ID]
            : [L1_CANDIDATE_DIAGNOSTIC_CASE_ID];
    const diagnosticCases = caseIds.map((caseId) =>
      releaseSafetyEvaluationCases.find((item) => item.id === caseId)
    );
    if (diagnosticCases.some((item) => item === undefined)) {
      throw new Error("RELEASE_EVALUATION_INTERNAL_ERROR");
    }
    for (const caseId of caseIds) {
      assertDiagnosticAttemptAllowed(
        checkpoint.attempts,
        caseId,
        mode === "diagnostic-l1-candidate" ? "RISK_MODEL_CANDIDATE_INVALID" : undefined,
      );
    }
    const reportFileName = mode === "diagnostic"
      ? "diagnostic-report.json"
      : mode === "diagnostic-input-boundary"
        ? "diagnostic-input-boundary-report.json"
        : mode === "diagnostic-candidate"
          ? "diagnostic-candidate-report.json"
          : mode === "diagnostic-l3-candidate"
            ? "diagnostic-l3-candidate-report.json"
            : "diagnostic-l1-candidate-report.json";
    await archivePartialFullReport(
      mode === "diagnostic"
        ? "full-report-before-diagnostic.json"
        : mode === "diagnostic-input-boundary"
          ? "full-report-before-input-boundary-diagnostic.json"
          : mode === "diagnostic-candidate"
            ? "full-report-before-candidate-diagnostic.json"
            : mode === "diagnostic-l3-candidate"
              ? "full-report-before-l3-candidate-diagnostic.json"
              : "full-report-before-l1-candidate-diagnostic.json",
    );
    const results = await Promise.all(diagnosticCases.map((item) => evaluate(item!)));
    let attempts = checkpoint.attempts;
    for (const result of results) {
      attempts = appendDiagnosticAttempt(attempts, result, new Date().toISOString());
    }
    await writeCheckpoint(checkpoint.attempts, attempts);
    const passed = results.every((result) => result.status === "passed");
    const report = {
      generatedAt: new Date().toISOString(),
      datasetVersion: RELEASE_SAFETY_EVALUATION_DATASET_VERSION,
      mode,
      caseIds,
      passed,
      ...attemptSummary(attempts),
      results,
    };
    const reportPath = join(outputDirectory, reportFileName);
    await writeJsonSafely(reportPath, report);
    process.stdout.write(`${JSON.stringify({
      status: passed ? "passed" : "failed",
      reportPath,
      cases: results.map((result) => ({
        caseId: result.caseId,
        resultStatus: result.status,
        blockingFailure: result.blockingFailure,
        reasonCodes: result.reasonCodes,
      })),
      ...attemptSummary(attempts),
    })}\n`);
    if (!passed) process.exitCode = 1;
    return;
  }

  const selectedCases = mode === "preflight"
    ? releaseSafetyEvaluationCases.filter((item) => item.preflight)
    : releaseSafetyEvaluationCases;
  const selectedIds = new Set(selectedCases.map((item) => item.id));
  const existingResults = effectiveCheckpointResults(checkpoint.attempts).filter((result) =>
    selectedIds.has(result.caseId)
  );
  let attempts = checkpoint.attempts;
  const run = await executeReleaseSafetyBatches({
    cases: selectedCases,
    existingResults,
    batchSize: mode === "preflight"
      ? releaseSafetyEvaluationManifest.execution.preflightCases
      : releaseSafetyEvaluationManifest.execution.batchSize,
    maxConcurrency: releaseSafetyEvaluationManifest.execution.maxConcurrency,
    evaluate,
    checkpoint: async (results) => {
      const next = appendInitialResults(attempts, results, new Date().toISOString());
      await writeCheckpoint(attempts, next);
      attempts = next;
    },
    onBatchComplete: (summary) => {
      process.stdout.write(`${JSON.stringify({ status: "batch_complete", mode, ...summary })}\n`);
    },
  });
  const report = {
    generatedAt: new Date().toISOString(),
    stoppedEarly: run.stopped,
    ...attemptSummary(attempts),
    ...buildReleaseSafetyEvaluationReport(run.results, mode),
  };
  const reportPath = join(outputDirectory, `${mode}-report.json`);
  await writeJsonSafely(reportPath, report);
  const summary = Object.fromEntries(
    Object.entries(report).filter(([key]) => key !== "cases"),
  );
  process.stdout.write(`${JSON.stringify({
    status: report.passed ? "passed" : "failed",
    reportPath,
    ...summary,
  })}\n`);
  if (!report.passed) process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  const allowed = new Set([
    "RELEASE_EVALUATION_MODE_INVALID",
    "RELEASE_EVALUATION_CHECKPOINT_UNAVAILABLE",
    "RELEASE_EVALUATION_CHECKPOINT_INVALID",
    "RELEASE_EVALUATION_CHECKPOINT_APPEND_ONLY_VIOLATION",
    "RELEASE_EVALUATION_DIAGNOSTIC_RETRY_NOT_ALLOWED",
    "RELEASE_EVALUATION_EXECUTION_LIMIT_INVALID",
  ]);
  const code = error instanceof Error && allowed.has(error.message)
    ? error.message
    : error !== null && typeof error === "object" && "fields" in error
      ? "DEEPSEEK_CONFIGURATION_INVALID"
      : "RELEASE_EVALUATION_INTERNAL_ERROR";
  process.stderr.write(`${JSON.stringify({ status: "failed", code })}\n`);
  process.exitCode = 1;
}
