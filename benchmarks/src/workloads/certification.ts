import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertCertifiedOutputWritePath } from "../harness/certified-output-integrity.ts";
import type { BenchmarkEvaluationFreeze } from "../harness/evaluation-freeze.ts";
import {
  type CertifiedHarnessBinding,
  formatCertificationReport,
  recheckCertifiedHarness,
} from "./certification-binding.ts";
import { evaluateInstructionParityReceipts } from "./certification-preflight.ts";
import { validateCertifiedBenchmarkRow } from "./certification-row-schema.ts";
import type { RunnerOptions } from "./runner-options.ts";
import { benchmarkTasks } from "./task-registry.ts";

export type {
  CertifiedExecutableBinding,
  CertifiedHarnessBinding,
  CertifiedHarnessInputs,
} from "./certification-binding.ts";
export {
  bindCertifiedHarness,
  counterbalanceAgentOrder,
  formatCertificationReport,
  hashFile,
  planRunCells,
  recheckCertifiedHarness,
} from "./certification-binding.ts";
export {
  type CertifiedInstructionReceipt,
  createAugmentedProjectInstructions,
  evaluateInstructionParityReceipts,
  runCertifiedPreflights,
  verifyWorkspaceInstructions,
} from "./certification-preflight.ts";
export { setupCertifiedBenchmark } from "./certification-setup.ts";

export interface CertifiedThresholds {
  maxDurationRatio: number;
  maxTokenRatio: number;
  maxCostRatio?: number;
}

export interface CertificationOutcome {
  passed: boolean;
  failures: string[];
  binding?: CertifiedHarnessBinding;
  thresholds?: CertifiedThresholds;
}

export interface BenchmarkRowLike {
  run: number;
  agent: string;
  task: string;
  status: "passed" | "failed" | "timed_out" | "skipped";
  elapsedMs?: number;
  exitCode?: number | null | undefined;
  timedOut?: boolean;
  error?: string;
  nudges?: number;
  metrics?: {
    usage: {
      input: number;
      output: number;
      totalTokens: number;
      cacheRead?: number;
      cacheWrite?: number;
      cost?: unknown;
    };
    toolCalls: number;
    toolErrors: number;
    errors?: string[];
    responseModel?: string;
    responseModels?: string[];
  };
  quality?: { passed: boolean; score: number; maxScore: number; penalty?: number; rawScore?: number };
}

function extractMonetaryCost(usage: { cost?: unknown } | undefined): number | undefined {
  if (!usage || usage.cost === undefined || usage.cost === null) return undefined;
  if (typeof usage.cost === "number" && Number.isFinite(usage.cost) && usage.cost >= 0) return usage.cost;
  const total = typeof usage.cost === "object" ? (usage.cost as Record<string, unknown>).total : undefined;
  return typeof total === "number" && Number.isFinite(total) && total >= 0 ? total : undefined;
}

export function evaluateCertification(
  results: readonly BenchmarkRowLike[],
  options: RunnerOptions,
  binding?: CertifiedHarnessBinding,
): CertificationOutcome {
  const failures: string[] = [];
  const expectedModel = options.expectedResolvedModel;
  const canonicalAgents = ["p", "pi", "kilo"] as const;
  const canonicalTaskIds = benchmarkTasks.map((task) => task.id);
  const taskMaxScores = new Map(benchmarkTasks.map((task) => [task.id, task.maxScore]));
  const requiredRuns = options.runs;

  results.forEach((row, index) => {
    failures.push(...validateCertifiedBenchmarkRow(row, index, taskMaxScores.get(row.task)));
  });

  if (requiredRuns < 3) {
    failures.push(`Certified mode requires at least 3 runs; configured runs=${requiredRuns}`);
  }

  const expectedCells = new Set<string>();
  for (let run = 1; run <= Math.max(requiredRuns, 3); run += 1) {
    for (const agent of canonicalAgents) {
      for (const taskId of canonicalTaskIds) {
        expectedCells.add(`${run}:${agent}:${taskId}`);
      }
    }
  }

  const seenCells = new Set<string>();
  for (const row of results) {
    const cellKey = `${row.run}:${row.agent}:${row.task}`;
    const label = `run ${row.run} ${row.agent}/${row.task}`;
    if (!expectedCells.has(cellKey)) {
      failures.push(`Unexpected cell: ${label}`);
      continue;
    }
    if (seenCells.has(cellKey)) {
      failures.push(`Duplicate cell: ${label}`);
      continue;
    }
    seenCells.add(cellKey);

    const isP = row.agent === "p";
    const incomplete =
      row.exitCode !== 0 ||
      row.timedOut ||
      row.status === "timed_out" ||
      row.status === "skipped" ||
      (row.metrics?.errors ?? []).length > 0 ||
      (row.metrics?.toolErrors ?? 0) > 0 ||
      (isP && row.status !== "passed");
    if (incomplete) {
      failures.push(
        `Incomplete cell: ${label} status=${row.status} exitCode=${row.exitCode} error=${row.error ?? "none"}`,
      );
    }

    const q = row.quality;
    if (!q || !Number.isFinite(q.score) || !Number.isFinite(q.maxScore) || q.maxScore <= 0) {
      failures.push(`missing quality runtime evidence for ${label}`);
    }

    const responseModel = row.metrics?.responseModel;
    if (typeof responseModel !== "string" || !responseModel.trim()) {
      failures.push(`missing responseModel runtime evidence for ${label}`);
    } else if (expectedModel && responseModel !== expectedModel) {
      failures.push(`responseModel mismatch for ${label}: expected ${expectedModel}, got ${responseModel}`);
    }
    const responseModels = row.metrics?.responseModels;
    if (!Array.isArray(responseModels) || responseModels.length === 0) {
      failures.push(`missing observed responseModels runtime evidence for ${label}`);
    } else {
      for (const observedModel of responseModels) {
        if (expectedModel && observedModel !== expectedModel) {
          failures.push(
            `observed responseModel mismatch for ${label}: expected ${expectedModel}, got ${observedModel}`,
          );
        }
      }
    }

    const totalTokens = row.metrics?.usage?.totalTokens;
    if (typeof totalTokens !== "number" || !Number.isFinite(totalTokens) || totalTokens <= 0) {
      failures.push(`missing token count runtime evidence for ${label}`);
    }

    const elapsedMs = row.elapsedMs;
    if (typeof elapsedMs !== "number" || !Number.isFinite(elapsedMs) || elapsedMs <= 0) {
      failures.push(`missing duration runtime evidence for ${label}`);
    }

    const cost = extractMonetaryCost(row.metrics?.usage);
    if (options.maxCostRatio !== undefined && cost === undefined) {
      failures.push(`missing monetary cost runtime evidence for ${label}`);
    }

    if (row.agent === "p" && q) {
      if (!Number.isFinite(q.maxScore) || q.maxScore <= 0 || q.score !== q.maxScore || q.passed !== true) {
        failures.push(`P failed to achieve maximum rubric score in ${label}: score ${q.score}/${q.maxScore}`);
      }
      const penalty = q.penalty ?? 0;
      const nudges = row.nudges ?? 0;
      if (!Number.isFinite(penalty) || penalty !== 0 || !Number.isFinite(nudges) || nudges !== 0) {
        failures.push(`P incurred zero penalties gate failure in ${label}: penalty=${q.penalty} nudges=${row.nudges}`);
      }
    }
  }

  for (const expectedKey of expectedCells) {
    if (!seenCells.has(expectedKey)) {
      const [run, agent, taskId] = expectedKey.split(":");
      failures.push(`Missing cell: run ${run} ${agent}/${taskId}`);
    }
  }

  const pRows = results.filter((row) => row.agent === "p");
  const piRows = results.filter((row) => row.agent === "pi");
  const kiloRows = results.filter((row) => row.agent === "kilo");

  const average = (rows: readonly BenchmarkRowLike[], selector: (r: BenchmarkRowLike) => number): number =>
    rows.length === 0 ? 0 : rows.reduce((acc, r) => acc + selector(r), 0) / rows.length;

  const pAvgDuration = average(pRows, (r) => r.elapsedMs ?? 0);
  const piAvgDuration = average(piRows, (r) => r.elapsedMs ?? 0);
  const kiloAvgDuration = average(kiloRows, (r) => r.elapsedMs ?? 0);

  const pAvgTokens = average(pRows, (r) => r.metrics?.usage?.totalTokens ?? 0);
  const piAvgTokens = average(piRows, (r) => r.metrics?.usage?.totalTokens ?? 0);
  const kiloAvgTokens = average(kiloRows, (r) => r.metrics?.usage?.totalTokens ?? 0);

  const pAvgCost = average(pRows, (r) => extractMonetaryCost(r.metrics?.usage) ?? 0);
  const piAvgCost = average(piRows, (r) => extractMonetaryCost(r.metrics?.usage) ?? 0);
  const kiloAvgCost = average(kiloRows, (r) => extractMonetaryCost(r.metrics?.usage) ?? 0);

  const maxDurationRatio = options.maxDurationRatio ?? 1.0;
  const maxTokenRatio = options.maxTokenRatio ?? 1.0;
  const maxCostRatio = options.maxCostRatio;
  for (const [name, val] of [
    ["maxDurationRatio", maxDurationRatio],
    ["maxTokenRatio", maxTokenRatio],
    ...(maxCostRatio !== undefined ? [["maxCostRatio", maxCostRatio] as const] : []),
  ] as const) {
    if (!Number.isFinite(val) || val <= 0) failures.push(`Invalid ${name} threshold: ${val}`);
  }

  const checkThreshold = (agent: "pi" | "kilo", kind: string, pVal: number, baseVal: number, ratio: number) => {
    if (!Number.isFinite(pVal) || !Number.isFinite(baseVal) || !Number.isFinite(ratio) || ratio <= 0) {
      failures.push(`Invalid numeric values for ${kind} threshold versus ${agent}`);
      return;
    }
    if (pVal > baseVal * ratio) {
      failures.push(
        `P exceeded ${kind} threshold versus ${agent} (${pVal.toFixed(0)} > ${baseVal.toFixed(0)} * ${ratio})`,
      );
    }
  };

  for (const [agent, dur, tok, cost] of [
    ["pi", piAvgDuration, piAvgTokens, piAvgCost],
    ["kilo", kiloAvgDuration, kiloAvgTokens, kiloAvgCost],
  ] as const) {
    checkThreshold(agent, "duration", pAvgDuration, dur, maxDurationRatio);
    checkThreshold(agent, "token", pAvgTokens, tok, maxTokenRatio);
    if (maxCostRatio !== undefined) checkThreshold(agent, "cost", pAvgCost, cost, maxCostRatio);
  }

  if (binding) {
    failures.push(...evaluateInstructionParityReceipts(binding, canonicalAgents, expectedModel));
  }

  return {
    passed: failures.length === 0,
    failures,
    binding,
    thresholds: { maxDurationRatio, maxTokenRatio, ...(maxCostRatio !== undefined ? { maxCostRatio } : {}) },
  };
}

export function finalizeCertifiedReport(
  options: RunnerOptions,
  results: readonly BenchmarkRowLike[],
  output: string,
  freeze?: BenchmarkEvaluationFreeze,
  binding?: CertifiedHarnessBinding,
): CertificationOutcome | undefined {
  if (!options.certified) return undefined;
  if (binding && freeze) {
    recheckCertifiedHarness(binding, freeze.candidateRuntimePath, freeze.candidateRuntimeSha256);
  }
  const certification = evaluateCertification(results, options, binding);
  const reportPath = join(output, "report.md");
  assertCertifiedOutputWritePath(reportPath, true);
  writeFileSync(reportPath, `${readFileSync(reportPath, "utf8")}\n${formatCertificationReport(certification)}`, "utf8");
  return certification;
}
