import {
  certifiedTaskIds,
  certifiedTaskMaxScoreFor,
} from "../benchmarks/src/workloads/certified-task-score-policy.ts";

export function validateReleaseBenchmarkArtifact(document, evidence) {
  const certification = requireRecord(document?.certification, "certification runtime evidence");
  if (certification.passed !== true || !Array.isArray(certification.failures) || certification.failures.length !== 0) {
    throw new Error("Benchmark certification artifact is not passing");
  }
  validateArtifactBinding(certification.binding, evidence.binding);
  validateThresholds(certification.thresholds, evidence.thresholds);
  if (!Array.isArray(document.results) || document.results.length !== 36) {
    throw new Error("Benchmark certification result artifact requires exactly 36 runtime evidence rows");
  }
  const rows = new Map();
  for (const [index, value] of document.results.entries()) {
    const row = validateRuntimeRow(value, index, evidence.matrix.expectedResolvedModel);
    const key = `${row.run}:${row.agent}:${row.task}`;
    if (rows.has(key)) throw new Error(`Benchmark certification result artifact has duplicate cell ${key}`);
    rows.set(key, row);
  }
  for (let run = 1; run <= 3; run += 1) {
    for (const agent of ["p", "pi", "kilo"]) {
      for (const task of certifiedTaskIds) {
        if (!rows.has(`${run}:${agent}:${task}`)) {
          throw new Error(`Benchmark certification result artifact is missing runtime evidence for ${run}:${agent}:${task}`);
        }
      }
    }
  }
  for (const [metric, threshold] of pairedMetrics(evidence.thresholds)) {
    for (const baseline of ["pi", "kilo"]) {
      validatePairedMetric(rows, baseline, metric, threshold);
    }
  }
  for (const baseline of ["pi", "kilo"]) {
    for (const task of certifiedTaskIds) validateStrictQualityDominance(rows, baseline, task);
  }
}

function validateRuntimeRow(value, index, expectedModel) {
  const row = requireRecord(value, `row ${index} runtime evidence`);
  const maxScore = certifiedTaskMaxScoreFor(row.task);
  if (!Number.isSafeInteger(row.run) || row.run < 1 || row.run > 3 || !["p", "pi", "kilo"].includes(row.agent)) {
    throw new Error(`Benchmark certification row ${index} has invalid runtime evidence identity`);
  }
  if (maxScore === undefined) throw new Error(`Benchmark certification row ${index} has invalid runtime evidence task`);
  if (!["passed", "failed", "timed_out", "skipped"].includes(row.status)) {
    throw new Error(`Benchmark certification row ${index} has invalid runtime evidence status`);
  }
  positive(row.elapsedMs, `row ${index} duration runtime evidence`);
  if (row.exitCode !== 0 || row.timedOut !== false || row.status === "timed_out" || row.status === "skipped") {
    throw new Error(`Benchmark certification row ${index} has incomplete runtime evidence`);
  }
  nonnegative(row.nudges, `row ${index} nudge runtime evidence`);
  const metrics = requireRecord(row.metrics, `row ${index} metrics runtime evidence`);
  nonnegativeInteger(metrics.toolCalls, `row ${index} tool-call runtime evidence`);
  if (metrics.toolErrors !== 0 || !Array.isArray(metrics.errors) || metrics.errors.length !== 0) {
    throw new Error(`Benchmark certification row ${index} has tool-error runtime evidence`);
  }
  if (metrics.responseModel !== expectedModel || !sameNonemptyModels(metrics.responseModels, expectedModel)) {
    throw new Error(`Benchmark certification row ${index} has mismatched model runtime evidence`);
  }
  const usage = requireRecord(metrics.usage, `row ${index} usage runtime evidence`);
  for (const field of ["input", "output", "cacheRead", "cacheWrite"]) {
    nonnegative(usage[field], `row ${index} ${field} runtime evidence`);
  }
  positive(usage.totalTokens, `row ${index} token runtime evidence`);
  if (usage.cost !== undefined) nonnegative(monetaryCost(usage.cost), `row ${index} cost runtime evidence`);
  const quality = requireRecord(row.quality, `row ${index} quality runtime evidence`);
  if (typeof quality.passed !== "boolean") {
    throw new Error(`Benchmark certification row ${index} has invalid quality.passed runtime evidence`);
  }
  for (const field of ["score", "maxScore", "rawScore", "penalty"]) {
    nonnegative(quality[field], `row ${index} quality.${field} runtime evidence`);
  }
  if (
    quality.maxScore !== maxScore ||
    quality.score > maxScore ||
    quality.rawScore > maxScore ||
    quality.score !== Math.max(0, quality.rawScore - quality.penalty)
  ) {
    throw new Error(`Benchmark certification row ${index} has inconsistent quality runtime evidence`);
  }
  if (
    row.agent === "p" &&
    (row.status !== "passed" || quality.passed !== true || quality.score !== maxScore || quality.penalty !== 0 || row.nudges !== 0)
  ) {
    throw new Error(`Benchmark certification row ${index} failed the P maximum-quality runtime evidence gate`);
  }
  return row;
}

function validateArtifactBinding(value, expected) {
  const binding = requireRecord(value, "certification binding runtime evidence");
  const actual = {
    candidateRuntimeSha256: binding.pSnapshot?.sha256,
    evaluatorSha256: binding.evaluator?.sha256,
    holdoutSha256: binding.holdoutSha256,
    kiloExecutableSha256: binding.kilo?.sha256,
    modelConfigurationSha256: binding.modelConfiguration?.sha256,
    nodeExecutableSha256: binding.node?.sha256,
    piExecutableSha256: binding.pi?.sha256,
    projectInstructionsSha256: binding.projectInstructions?.sha256,
  };
  for (const [name, hash] of Object.entries(actual)) {
    if (expected?.[name] !== hash) {
      throw new Error("Benchmark certification artifact binding runtime evidence does not match receipt evidence");
    }
  }
}

function validateThresholds(value, expected) {
  const thresholds = requireRecord(value, "certification threshold runtime evidence");
  const actual = {
    maxDurationRatio: thresholds.maxDurationRatio,
    maxTokenRatio: thresholds.maxTokenRatio,
    maxCostRatio: thresholds.maxCostRatio ?? null,
  };
  if (
    actual.maxDurationRatio !== expected?.maxDurationRatio ||
    actual.maxTokenRatio !== expected?.maxTokenRatio ||
    actual.maxCostRatio !== expected?.maxCostRatio
  ) {
    throw new Error("Benchmark certification artifact threshold runtime evidence does not match receipt evidence");
  }
}

function pairedMetrics(thresholds) {
  return [
    ["duration", thresholds.maxDurationRatio],
    ["token", thresholds.maxTokenRatio],
    ...(thresholds.maxCostRatio === null ? [] : [["cost", thresholds.maxCostRatio]]),
  ];
}

function validatePairedMetric(rows, baseline, metric, threshold) {
  const all = [];
  for (const task of certifiedTaskIds) {
    const taskPairs = [];
    for (let run = 1; run <= 3; run += 1) {
      const pair = {
        p: metricValue(rows.get(`${run}:p:${task}`), metric),
        baseline: metricValue(rows.get(`${run}:${baseline}:${task}`), metric),
      };
      taskPairs.push(pair);
      all.push(pair);
    }
    requireRatio(taskPairs, threshold, `${metric} versus ${baseline} for ${task}`);
  }
  requireRatio(all, threshold, `${metric} versus ${baseline} across all tasks`);
}

function validateStrictQualityDominance(rows, baseline, task) {
  const pScores = [];
  const baselineScores = [];
  for (let run = 1; run <= 3; run += 1) {
    const pQuality = rows.get(`${run}:p:${task}`).quality;
    const baselineQuality = rows.get(`${run}:${baseline}:${task}`).quality;
    pScores.push(pQuality.score / pQuality.maxScore);
    baselineScores.push(baselineQuality.score / baselineQuality.maxScore);
  }
  const pMean = average(pScores);
  const baselineMean = average(baselineScores);
  if (pMean <= baselineMean) {
    throw new Error(
      `P did not strictly exceed ${baseline} quality for task ${task}: p normalized mean=${pMean.toFixed(3)} ${baseline} normalized mean=${baselineMean.toFixed(3)}`,
    );
  }
}

function metricValue(row, metric) {
  if (metric === "duration") return row.elapsedMs;
  if (metric === "token") return row.metrics.usage.totalTokens;
  const amount = monetaryCost(row.metrics.usage.cost);
  positive(amount, "cost runtime evidence");
  return amount;
}

function monetaryCost(value) {
  return typeof value === "number" ? value : value?.total;
}

function requireRatio(pairs, threshold, label) {
  const ratio = average(pairs.map((pair) => pair.p / pair.baseline));
  if (!Number.isFinite(threshold) || threshold <= 0 || ratio > threshold) {
    throw new Error(`Benchmark certification artifact failed paired ${label} runtime evidence`);
  }
}

function average(values) {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function requireRecord(value, label) {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Benchmark certification artifact is missing ${label}`);
  }
  return value;
}

function sameNonemptyModels(value, expected) {
  return Array.isArray(value) && value.length > 0 && value.every((model) => model === expected);
}

function nonnegativeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value < 0) throw new Error(`Benchmark certification artifact has invalid ${label}`);
}

function nonnegative(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0) {
    throw new Error(`Benchmark certification artifact has invalid ${label}`);
  }
}

function positive(value, label) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`Benchmark certification artifact has invalid ${label}`);
  }
}
