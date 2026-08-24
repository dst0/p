import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";
import { describeCaptureOverflow } from "./run-assessment.ts";

export { createBenchmarkGateFailure } from "./failure.ts";
export { assessSample } from "./run-assessment.ts";

export const PROJECT_INSTRUCTION_MODES = ["compiled", "legacy"] as const;
export const PROJECT_INSTRUCTION_TASKS = [
  "typescript-calculator",
  "monolith-split",
  "event-sourced-inventory",
  "durable-workflow-saga",
];
export type ProjectInstructionMode = "compiled" | "legacy";
export type PairedBenchmarkArgs = {
  model?: string;
  compilerModel?: string;
  modelsFile: string;
  tasks: string[];
  runs: number;
  seed?: string;
  timeoutSeconds: number;
  maxRuntimeSeconds: number;
  output?: string;
  help: boolean;
};
export type PairedScheduleCell = { run: number; task: string; modes: ProjectInstructionMode[] };
export type RunOptions = PairedBenchmarkArgs & {
  model: string;
  compilerModel: string;
  pCli: string;
  projectInstructionProbe: string;
  projectInstructionsFile: string;
};
export type PairedSample = {
  run: number;
  task: string;
  mode: ProjectInstructionMode;
  status: string;
  elapsedMs: number;
  quality: {
    passed?: boolean;
    rawScore?: number;
    score?: number;
    maxScore: number;
    checks: Array<{ name?: string; passed?: boolean }>;
  };
  metrics: {
    usage: { totalTokens: number };
    model?: { provider?: string; id?: string; api?: string };
    responseModel?: string;
  };
  liveness?: {
    firstMutationElapsedMs?: number | null;
    requirementDefinitionAttemptCount?: number | null;
    observedRequirementDefinitionAttemptCount?: number;
    requirementDefinitionRepairAttemptCount?: number | null;
    observedRequirementDefinitionRepairAttemptCount?: number;
    semanticEvidenceAvailable?: unknown;
    semanticEvidenceComplete?: unknown;
  };
  captureOverflow?: { kind?: unknown; captureName?: unknown; limitBytes?: unknown; limitCount?: unknown };
  [key: string]: unknown;
};

function positiveInteger(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}
function argumentValue(argv: string[], index: number, name: string): string {
  if (index + 1 >= argv.length) throw new Error(`${name} requires a value`);
  return argv[index + 1];
}
export function parsePairedArgs(argv: string[]): PairedBenchmarkArgs {
  const options: PairedBenchmarkArgs = {
    model: process.env.PI_BENCHMARK_MODEL,
    compilerModel: process.env.PI_BENCHMARK_COMPILER_MODEL,
    modelsFile: resolve(homedir(), ".p", "agent", "models.json"),
    tasks: [] as string[],
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

export function buildPairedSchedule(tasks: string[], runs: number, seed: string): PairedScheduleCell[] {
  const schedulesByTask = new Map<string, ProjectInstructionMode[]>();
  for (const task of tasks) {
    const starts: ProjectInstructionMode[] = [];
    for (let index = 0; index < Math.floor(runs / 2); index += 1) starts.push("compiled", "legacy");
    if (runs % 2 === 1) {
      const extra = createHash("sha256").update(`${seed}\0${task}\0extra`).digest()[0] % 2;
      starts.push(PROJECT_INSTRUCTION_MODES[extra]);
    }
    const randomized = starts
      .map((mode, index) => ({
        mode,
        order: createHash("sha256").update(`${seed}\0${task}\0${mode}\0${index}`).digest("hex"),
      }))
      .sort((left, right) => left.order.localeCompare(right.order))
      .map(({ mode }) => mode);
    schedulesByTask.set(task, randomized);
  }
  return Array.from({ length: runs }, (_, index) =>
    tasks.map((task) => {
      const first = schedulesByTask.get(task)?.[index];
      if (!first) throw new Error(`Missing randomized schedule for ${task}`);
      const second = PROJECT_INSTRUCTION_MODES.find((mode) => mode !== first);
      if (!second) throw new Error(`Missing counterbalanced mode for ${task}`);
      return { run: index + 1, task, modes: [first, second] };
    }),
  ).flat();
}
export function buildBenchmarkArgs(
  options: Omit<RunOptions, "seed">,
  pair: { task: string },
  mode: ProjectInstructionMode,
  output: string,
  remainingSeconds: number,
  proofReceipt: { sha256: string },
): string[] {
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

export function describeProjectInstructionStartupFailure(
  result:
    | {
        status?: unknown;
        projectInstructionEvidence?: {
          cache?: { manifest?: { mode?: unknown; compilerStatus?: unknown; compilerDiagnostic?: unknown } };
        };
      }
    | undefined,
): string | undefined {
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

export function assertChildSampleMetrics(result: {
  elapsedMs: number;
  status: string;
  metrics: PairedSample["metrics"];
  quality: PairedSample["quality"];
  captureOverflow?: PairedSample["captureOverflow"];
  projectInstructionEvidence?: {
    cache?: { manifest?: { mode?: unknown; compilerStatus?: unknown; compilerDiagnostic?: unknown } };
  };
}): void {
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

export function assertNoStartupProbeCaptureOverflow(
  startupProbes: Record<string, { captureOverflow?: PairedSample["captureOverflow"] }> = {},
): void {
  for (const [agent, probe] of Object.entries(startupProbes)) {
    const captureFailure = describeCaptureOverflow(probe?.captureOverflow, `${agent} startup probe`);
    if (captureFailure) throw new Error(captureFailure);
  }
}

export function verifyResolvedPModel(
  requested: string,
  metrics: PairedSample["metrics"],
  options: { requireResponseModel?: boolean } = {},
) {
  const separator = requested.indexOf("/");
  const provider = separator < 1 ? undefined : requested.slice(0, separator);
  const id = separator < 1 ? undefined : requested.slice(separator + 1);
  if (
    !provider ||
    !id ||
    metrics?.model?.provider !== provider ||
    metrics.model.id !== id ||
    typeof metrics.model.api !== "string"
  ) {
    throw new Error("child benchmark resolved model identity mismatch");
  }
  if (
    (options.requireResponseModel ?? true) &&
    (typeof metrics.responseModel !== "string" || metrics.responseModel.length === 0)
  ) {
    throw new Error("child benchmark did not report its response model");
  }
  return { provider, id, api: metrics.model.api, responseModel: metrics.responseModel };
}
