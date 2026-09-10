export interface ReleaseSafetyBatchCase {
  id: string;
}

export interface ReleaseSafetyBatchResult {
  caseId: string;
  blockingFailure: boolean;
}

export interface ExecuteReleaseSafetyBatchesOptions<
  TCase extends ReleaseSafetyBatchCase,
  TResult extends ReleaseSafetyBatchResult,
> {
  cases: readonly TCase[];
  existingResults: readonly TResult[];
  batchSize: number;
  maxConcurrency: number;
  evaluate: (evaluationCase: TCase) => Promise<TResult>;
  checkpoint: (results: readonly TResult[]) => Promise<unknown>;
  onBatchComplete?: (summary: {
    batch: number;
    completedCases: number;
    blockingFailures: number;
  }) => void;
}

export async function executeReleaseSafetyBatches<
  TCase extends ReleaseSafetyBatchCase,
  TResult extends ReleaseSafetyBatchResult,
>(options: ExecuteReleaseSafetyBatchesOptions<TCase, TResult>): Promise<{
  results: TResult[];
  stopped: boolean;
}> {
  if (
    !Number.isInteger(options.batchSize)
    || options.batchSize < 1
    || options.batchSize > 25
    || !Number.isInteger(options.maxConcurrency)
    || options.maxConcurrency < 1
    || options.maxConcurrency > 2
  ) {
    throw new Error("RELEASE_EVALUATION_EXECUTION_LIMIT_INVALID");
  }
  const results = [...options.existingResults];
  const completedIds = new Set(results.map((result) => result.caseId));
  if (completedIds.size !== results.length) {
    throw new Error("RELEASE_EVALUATION_CHECKPOINT_DUPLICATE_ID");
  }
  const pending = options.cases.filter((evaluationCase) => !completedIds.has(evaluationCase.id));
  let stopped = results.some((result) => result.blockingFailure);
  if (stopped) return { results, stopped };

  for (let batchStart = 0; batchStart < pending.length && !stopped; batchStart += options.batchSize) {
    const batch = pending.slice(batchStart, batchStart + options.batchSize);
    for (let index = 0; index < batch.length; index += options.maxConcurrency) {
      const group = batch.slice(index, index + options.maxConcurrency);
      const groupResults = await Promise.all(group.map(options.evaluate));
      for (const result of groupResults) {
        if (completedIds.has(result.caseId)) {
          throw new Error("RELEASE_EVALUATION_RESULT_DUPLICATE_ID");
        }
        completedIds.add(result.caseId);
        results.push(result);
      }
      await options.checkpoint(results);
      stopped = groupResults.some((result) => result.blockingFailure);
      if (stopped) break;
    }
    options.onBatchComplete?.({
      batch: Math.floor(batchStart / options.batchSize) + 1,
      completedCases: results.length,
      blockingFailures: results.filter((result) => result.blockingFailure).length,
    });
  }
  return { results, stopped };
}
