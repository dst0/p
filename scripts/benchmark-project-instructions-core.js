import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { renderBenchmarkCompilerFailureTelemetry } from "./benchmark-project-instruction-failure.js";
import { renderGateFailureLiveness } from "./benchmark-project-instructions-report-liveness.js";
import { escapeMarkdownTableCell, escapeMarkdownText, markdownCodeSpan } from "./benchmark-markdown.js";
import { assessSample, describeCaptureOverflow } from "./benchmark-project-instructions-assessment.js";
export { createBenchmarkGateFailure } from "./benchmark-project-instruction-failure.js";
export { assessSample } from "./benchmark-project-instructions-assessment.js";

export const PROJECT_INSTRUCTION_MODES = ["compiled", "legacy"];
export const PROJECT_INSTRUCTION_TASKS = [
  "typescript-calculator",
  "monolith-split",
  "event-sourced-inventory",
  "durable-workflow-saga",
];
function positiveInteger(value, name) {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
function argumentValue(argv, index, name) {
  if (index + 1 >= argv.length) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}
export function parsePairedArgs(argv) {
  const options = {
    model: process.env.PI_BENCHMARK_MODEL,
    compilerModel: process.env.PI_BENCHMARK_COMPILER_MODEL,
    modelsFile: resolve(homedir(), ".p", "agent", "models.json"),
    tasks: [],
    runs: 3,
    seed: process.env.P_BENCHMARK_SEED,
    timeoutSeconds: 300,
    maxRuntimeSeconds: 54_000,
    output: undefined,
    help: false,
  };
  const valueOptions = new Set([
    "--model",
    "--compiler-model",
    "--models-file",
    "--task",
    "--runs",
    "--seed",
    "--timeout-seconds",
    "--max-runtime-seconds",
    "--output",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (!valueOptions.has(arg)) throw new Error(`Unknown option: ${arg}`);
    const value = argumentValue(argv, index, arg);
    index += 1;
    if (arg === "--model") options.model = value;
    if (arg === "--compiler-model") options.compilerModel = value;
    if (arg === "--models-file") options.modelsFile = resolve(value);
    if (arg === "--task") options.tasks.push(value);
    if (arg === "--runs") options.runs = positiveInteger(value, arg);
    if (arg === "--seed") options.seed = value;
    if (arg === "--timeout-seconds") options.timeoutSeconds = positiveInteger(value, arg);
    if (arg === "--max-runtime-seconds") options.maxRuntimeSeconds = positiveInteger(value, arg);
    if (arg === "--output") options.output = resolve(value);
  }

  if (options.help) return options;
  if (!options.model) throw new Error("--model is required");
  options.compilerModel ??= options.model;
  if (options.runs < 3 || options.runs > 5) throw new Error("--runs must be between 3 and 5");
  if (options.tasks.length === 0) options.tasks = [...PROJECT_INSTRUCTION_TASKS];
  if (new Set(options.tasks).size !== options.tasks.length) throw new Error("--task values must not repeat");
  for (const task of options.tasks) {
    if (!PROJECT_INSTRUCTION_TASKS.includes(task)) throw new Error(`Unknown task: ${task}`);
  }
  return options;
}

export function buildPairedSchedule(tasks, runs, seed) {
  const schedulesByTask = new Map();
  for (const task of tasks) {
    const starts = [];
    for (let index = 0; index < Math.floor(runs / 2); index += 1) starts.push("compiled", "legacy");
    if (runs % 2 === 1) {
      const extra = createHash("sha256").update(`${seed}\0${task}\0extra`).digest()[0] % 2;
      starts.push(PROJECT_INSTRUCTION_MODES[extra]);
    }
    const randomized = starts
      .map((mode, index) => ({ mode, order: createHash("sha256").update(`${seed}\0${task}\0${mode}\0${index}`).digest("hex") }))
      .toSorted((left, right) => left.order.localeCompare(right.order))
      .map(({ mode }) => mode);
    schedulesByTask.set(task, randomized);
  }
  return Array.from({ length: runs }, (_, index) =>
    tasks.map((task) => {
      const first = schedulesByTask.get(task)[index];
      return { run: index + 1, task, modes: [first, PROJECT_INSTRUCTION_MODES.find((mode) => mode !== first)] };
    }),
  ).flat();
}
export function buildBenchmarkArgs(options, pair, mode, output, remainingSeconds, proofReceipt) {
  const args = [
    "--agents",
    "p",
    "--model",
    options.model,
    "--p-cli",
    options.pCli,
    "--project-instruction-probe",
    options.projectInstructionProbe,
    "--project-instruction-proof-receipt",
    proofReceipt.sha256,
  ];
  if (mode === "compiled") args.splice(4, 0, "--project-instruction-compiler-model", options.compilerModel);
  if (options.modelsFile) args.push("--models-file", options.modelsFile);
  args.push(
    "--task",
    pair.task,
    "--runs",
    "1",
    "--minimum-timeout-seconds",
    String(options.timeoutSeconds),
    "--max-runtime-seconds",
    String(remainingSeconds),
    "--project-instructions",
    mode,
    "--project-instructions-file",
    options.projectInstructionsFile,
    "--output",
    output,
  );
  return args;
}

export function describeProjectInstructionStartupFailure(result) {
  const manifest = result?.projectInstructionEvidence?.cache?.manifest;
  if (
    result?.status === "failed" &&
    manifest?.mode === "fallback" &&
    manifest.compilerStatus === "failed" &&
    typeof manifest.compilerDiagnostic === "string"
  ) {
    return manifest.compilerDiagnostic;
  }
  return undefined;
}

export function assertChildSampleMetrics(result) {
  const captureFailure = describeCaptureOverflow(result.captureOverflow);
  if (captureFailure) throw new Error(captureFailure);
  const startupFailure = describeProjectInstructionStartupFailure(result);
  if (startupFailure) throw new Error(startupFailure);
  if (
    !Number.isFinite(result.elapsedMs) ||
    result.elapsedMs <= 0 ||
    !Number.isFinite(result.metrics?.usage?.totalTokens) ||
    result.metrics.usage.totalTokens <= 0 ||
    !Array.isArray(result.quality?.checks) ||
    result.quality.checks.length === 0
  ) {
    throw new Error("child benchmark returned incomplete metrics or quality checks");
  }
}

export function assertNoStartupProbeCaptureOverflow(startupProbes = {}) {
  for (const [agent, probe] of Object.entries(startupProbes)) {
    const captureFailure = describeCaptureOverflow(probe?.captureOverflow, `${agent} startup probe`);
    if (captureFailure) throw new Error(captureFailure);
  }
}

export function verifyResolvedPModel(requested, metrics, options = {}) {
  const separator = requested.indexOf("/");
  const provider = separator < 1 ? undefined : requested.slice(0, separator);
  const id = separator < 1 ? undefined : requested.slice(separator + 1);
  if (!provider || !id || metrics?.model?.provider !== provider || metrics.model.id !== id || typeof metrics.model.api !== "string") {
    throw new Error("child benchmark resolved model identity mismatch");
  }
  if ((options.requireResponseModel ?? true) && (typeof metrics.responseModel !== "string" || metrics.responseModel.length === 0)) {
    throw new Error("child benchmark did not report its response model");
  }
  return { provider, id, api: metrics.model.api, responseModel: metrics.responseModel };
}

export function median(values) {
  if (values.length === 0) return undefined;
  const ordered = values.toSorted((left, right) => left - right);
  const middle = Math.floor(ordered.length / 2);
  return ordered.length % 2 === 0 ? (ordered[middle - 1] + ordered[middle]) / 2 : ordered[middle];
}

function qualityPercent(sample) {
  const score = sample.quality.rawScore ?? sample.quality.score;
  return sample.quality.maxScore > 0 ? (score / sample.quality.maxScore) * 100 : 0;
}

function summarizeMode(samples, mode) {
  const rows = samples.filter((sample) => sample.mode === mode);
  return {
    samples: rows.length,
    qualityPasses: rows.filter((sample) => assessSample(sample).passed).length,
    medianQualityPercent: median(rows.map(qualityPercent)),
    medianTotalTokens: median(rows.map((sample) => sample.metrics.usage.totalTokens)),
    medianElapsedMs: median(rows.map((sample) => sample.elapsedMs)),
  };
}

function percentageDelta(compiled, legacy) {
  return legacy === 0 ? undefined : ((compiled - legacy) / legacy) * 100;
}

function summarizePairs(samples) {
  const pairs = new Map();
  for (const sample of samples) {
    const key = `${sample.run}\0${sample.task}`;
    const pair = pairs.get(key) ?? {};
    pair[sample.mode] = sample;
    pairs.set(key, pair);
  }
  const complete = [...pairs.values()].filter((pair) => pair.compiled && pair.legacy);
  return {
    samples: complete.length,
    medianTokenDeltaPercent: median(
      complete.map((pair) => percentageDelta(pair.compiled.metrics.usage.totalTokens, pair.legacy.metrics.usage.totalTokens)),
    ),
    medianRuntimeDeltaPercent: median(
      complete.map((pair) => percentageDelta(pair.compiled.elapsedMs, pair.legacy.elapsedMs)),
    ),
  };
}

export function createPairedSummary(samples, gatePassed) {
  if (!gatePassed) return undefined;
  const byTask = Object.fromEntries(
    [...new Set(samples.map((sample) => sample.task))].map((task) => {
      const rows = samples.filter((sample) => sample.task === task);
      return [task, { byMode: Object.fromEntries(PROJECT_INSTRUCTION_MODES.map((mode) => [mode, summarizeMode(rows, mode)])), paired: summarizePairs(rows) }];
    }),
  );
  return {
    byMode: Object.fromEntries(PROJECT_INSTRUCTION_MODES.map((mode) => [mode, summarizeMode(samples, mode)])),
    paired: summarizePairs(samples),
    byTask,
  };
}

function formatNumber(value) {
  return Number.isFinite(value) ? Math.round(value).toLocaleString("en-US") : "n/a";
}
function formatPercent(value) {
  return Number.isFinite(value) ? `${value.toFixed(1)}%` : "n/a";
}

export function renderPairedReport(document) {
  let report = "# Project-instruction paired benchmark\n\n";
  report += `Generated: ${escapeMarkdownText(document.generatedAt)}\n\nTask model: ${markdownCodeSpan(document.model)}\n\nCompiler model: ${markdownCodeSpan(document.compilerModel ?? document.model)}\n\n`;
  report += `P runtime-closure SHA-256: ${markdownCodeSpan(document.binarySha256)}\n\nSeed: ${markdownCodeSpan(document.seed)}\n\n`;
  report += `Candidate version: ${markdownCodeSpan(document.candidateVersion)}\n\n`;
  report += `Repetitions: ${formatNumber(document.runs)}; tasks: ${document.tasks.map(markdownCodeSpan).join(", ")}.\n\n`;
  report += "Per-cell token and runtime totals measure steady-state agent work only; compiler preparation is excluded.\n\n";
  if (document.compilerPreparation) {
    report += `One-time certified compiler preparation: **${formatNumber(document.compilerPreparation.usage.total)} tokens**, **${formatNumber(document.compilerPreparation.elapsedMs)} ms**.\n\n`;
  }
  if (document.completed && document.gate.passed) {
    report += "Correctness gate: **PASSED**. Every sample completed and passed every quality check.\n\n";
  } else if (document.gate.passed) {
    report += "Correctness gate: **RUNNING**. Performance conclusions remain suppressed until every sample passes.\n\n";
  } else {
    report += `Correctness gate: **HARD STOP** at run ${formatNumber(document.gate.failure.run)}, task ${markdownCodeSpan(document.gate.failure.task)}, mode ${markdownCodeSpan(document.gate.failure.mode)} (${escapeMarkdownText(document.gate.failure.kind ?? "unclassified")}): ${escapeMarkdownText(document.gate.failure.reason)}.\n\nNo token or runtime comparison is reported because correctness did not pass.\n\n`;
    report += renderGateFailureLiveness(document.gate.failure.liveness);
    report += renderBenchmarkCompilerFailureTelemetry(document.gate.failure.compilerFailure);
  }
  report += "## Randomized pair order\n\n| Run | Task | First | Second |\n| ---: | --- | --- | --- |\n";
  for (const pair of document.schedule) report += `| ${formatNumber(pair.run)} | ${escapeMarkdownTableCell(pair.task)} | ${escapeMarkdownTableCell(pair.modes[0])} | ${escapeMarkdownTableCell(pair.modes[1])} |\n`;
  report += "\n## Samples\n\n| Run | Task | Mode | Status | Quality | Session tokens | Runtime | First mutation | Requirement definitions |\n| ---: | --- | --- | --- | --- | ---: | ---: | ---: | ---: |\n";
  for (const sample of document.samples) {
    const score = formatNumber(sample.quality.rawScore ?? sample.quality.score);
    report += `| ${formatNumber(sample.run)} | ${escapeMarkdownTableCell(sample.task)} | ${escapeMarkdownTableCell(sample.mode)} | ${escapeMarkdownTableCell(sample.status)} | ${score}/${formatNumber(sample.quality.maxScore)} | ${formatNumber(sample.metrics.usage.totalTokens)} | ${formatNumber(sample.elapsedMs)} ms | ${formatNumber(sample.liveness?.firstMutationElapsedMs)} ms | ${formatNumber(sample.liveness?.requirementDefinitionAttemptCount)} |\n`;
  }
  if (!document.summary) return report;
  report += "\n## Performance after correctness\n\n";
  report += "| Mode | Quality passes | Median quality | Median session tokens | Median runtime |\n| --- | ---: | ---: | ---: | ---: |\n";
  for (const mode of PROJECT_INSTRUCTION_MODES) {
    const data = document.summary.byMode[mode];
    report += `| ${escapeMarkdownTableCell(mode)} | ${formatNumber(data.qualityPasses)}/${formatNumber(data.samples)} | ${formatPercent(data.medianQualityPercent)} | ${formatNumber(data.medianTotalTokens)} | ${formatNumber(data.medianElapsedMs)} ms |\n`;
  }
  report += `\nMedian paired compiled-vs-legacy delta: **${formatPercent(document.summary.paired.medianTokenDeltaPercent)} tokens**, **${formatPercent(document.summary.paired.medianRuntimeDeltaPercent)} runtime**. Negative is better for compiled mode.\n`;
  report += "\n## Per-task medians\n\n| Task | Legacy session tokens | Compiled session tokens | Paired token delta | Legacy runtime | Compiled runtime | Paired runtime delta |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n";
  for (const [task, data] of Object.entries(document.summary.byTask)) {
    report += `| ${escapeMarkdownTableCell(task)} | ${formatNumber(data.byMode.legacy.medianTotalTokens)} | ${formatNumber(data.byMode.compiled.medianTotalTokens)} | ${formatPercent(data.paired.medianTokenDeltaPercent)} | ${formatNumber(data.byMode.legacy.medianElapsedMs)} ms | ${formatNumber(data.byMode.compiled.medianElapsedMs)} ms | ${formatPercent(data.paired.medianRuntimeDeltaPercent)} |\n`;
  }
  return report;
}
