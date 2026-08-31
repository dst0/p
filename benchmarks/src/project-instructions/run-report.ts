import { escapeMarkdownTableCell, escapeMarkdownText, markdownCodeSpan } from "../harness/markdown.ts";
import { renderBenchmarkCompilerFailureTelemetry } from "./failure.ts";
import { assessSample } from "./run-assessment.ts";
import type { PairedSample, ProjectInstructionCondition } from "./run-core.ts";
import { PROJECT_INSTRUCTION_CONDITIONS, PROJECT_INSTRUCTION_TASKS } from "./run-core.ts";
import { formatRequirementDefinitionCount, renderGateFailureLiveness } from "./run-report-liveness.ts";

export function median(values: Array<number | undefined>): number | undefined {
  const ordered = values
    .filter((value): value is number => typeof value === "number")
    .sort((left, right) => left - right);
  if (ordered.length === 0) return undefined;
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function qualityPercent(sample: PairedSample): number {
  const score = sample.quality.rawScore ?? sample.quality.score ?? 0;
  return sample.quality.maxScore > 0 ? (score / sample.quality.maxScore) * 100 : 0;
}

function summarizeCondition(samples: PairedSample[], condition: string) {
  const rows = samples.filter((sample) => sample.condition === condition);
  return {
    samples: rows.length,
    qualityPasses: rows.filter((sample) => assessSample(sample).passed).length,
    medianQualityPercent: median(rows.map(qualityPercent)),
    medianTotalTokens: median(rows.map((sample) => sample.metrics.usage.totalTokens)),
    medianElapsedMs: median(rows.map((sample) => sample.elapsedMs)),
  };
}

function percentageDelta(candidate: number, reference: number): number | undefined {
  return reference === 0 ? undefined : ((candidate - reference) / reference) * 100;
}

function summarizeComparison(
  samples: PairedSample[],
  candidate: ProjectInstructionCondition,
  reference: ProjectInstructionCondition,
) {
  const pairs = new Map<string, Partial<Record<ProjectInstructionCondition, PairedSample>>>();
  for (const sample of samples) {
    const key = `${sample.run}\0${sample.task}`;
    const pair = pairs.get(key) ?? {};
    pair[sample.condition] = sample;
    pairs.set(key, pair);
  }
  const complete = [...pairs.values()].filter(
    (pair): pair is Record<ProjectInstructionCondition, PairedSample> =>
      pair[candidate] !== undefined && pair[reference] !== undefined,
  );
  return {
    samples: complete.length,
    medianTokenDeltaPercent: median(
      complete.map((pair) =>
        percentageDelta(pair[candidate].metrics.usage.totalTokens, pair[reference].metrics.usage.totalTokens),
      ),
    ),
    medianRuntimeDeltaPercent: median(
      complete.map((pair) => percentageDelta(pair[candidate].elapsedMs, pair[reference].elapsedMs)),
    ),
  };
}

function hasCompleteComparisonScope(samples: PairedSample[], tasks: string[], runs: number): boolean {
  if (
    tasks.length !== PROJECT_INSTRUCTION_TASKS.length ||
    !PROJECT_INSTRUCTION_TASKS.every((task) => tasks.includes(task)) ||
    samples.length !== PROJECT_INSTRUCTION_TASKS.length * runs * PROJECT_INSTRUCTION_CONDITIONS.length
  ) {
    return false;
  }
  for (const task of PROJECT_INSTRUCTION_TASKS) {
    for (let run = 1; run <= runs; run += 1) {
      const rows = samples.filter((sample) => sample.task === task && sample.run === run);
      if (
        rows.length !== PROJECT_INSTRUCTION_CONDITIONS.length ||
        !PROJECT_INSTRUCTION_CONDITIONS.every(
          (condition) => rows.filter((sample) => sample.condition === condition).length === 1,
        )
      ) {
        return false;
      }
    }
  }
  return true;
}

function comparisons(samples: PairedSample[]) {
  return {
    compiledEvidenceVsLegacy: summarizeComparison(samples, "compiled-evidence", "legacy"),
    compiledAuditVsCompiledEvidence: summarizeComparison(samples, "compiled-audit", "compiled-evidence"),
    compiledAuditVsLegacy: summarizeComparison(samples, "compiled-audit", "legacy"),
  };
}

export function createPairedSummary(samples: PairedSample[], gatePassed: boolean, tasks: string[], runs: number) {
  if (!gatePassed || !hasCompleteComparisonScope(samples, tasks, runs)) return undefined;
  const byTask = Object.fromEntries(
    [...new Set(samples.map((sample) => sample.task))].map((task) => {
      const rows = samples.filter((sample) => sample.task === task);
      return [
        task,
        {
          byCondition: Object.fromEntries(
            PROJECT_INSTRUCTION_CONDITIONS.map((condition) => [condition, summarizeCondition(rows, condition)]),
          ),
          comparisons: comparisons(rows),
        },
      ];
    }),
  );
  return {
    byCondition: Object.fromEntries(
      PROJECT_INSTRUCTION_CONDITIONS.map((condition) => [condition, summarizeCondition(samples, condition)]),
    ),
    comparisons: comparisons(samples),
    byTask,
  };
}

function formatNumber(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "n/a";
}

function formatPercent(value: unknown): string {
  return typeof value === "number" && Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

type PairedReportDocument = {
  runStatus?: string;
  completed: boolean;
  generatedAt: string;
  model: string;
  compilerModel?: string;
  thinking?: string;
  binarySha256: string;
  seed: string;
  candidateVersion: string;
  runs: number;
  tasks: string[];
  compilerPreparation?: { usage: { total: number }; elapsedMs: number };
  gate: {
    passed: boolean;
    failure?: {
      run: number;
      task: string;
      mode: string;
      kind?: string;
      reason: string;
      liveness?: Parameters<typeof renderGateFailureLiveness>[0];
      compilerFailure?: Parameters<typeof renderBenchmarkCompilerFailureTelemetry>[0];
    };
  };
  schedule: Array<{ run: number; task: string; conditions: string[] }>;
  samples: Array<{
    run: number;
    task: string;
    condition: string;
    mode: string;
    taskVerificationMode: string;
    status: string;
    elapsedMs: number;
    quality: { rawScore?: number; score?: number; maxScore: number };
    metrics: { usage: { totalTokens: number } };
    liveness?: PairedSample["liveness"];
  }>;
  summary?: NonNullable<ReturnType<typeof createPairedSummary>> | null;
  cleanup?: { status: string; diagnostic?: string };
  [key: string]: unknown;
};

export function renderPairedReport(document: PairedReportDocument): string {
  const runStatus =
    document.runStatus ??
    (document.completed && document.gate.passed ? "completed" : document.gate.passed ? "running" : "failed");
  let report = "# Project-instruction three-condition benchmark\n\n";
  report += `Generated: ${escapeMarkdownText(document.generatedAt)}\n\nTask model: ${markdownCodeSpan(document.model)}\n\nCompiler model: ${markdownCodeSpan(document.compilerModel ?? document.model)}\n\n`;
  report += `P runtime-closure SHA-256: ${markdownCodeSpan(document.binarySha256)}\n\nSeed: ${markdownCodeSpan(document.seed)}\n\n`;
  report += `Candidate version: ${markdownCodeSpan(document.candidateVersion)}\n\n`;
  report += `Task thinking level: ${markdownCodeSpan(document.thinking ?? "default")}\n\n`;
  report += `Repetitions: ${formatNumber(document.runs)}; tasks: ${document.tasks.map(markdownCodeSpan).join(", ")}.\n\n`;
  report +=
    "Per-cell token and runtime totals measure steady-state agent work only; compiler preparation is excluded.\n\n";
  if (document.compilerPreparation) {
    report += `One-time certified compiler preparation: **${formatNumber(document.compilerPreparation.usage.total)} tokens**, **${formatNumber(document.compilerPreparation.elapsedMs)} ms**.\n\n`;
  }
  if (runStatus === "completed" && document.completed && document.gate.passed) {
    report += "Correctness gate: **PASSED**. Every sample completed and passed every quality check.\n\n";
    if (!document.summary) {
      report +=
        "Performance conclusions are suppressed because the configured canary did not cover all four canonical tasks, repetitions, and conditions.\n\n";
    }
  } else if (runStatus === "running") {
    report += "Correctness gate: **RUNNING**. Performance conclusions remain suppressed until every sample passes.\n\n";
  } else {
    const failure = document.gate.failure;
    if (!failure) throw new Error("failed paired benchmark report is missing gate failure evidence");
    const status = runStatus === "interrupted" ? "INTERRUPTED" : "HARD STOP";
    report += `Correctness gate: **${status}** at run ${formatNumber(failure.run)}, task ${markdownCodeSpan(failure.task)}, mode ${markdownCodeSpan(failure.mode)} (${escapeMarkdownText(failure.kind ?? "unclassified")}): ${escapeMarkdownText(failure.reason)}.\n\nNo token or runtime comparison is reported because correctness did not pass.\n\n`;
    report += renderGateFailureLiveness(failure.liveness);
    report += renderBenchmarkCompilerFailureTelemetry(failure.compilerFailure);
  }
  report +=
    "## Randomized condition order\n\n| Run | Task | First | Second | Third |\n| ---: | --- | --- | --- | --- |\n";
  for (const pair of document.schedule) {
    report += `| ${formatNumber(pair.run)} | ${escapeMarkdownTableCell(pair.task)} | ${escapeMarkdownTableCell(pair.conditions[0])} | ${escapeMarkdownTableCell(pair.conditions[1])} | ${escapeMarkdownTableCell(pair.conditions[2])} |\n`;
  }
  report +=
    "\n## Samples\n\n| Run | Task | Condition | Instruction mode | Verification | Status | Quality | Session tokens | Runtime | First mutation | Requirement definitions |\n| ---: | --- | --- | --- | --- | --- | --- | ---: | ---: | ---: | ---: |\n";
  for (const sample of document.samples) {
    const score = formatNumber(sample.quality.rawScore ?? sample.quality.score);
    report += `| ${formatNumber(sample.run)} | ${escapeMarkdownTableCell(sample.task)} | ${escapeMarkdownTableCell(sample.condition)} | ${escapeMarkdownTableCell(sample.mode)} | ${escapeMarkdownTableCell(sample.taskVerificationMode)} | ${escapeMarkdownTableCell(sample.status)} | ${score}/${formatNumber(sample.quality.maxScore)} | ${formatNumber(sample.metrics.usage.totalTokens)} | ${formatNumber(sample.elapsedMs)} ms | ${formatNumber(sample.liveness?.firstMutationElapsedMs)} ms | ${formatRequirementDefinitionCount(sample.liveness)} |\n`;
  }
  if (!document.summary) return report;
  report += "\n## Performance after correctness\n\n";
  report +=
    "| Mode | Quality passes | Median quality | Median session tokens | Median runtime |\n| --- | ---: | ---: | ---: | ---: |\n";
  for (const condition of PROJECT_INSTRUCTION_CONDITIONS) {
    const data = document.summary.byCondition[condition];
    report += `| ${escapeMarkdownTableCell(condition)} | ${formatNumber(data.qualityPasses)}/${formatNumber(data.samples)} | ${formatPercent(data.medianQualityPercent)} | ${formatNumber(data.medianTotalTokens)} | ${formatNumber(data.medianElapsedMs)} ms |\n`;
  }
  report += "\nWithin-block median deltas (negative is better for the first condition):\n\n";
  for (const [label, data] of [
    ["compiled-evidence vs legacy", document.summary.comparisons.compiledEvidenceVsLegacy],
    ["compiled-audit vs compiled-evidence", document.summary.comparisons.compiledAuditVsCompiledEvidence],
    ["compiled-audit vs legacy", document.summary.comparisons.compiledAuditVsLegacy],
  ] as const) {
    report += `- ${label}: **${formatPercent(data.medianTokenDeltaPercent)} tokens**, **${formatPercent(data.medianRuntimeDeltaPercent)} runtime**.\n`;
  }
  report +=
    "\n## Per-task medians\n\n| Task | Legacy tokens | Compiled-evidence tokens | Compiled-audit tokens | Evidence vs legacy | Audit vs evidence |\n| --- | ---: | ---: | ---: | ---: | ---: |\n";
  for (const [task, data] of Object.entries(document.summary.byTask)) {
    report += `| ${escapeMarkdownTableCell(task)} | ${formatNumber(data.byCondition.legacy.medianTotalTokens)} | ${formatNumber(data.byCondition["compiled-evidence"].medianTotalTokens)} | ${formatNumber(data.byCondition["compiled-audit"].medianTotalTokens)} | ${formatPercent(data.comparisons.compiledEvidenceVsLegacy.medianTokenDeltaPercent)} | ${formatPercent(data.comparisons.compiledAuditVsCompiledEvidence.medianTokenDeltaPercent)} |\n`;
  }
  return report;
}
