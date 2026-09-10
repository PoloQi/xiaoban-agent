import { releaseSafetyEvaluationValidationReport } from "./release-safety-evaluation-dataset.js";

process.stdout.write(`${JSON.stringify(releaseSafetyEvaluationValidationReport, null, 2)}\n`);
