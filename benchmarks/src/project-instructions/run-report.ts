import { escapeMarkdownTableCell, escapeMarkdownText, markdownCodeSpan } from "../harness/markdown.ts";
import { renderBenchmarkCompilerFailureTelemetry } from "./failure.ts";
import { assessSample } from "./run-assessment.ts";
import type { PairedSample, ProjectInstructionMode } from "./run-core.ts";
import { PROJECT_INSTRUCTION_MODES } from "./run-core.ts";
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

function summarizeMode(samples: PairedSample[], mode: string) {
  const rows = samples.filter((sample) => sample.mode === mode);
  return {
    samples: rows.length,
    qualityPasses: rows.filter((sample) => assessSample(sample).passed).length,
    medianQualityPercent: median(rows.map(qualityPercent)),
    medianTotalTokens: median(rows.map((sample) => sample.metrics.usage.totalTokens)),
    medianElapsedMs: median(rows.map((sample) => sample.elapsedMs)),
  };
}

function percentageDelta(compiled: number, legacy: number): number | undefined {
  return legacy === 0 ? undefined : ((compiled - legacy) / legacy) * 100;
}

function summarizePairs(samples: PairedSample[]) {
  const pairs = new Map<string, Partial<Record<ProjectInstructionMode, PairedSample>>>();
  for (const sample of samples) {
    const key = `${sample.run}\0${sample.task}`;
    const pair = pairs.get(key) ?? {};
    pair[sample.mode] = sample;
    pairs.set(key, pair);
  }
  const complete = [...pairs.values()].filter(
    (pair): pair is Record<ProjectInstructionMode, PairedSample> =>
      pair.compiled !== undefined && pair.legacy !== undefined,
  );
  return {
    samples: complete.length,
    medianTokenDeltaPercent: median(
      complete.map((pair) =>
        percentageDelta(pair.compiled.metrics.usage.totalTokens, pair.legacy.metrics.usage.totalTokens),
      ),
    ),
    medianRuntimeDeltaPercent: median(
      complete.map((pair) => percentageDelta(pair.compiled.elapsedMs, pair.legacy.elapsedMs)),
    ),
  };
}

export function createPairedSummary(samples: PairedSample[], gatePassed: boolean) {
  if (!gatePassed) return undefined;
  const byTask = Object.fromEntries(
    [...new Set(samples.map((sample) => sample.task))].map((task) => {
      const rows = samples.filter((sample) => sample.task === task);
      return [
        task,
        {
          byMode: Object.fromEntries(PROJECT_INSTRUCTION_MODES.map((mode) => [mode, summarizeMode(rows, mode)])),
          paired: summarizePairs(rows),
        },
      ];
    }),
  );
  return {
    byMode: Object.fromEntries(PROJECT_INSTRUCTION_MODES.map((mode) => [mode, summarizeMode(samples, mode)])),
    paired: summarizePairs(samples),
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
  schedule: Array<{ run: number; task: string; modes: string[] }>;
  samples: Array<{
    run: number;
    task: string;
    mode: string;
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
  let report = "# Project-instruction paired benchmark\n\n";
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
  report += "## Randomized pair order\n\n| Run | Task | First | Second |\n| ---: | --- | --- | --- |\n";
  for (const pair of document.schedule) {
    report += `| ${formatNumber(pair.run)} | ${escapeMarkdownTableCell(pair.task)} | ${escapeMarkdownTableCell(pair.modes[0])} | ${escapeMarkdownTableCell(pair.modes[1])} |\n`;
  }
  report +=
    "\n## Samples\n\n| Run | Task | Mode | Status | Quality | Session tokens | Runtime | First mutation | Requirement definitions |\n| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: |\n";
  for (const sample of document.samples) {
    const score = formatNumber(sample.quality.rawScore ?? sample.quality.score);
    report += `| ${formatNumber(sample.run)} | ${escapeMarkdownTableCell(sample.task)} | ${escapeMarkdownTableCell(sample.mode)} | ${escapeMarkdownTableCell(sample.status)} | ${score}/${formatNumber(sample.quality.maxScore)} | ${formatNumber(sample.metrics.usage.totalTokens)} | ${formatNumber(sample.elapsedMs)} ms | ${formatNumber(sample.liveness?.firstMutationElapsedMs)} ms | ${formatRequirementDefinitionCount(sample.liveness)} |\n`;
  }
  if (!document.summary) return report;
  report += "\n## Performance after correctness\n\n";
  report +=
    "| Mode | Quality passes | Median quality | Median session tokens | Median runtime |\n| --- | ---: | ---: | ---: | ---: |\n";
  for (const mode of PROJECT_INSTRUCTION_MODES) {
    const data = document.summary.byMode[mode];
    report += `| ${escapeMarkdownTableCell(mode)} | ${formatNumber(data.qualityPasses)}/${formatNumber(data.samples)} | ${formatPercent(data.medianQualityPercent)} | ${formatNumber(data.medianTotalTokens)} | ${formatNumber(data.medianElapsedMs)} ms |\n`;
  }
  report += `\nMedian paired compiled-vs-legacy delta: **${formatPercent(document.summary.paired.medianTokenDeltaPercent)} tokens**, **${formatPercent(document.summary.paired.medianRuntimeDeltaPercent)} runtime**. Negative is better for compiled mode.\n`;
  report +=
    "\n## Per-task medians\n\n| Task | Legacy session tokens | Compiled session tokens | Paired token delta | Legacy runtime | Compiled runtime | Paired runtime delta |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n";
  for (const [task, data] of Object.entries(document.summary.byTask)) {
    report += `| ${escapeMarkdownTableCell(task)} | ${formatNumber(data.byMode.legacy.medianTotalTokens)} | ${formatNumber(data.byMode.compiled.medianTotalTokens)} | ${formatPercent(data.paired.medianTokenDeltaPercent)} | ${formatNumber(data.byMode.legacy.medianElapsedMs)} ms | ${formatNumber(data.byMode.compiled.medianElapsedMs)} ms | ${formatPercent(data.paired.medianRuntimeDeltaPercent)} |\n`;
  }
  return report;
}
