import { homedir } from "node:os";
import { resolve } from "node:path";
import { isThinkingLevel, type ThinkingLevel } from "../workloads/thinking-level.ts";
import { describeCaptureOverflow } from "./run-assessment.ts";
import {
  buildPairedSchedule,
  conditionConfiguration,
  DEFAULT_PROJECT_INSTRUCTION_CONDITIONS,
  type PairedScheduleCell,
  PROJECT_INSTRUCTION_CONDITIONS,
  type ProjectInstructionCondition,
  type ProjectInstructionMode,
  type TaskVerificationMode,
} from "./run-conditions.ts";
import type { TaskVerificationSemanticEvidence } from "./verification-semantic-proof.ts";

export { createBenchmarkGateFailure } from "./failure.ts";
export { assessSample } from "./run-assessment.ts";

export {
  PROJECT_INSTRUCTION_CONDITIONS,
  DEFAULT_PROJECT_INSTRUCTION_CONDITIONS,
  buildPairedSchedule,
  type ProjectInstructionCondition,
  type ProjectInstructionMode,
  type PairedScheduleCell,
  type TaskVerificationMode,
  conditionConfiguration,
};
export const PROJECT_INSTRUCTION_TASKS = [
  "typescript-calculator",
  "monolith-split",
  "event-sourced-inventory",
  "durable-workflow-saga",
];
export type PairedBenchmarkArgs = {
  model?: string;
  compilerModel?: string;
  modelsFile: string;
  tasks: string[];
  conditions: ProjectInstructionCondition[];
  runs: number;
  seed?: string;
  timeoutSeconds: number;
  maxRuntimeSeconds: number;
  output?: string;
  thinking?: ThinkingLevel;
  help: boolean;
};
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
  condition: ProjectInstructionCondition;
  mode: ProjectInstructionMode;
  taskVerificationMode: TaskVerificationMode;
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
    taskVerification?: TaskVerificationSemanticEvidence | null;
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
    conditions: [...DEFAULT_PROJECT_INSTRUCTION_CONDITIONS],
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
    "--thinking",
  ]);

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--help" || arg === "-h") {
      options.help = true;
      continue;
    }
    if (arg === "--include-audit") {
      options.conditions = [...PROJECT_INSTRUCTION_CONDITIONS];
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
    if (arg === "--thinking") {
      if (!isThinkingLevel(value)) throw new Error("--thinking must be off, minimal, low, medium, high, or xhigh");
      options.thinking = value;
    }
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

export function buildBenchmarkArgs(
  options: Omit<RunOptions, "seed" | "conditions">,
  pair: { task: string },
  condition: ProjectInstructionCondition,
  output: string,
  remainingSeconds: number,
  proofReceipt: { sha256: string },
): string[] {
  const configuration = conditionConfiguration(condition);
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
  if (configuration.projectInstructionMode === "compiled") {
    args.splice(4, 0, "--project-instruction-compiler-model", options.compilerModel);
  }
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
    configuration.projectInstructionMode,
    "--task-verification",
    configuration.taskVerificationMode,
    "--project-instructions-file",
    options.projectInstructionsFile,
    "--output",
    output,
  );
  if (options.thinking) args.push("--thinking", options.thinking);
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
