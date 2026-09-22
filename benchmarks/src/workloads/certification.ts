import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { assertCertifiedOutputWritePath } from "../harness/certified-output-integrity.ts";
import type { BenchmarkEvaluationFreeze } from "../harness/evaluation-freeze.ts";
import {
  type CertifiedHarnessBinding,
  type CertifiedHarnessCoreBinding,
  recheckCertifiedHarness,
} from "./certification-binding.ts";
import {
  evaluatePairedEfficiency,
  evaluateStrictQualityDominance,
  extractCertifiedMonetaryCost,
} from "./certification-paired-efficiency.ts";
import { evaluateInstructionParityReceipts } from "./certification-preflight.ts";
import { formatCertificationReport } from "./certification-report.ts";
import { validateCertifiedBenchmarkRow } from "./certification-row-schema.ts";
import { certifiedTaskMaxScoreFor } from "./certified-task-score-policy.ts";
import type { RunnerOptions } from "./runner-options.ts";
import { benchmarkTasks } from "./task-registry.ts";

export type {
  CertifiedExecutableBinding,
  CertifiedHarnessBinding,
  CertifiedHarnessCoreBinding,
  CertifiedHarnessCoreInputs,
  CertifiedHarnessInputs,
} from "./certification-binding.ts";
export {
  bindCertifiedHarness,
  bindCertifiedHarnessCore,
  counterbalanceAgentOrder,
  hashFile,
  planRunCells,
  recheckCertifiedHarness,
  recheckCertifiedHarnessCore,
} from "./certification-binding.ts";
export {
  bindCertifiedModelConfiguration,
  type CertifiedModelConfiguration,
  type CertifiedModelConfigurationInputs,
  type CertifiedModelConfigurationSnapshot,
  recheckCertifiedModelConfiguration,
  snapshotCertifiedModelConfiguration,
} from "./certification-model-config.ts";
export {
  type CertifiedInstructionReceipt,
  createAugmentedProjectInstructions,
  evaluateInstructionParityReceipts,
  runCertifiedPreflights,
  verifyWorkspaceInstructions,
} from "./certification-preflight.ts";
export { formatCertificationReport } from "./certification-report.ts";
export { setupCertifiedBenchmark } from "./certification-setup.ts";

export interface CertifiedThresholds {
  maxDurationRatio: number;
  maxTokenRatio: number;
  maxCostRatio?: number;
}

export interface CertificationOutcome {
  passed: boolean;
  failures: string[];
  binding?: CertifiedHarnessCoreBinding;
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

export function evaluateCertification(
  results: readonly BenchmarkRowLike[],
  options: RunnerOptions,
  binding?: CertifiedHarnessCoreBinding,
): CertificationOutcome {
  const failures: string[] = [];
  const expectedModel = options.expectedResolvedModel;
  const canonicalAgents = ["p", "pi", "kilo"] as const;
  const canonicalTaskIds = benchmarkTasks.map((task) => task.id);
  const requiredRuns = options.runs;

  results.forEach((row, index) => {
    failures.push(...validateCertifiedBenchmarkRow(row, index, certifiedTaskMaxScoreFor(row.task)));
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

    const cost = extractCertifiedMonetaryCost(row.metrics?.usage);
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

  const maxDurationRatio = options.maxDurationRatio ?? 1.0;
  const maxTokenRatio = options.maxTokenRatio ?? 1.0;
  const maxCostRatio = options.maxCostRatio;
  const thresholds = { maxDurationRatio, maxTokenRatio, ...(maxCostRatio !== undefined ? { maxCostRatio } : {}) };
  failures.push(...evaluateStrictQualityDominance(results, canonicalTaskIds, requiredRuns));
  failures.push(...evaluatePairedEfficiency(results, canonicalTaskIds, requiredRuns, thresholds));

  if (binding) {
    failures.push(...evaluateInstructionParityReceipts(binding, canonicalAgents, expectedModel));
  }

  return {
    passed: failures.length === 0,
    failures,
    binding,
    thresholds,
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
