import { createHash, randomBytes } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { certifiedMinimumRuntimeSeconds } from "./certification-runtime-budget.ts";
import { printRunnerHelp as displayRunnerHelp } from "./runner-help.ts";
import { isThinkingLevel, type ThinkingLevel } from "./thinking-level.ts";

export const supportedAgents = ["pi", "p", "kilo", "codex", "agy"] as const;
export type AgentId = (typeof supportedAgents)[number];
export type ProjectInstructionMode = "compiled" | "legacy" | "off";
export type TaskVerificationMode = "evidence" | "audit" | "off";

export type RunnerOptions = {
  model?: string;
  projectInstructionCompilerModel?: string;
  pCli: string;
  projectInstructionProbe: string;
  projectInstructionProofReceipt?: string;
  projectInstructionsFile: string;
  projectInstructions?: ProjectInstructionMode;
  taskVerificationMode?: TaskVerificationMode;
  agents: AgentId[];
  modelsFile: string;
  piVersion: string;
  piExecutable?: string;
  kiloModel?: string;
  kiloVersion: string;
  kiloConfig: string;
  kiloExecutable?: string;
  expectedResolvedModel?: string;
  kiloStartupTimeoutSeconds: number;
  codexModel?: string;
  codexConfig: string;
  agyModel?: string;
  task?: string;
  runs: number;
  timeoutSeconds: number;
  minimumTimeoutSeconds?: number;
  maxRuntimeSeconds: number;
  output?: string;
  thinking?: ThinkingLevel;
  outputLimits?: Readonly<Record<string, number>>;
  certified?: boolean;
  certifiedNetworkHosts?: string[];
  candidateRuntimePath?: string;
  maxDurationRatio?: number;
  maxTokenRatio?: number;
  maxCostRatio?: number;
  help?: boolean;
  signal?: AbortSignal;
};

export const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const codingAgentCli = join(repoRoot, "packages", "coding-agent", "dist", "cli.js");
const defaultModelsFile = join(homedir(), ".p", "agent", "models.json");
const defaultKiloConfigFile = join(homedir(), ".config", "kilo", "kilo.jsonc");
const defaultCodexConfigFile = join(homedir(), ".codex", "config.toml");
const defaultPiVersion = "0.82.1";
const defaultKiloVersion = "7.4.17";
const defaultTimeoutSeconds = 300;
const defaultMaxRuntimeSeconds = 900;
const defaultKiloStartupTimeoutSeconds = 60;

export function printRunnerHelp(): void {
  displayRunnerHelp({
    supportedAgents,
    defaultPiVersion,
    defaultKiloVersion,
    defaultTimeoutSeconds,
    defaultMaxRuntimeSeconds,
    defaultKiloStartupTimeoutSeconds,
  });
}

function parsePositiveInteger(value: string, name: string): number {
  const trimmed = value.trim();
  if (!/^\d+$/u.test(trimmed)) throw new Error(`${name} must be a positive integer`);
  const parsed = Number(trimmed);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
  return parsed;
}

function parsePositiveFloat(value: string, name: string): number {
  const trimmed = value.trim();
  if (!/^\d+(?:\.\d+)?(?:[eE][+-]?\d+)?$/u.test(trimmed)) throw new Error(`${name} must be a positive number`);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`${name} must be a positive number`);
  return parsed;
}

function isAgentId(value: string): value is AgentId {
  return supportedAgents.some((agent) => agent === value);
}

function valueAfter(argv: readonly string[], index: number, argument: string): string {
  const value = argv[index + 1];
  if (value === undefined) throw new Error(`${argument} requires a value`);
  return value;
}

function assignStringOption(options: RunnerOptions, argument: string, value: string): void {
  if (argument === "--model") options.model = value;
  else if (argument === "--p-cli") options.pCli = resolve(value);
  else if (argument === "--project-instruction-probe") options.projectInstructionProbe = resolve(value);
  else if (argument === "--project-instruction-proof-receipt") options.projectInstructionProofReceipt = value;
  else if (argument === "--agents") {
    const agents = value
      .split(",")
      .map((a) => a.trim())
      .filter(Boolean);
    if (!agents.every(isAgentId)) throw new Error(`Unsupported agent: ${agents.find((a) => !isAgentId(a))}`);
    options.agents = agents;
  } else if (argument === "--models-file") options.modelsFile = resolve(value);
  else if (argument === "--pi-version") options.piVersion = value;
  else if (argument === "--pi-executable") options.piExecutable = resolve(value);
  else if (argument === "--kilo-model") options.kiloModel = value;
  else if (argument === "--kilo-version") options.kiloVersion = value;
  else if (argument === "--kilo-config") options.kiloConfig = resolve(value);
  else if (argument === "--kilo-executable") options.kiloExecutable = resolve(value);
  else if (argument === "--expected-resolved-model") options.expectedResolvedModel = value;
  else if (argument === "--codex-model") options.codexModel = value;
  else if (argument === "--codex-config") options.codexConfig = resolve(value);
  else if (argument === "--agy-model") options.agyModel = value;
  else if (argument === "--task") options.task = value;
  else if (argument === "--project-instructions") {
    if (value !== "compiled" && value !== "legacy" && value !== "off")
      throw new Error("--project-instructions must be compiled, legacy, or off");
    options.projectInstructions = value;
  } else if (argument === "--project-instruction-compiler-model") options.projectInstructionCompilerModel = value;
  else if (argument === "--task-verification") {
    if (value !== "evidence" && value !== "audit" && value !== "off")
      throw new Error("--task-verification must be evidence, audit, or off");
    options.taskVerificationMode = value;
  } else if (argument === "--project-instructions-file") options.projectInstructionsFile = resolve(value);
  else if (argument === "--thinking") {
    if (!isThinkingLevel(value)) throw new Error("--thinking must be off, minimal, low, medium, high, or xhigh");
    options.thinking = value;
  } else if (argument === "--output") options.output = resolve(value);
  else if (argument === "--certified-network-host") {
    options.certifiedNetworkHosts ??= [];
    options.certifiedNetworkHosts.push(value);
  }
}

export function parseRunnerArgs(argv: readonly string[]): RunnerOptions {
  const options: RunnerOptions = {
    model: process.env.PI_BENCHMARK_MODEL,
    projectInstructionCompilerModel: process.env.PI_BENCHMARK_COMPILER_MODEL,
    pCli: codingAgentCli,
    projectInstructionProbe: join(repoRoot, "benchmarks", "src", "project-instructions", "probe.ts"),
    projectInstructionsFile: join(repoRoot, "AGENTS.md"),
    agents: ["pi", "p"],
    modelsFile: defaultModelsFile,
    piVersion: defaultPiVersion,
    kiloModel: process.env.KILO_BENCHMARK_MODEL,
    kiloVersion: defaultKiloVersion,
    kiloConfig: defaultKiloConfigFile,
    expectedResolvedModel: process.env.BENCHMARK_RESOLVED_MODEL,
    kiloStartupTimeoutSeconds: defaultKiloStartupTimeoutSeconds,
    codexModel: process.env.CODEX_BENCHMARK_MODEL,
    codexConfig: defaultCodexConfigFile,
    agyModel: process.env.AGY_BENCHMARK_MODEL,
    runs: 1,
    timeoutSeconds: defaultTimeoutSeconds,
    maxRuntimeSeconds: defaultMaxRuntimeSeconds,
    certifiedNetworkHosts: (process.env.P_BENCHMARK_CERTIFIED_NETWORK_HOSTS ?? "")
      .split(",")
      .map((host) => host.trim())
      .filter(Boolean),
  };
  const stringOptions = new Set(
    "--model --p-cli --project-instruction-probe --project-instruction-proof-receipt --agents --models-file --pi-version --pi-executable --kilo-model --kilo-version --kilo-config --kilo-executable --expected-resolved-model --codex-model --codex-config --agy-model --task --project-instructions --project-instruction-compiler-model --task-verification --project-instructions-file --thinking --output --certified-network-host".split(
      " ",
    ),
  );
  const integerOptions = new Set(
    "--runs --timeout-seconds --minimum-timeout-seconds --max-runtime-seconds --kilo-startup-timeout-seconds".split(
      " ",
    ),
  );
  const floatOptions = new Set(["--max-duration-ratio", "--max-token-ratio", "--max-cost-ratio"]);
  let explicitAgents = false;
  let explicitMaxRuntime = false;

  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (!argument) continue;
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (argument === "--certified") {
      options.certified = true;
      continue;
    }
    if (stringOptions.has(argument)) {
      if (argument === "--agents") explicitAgents = true;
      assignStringOption(options, argument, valueAfter(argv, index, argument));
      index += 1;
      continue;
    }
    if (integerOptions.has(argument)) {
      const value = parsePositiveInteger(valueAfter(argv, index, argument), argument);
      if (argument === "--max-runtime-seconds") explicitMaxRuntime = true;
      if (argument === "--runs") options.runs = value;
      else if (argument === "--timeout-seconds") options.timeoutSeconds = value;
      else if (argument === "--minimum-timeout-seconds") options.minimumTimeoutSeconds = value;
      else if (argument === "--max-runtime-seconds") options.maxRuntimeSeconds = value;
      else options.kiloStartupTimeoutSeconds = value;
      index += 1;
      continue;
    }
    if (floatOptions.has(argument)) {
      const value = parsePositiveFloat(valueAfter(argv, index, argument), argument);
      if (argument === "--max-duration-ratio") options.maxDurationRatio = value;
      else if (argument === "--max-token-ratio") options.maxTokenRatio = value;
      else options.maxCostRatio = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  if (options.help) return options;
  if (options.certified) {
    if (options.thinking) {
      throw new Error(
        "Certified mode does not permit asymmetric --thinking generation options; all agents must use equivalent parameters",
      );
    }
    if (options.projectInstructionCompilerModel) {
      throw new Error("Certified mode does not permit a separate project-instruction compiler model");
    }
    if (options.taskVerificationMode && options.taskVerificationMode !== "evidence") {
      throw new Error("Certified mode requires the default evidence task-verification profile");
    }
    if (!options.projectInstructionProofReceipt) {
      options.projectInstructionProofReceipt = createHash("sha256").update(randomBytes(32)).digest("hex");
    }
    if (!explicitAgents) options.agents = ["p", "pi", "kilo"];
    const certSet = new Set(options.agents);
    const validCertAgents = certSet.size === 3 && certSet.has("p") && certSet.has("pi") && certSet.has("kilo");
    if (options.agents.length !== 3 || !validCertAgents) {
      throw new Error("Certified mode requires exactly agents p, pi, and kilo");
    }
    if (options.runs < 3) throw new Error("Certified mode requires at least 3 runs");
    if (options.task) throw new Error("Certified mode requires all 4 canonical benchmark tasks");
    if (!options.model) throw new Error("--model is required for certified comparison mode");
    if (!options.expectedResolvedModel) throw new Error("--expected-resolved-model is required in certified mode");
    if (options.projectInstructions && options.projectInstructions !== "compiled") {
      throw new Error("Certified mode requires compiled project instructions");
    }
    options.kiloModel ??= options.model;
    options.projectInstructions = "compiled";
    options.taskVerificationMode = "evidence";
    const minimumRuntime = certifiedMinimumRuntimeSeconds(options);
    if (explicitMaxRuntime && options.maxRuntimeSeconds < minimumRuntime) {
      throw new Error(`Certified --max-runtime-seconds must be at least ${minimumRuntime}`);
    }
    if (!explicitMaxRuntime) options.maxRuntimeSeconds = minimumRuntime;
    options.maxDurationRatio ??= 1.0;
    options.maxTokenRatio ??= 1.0;
    return options;
  }
  if (options.agents.length === 0) throw new Error("--agents must include at least one agent");
  if (new Set(options.agents).size !== options.agents.length) throw new Error("--agents must not contain duplicates");
  if (options.agents.some((agent) => agent === "pi" || agent === "p") && !options.model) {
    throw new Error("--model is required when PI or P is selected");
  }
  if (options.agents.includes("kilo") && !options.kiloModel) {
    if (options.model?.includes("sokann-qwen-27b")) options.kiloModel = "llm-orchestrator/sokann-qwen-27b";
    else throw new Error("--kilo-model is required when Kilo is selected");
  }
  if (options.agents.includes("kilo")) {
    options.expectedResolvedModel ??=
      options.kiloModel === "llm-orchestrator/sokann-qwen-27b" ? "mini-pc/sokann-qwen-27b" : options.model;
    if (!options.expectedResolvedModel)
      throw new Error("--expected-resolved-model is required when Kilo runs without PI/P");
  }
  if (options.agents.includes("codex") && !options.codexModel)
    throw new Error("--codex-model is required when Codex is selected");
  if (options.agents.includes("agy") && !options.agyModel)
    throw new Error("--agy-model is required when AGY is selected");
  return options;
}
