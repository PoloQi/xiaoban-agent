import { evaluateRiskRules } from "./risk-evaluator.js";
import { riskEvaluationSeedCases } from "./risk-evaluation-seed.js";

const report = evaluateRiskRules(riskEvaluationSeedCases);
console.log(JSON.stringify(report));
if (report.failures.length > 0) process.exitCode = 1;
