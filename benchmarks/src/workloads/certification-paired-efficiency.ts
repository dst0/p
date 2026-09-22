import type { BenchmarkRowLike, CertifiedThresholds } from "./certification.ts";

type EfficiencyMetric = "duration" | "token" | "cost";

interface PairedCell {
  baseline: number;
  p: number;
}

export function extractCertifiedMonetaryCost(usage: { cost?: unknown } | undefined): number | undefined {
  if (!usage || usage.cost === undefined || usage.cost === null) return undefined;
  if (typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost > 0) return usage.cost;
  const total = typeof usage.cost === "object" ? (usage.cost as { total?: unknown }).total : undefined;
  return typeof total === "number" && Number.isFinite(total) && total > 0 ? total : undefined;
}

export function evaluatePairedEfficiency(
  results: readonly BenchmarkRowLike[],
  taskIds: readonly string[],
  runs: number,
  thresholds: CertifiedThresholds,
): string[] {
  const failures: string[] = [];
  const rows = new Map<string, BenchmarkRowLike>();
  for (const row of results) {
    const key = `${row.run}:${row.agent}:${row.task}`;
    if (!rows.has(key)) rows.set(key, row);
  }
  for (const [metric, threshold, thresholdName] of metricsFor(thresholds)) {
    if (!Number.isFinite(threshold) || threshold <= 0) {
      failures.push(`Invalid ${thresholdName} threshold: ${threshold}`);
      continue;
    }
    for (const agent of ["pi", "kilo"] as const) {
      const allPairs: PairedCell[] = [];
      for (const task of taskIds) {
        const taskPairs: PairedCell[] = [];
        for (let run = 1; run <= runs; run += 1) {
          const p = metricValue(rows.get(`${run}:p:${task}`), metric);
          const baseline = metricValue(rows.get(`${run}:${agent}:${task}`), metric);
          if (p === undefined || baseline === undefined) {
            failures.push(
              `Invalid paired ${metric} values versus ${agent} for task ${task} run ${run}: p=${formatValue(p)} ${agent}=${formatValue(baseline)}; both must be finite and > 0`,
            );
            continue;
          }
          taskPairs.push({ p, baseline });
          allPairs.push({ p, baseline });
        }
        checkPairedThreshold(failures, agent, metric, `task ${task}`, taskPairs, runs, threshold);
      }
      checkPairedThreshold(failures, agent, metric, "all tasks", allPairs, taskIds.length * runs, threshold);
    }
  }
  return failures;
}

export function evaluateStrictQualityDominance(
  results: readonly BenchmarkRowLike[],
  taskIds: readonly string[],
  runs: number,
): string[] {
  const failures: string[] = [];
  const rows = new Map<string, BenchmarkRowLike>();
  for (const row of results) {
    const key = `${row.run}:${row.agent}:${row.task}`;
    if (!rows.has(key)) rows.set(key, row);
  }
  for (const baseline of ["pi", "kilo"] as const) {
    for (const task of taskIds) {
      const pScores: number[] = [];
      const baselineScores: number[] = [];
      for (let run = 1; run <= runs; run += 1) {
        const p = normalizedQuality(rows.get(`${run}:p:${task}`));
        const comparison = normalizedQuality(rows.get(`${run}:${baseline}:${task}`));
        if (p !== undefined && comparison !== undefined) {
          pScores.push(p);
          baselineScores.push(comparison);
        }
      }
      if (pScores.length !== runs || baselineScores.length !== runs) continue;
      const pMean = average(pScores);
      const baselineMean = average(baselineScores);
      if (pMean <= baselineMean) {
        failures.push(
          `P did not strictly exceed ${baseline} quality for task ${task}: p normalized mean=${pMean.toFixed(3)} ${baseline} normalized mean=${baselineMean.toFixed(3)}`,
        );
      }
    }
  }
  return failures;
}

function metricsFor(thresholds: CertifiedThresholds): ReadonlyArray<readonly [EfficiencyMetric, number, string]> {
  return [
    ["duration", thresholds.maxDurationRatio, "maxDurationRatio"],
    ["token", thresholds.maxTokenRatio, "maxTokenRatio"],
    ...(thresholds.maxCostRatio === undefined ? [] : [["cost", thresholds.maxCostRatio, "maxCostRatio"] as const]),
  ];
}

function metricValue(row: BenchmarkRowLike | undefined, metric: EfficiencyMetric): number | undefined {
  const value =
    metric === "duration"
      ? row?.elapsedMs
      : metric === "token"
        ? row?.metrics?.usage.totalTokens
        : extractCertifiedMonetaryCost(row?.metrics?.usage);
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined;
}

function normalizedQuality(row: BenchmarkRowLike | undefined): number | undefined {
  const score = row?.quality?.score;
  const maxScore = row?.quality?.maxScore;
  if (
    typeof score !== "number" ||
    !Number.isFinite(score) ||
    typeof maxScore !== "number" ||
    !Number.isFinite(maxScore) ||
    maxScore <= 0
  ) {
    return undefined;
  }
  return score / maxScore;
}

function checkPairedThreshold(
  failures: string[],
  agent: "pi" | "kilo",
  metric: EfficiencyMetric,
  scope: string,
  pairs: readonly PairedCell[],
  expectedCount: number,
  threshold: number,
): void {
  if (pairs.length !== expectedCount) return;
  const pMean = average(pairs.map((pair) => pair.p));
  const baselineMean = average(pairs.map((pair) => pair.baseline));
  const pairedRatio = average(pairs.map((pair) => pair.p / pair.baseline));
  if (pairedRatio > threshold) {
    failures.push(
      `P exceeded ${metric} paired threshold versus ${agent} for ${scope}: p mean=${formatValue(pMean)} ${agent} mean=${formatValue(baselineMean)} paired ratio=${pairedRatio.toFixed(3)} > ${threshold}`,
    );
  }
}

function average(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function formatValue(value: number | undefined): string {
  return value === undefined ? "missing" : value.toFixed(3);
}
