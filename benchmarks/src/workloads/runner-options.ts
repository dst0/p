import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
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
  kiloModel?: string;
  kiloVersion: string;
  kiloConfig: string;
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
  console.log(`Usage:
  npm run benchmark:agents -- --model <provider/id> [options]

Compare this checkout (p) with PI and optional Kilo, Codex, and AGY CLIs, using the same
underlying model and four deterministic TypeScript coding fixtures, including
transactional event sourcing and an extreme durable workflow/saga challenge.

Options:
  --model <provider/id>       PI/P model alias (required when either is selected)
  --p-cli <path>              P CLI entry point (default: this checkout's build)
  --agents <list>             Comma-separated sequential order
                              (default: pi,p; supported: ${supportedAgents.join(",")})
  --models-file <path>        Custom models.json copied into temporary agent dirs
                              (default: ~/.p/agent/models.json)
  --pi-version <ver>          PI package version (default: ${defaultPiVersion})
  --kilo-model <provider/id>  Kilo model alias (required when Kilo is selected)
  --kilo-version <ver>        Required installed Kilo version
                              (default: ${defaultKiloVersion})
  --kilo-config <path>        Kilo config copied into an isolated temporary XDG home
                              (default: ~/.config/kilo/kilo.jsonc)
  --expected-resolved-model <provider/id>
                              Backend model Kilo must resolve before fixtures start
  --kilo-startup-timeout-seconds <n>
                              Bounded timeout for each Kilo startup probe
                              (default: ${defaultKiloStartupTimeoutSeconds})
  --codex-model <provider/id> Codex model alias (required when Codex is selected)
  --codex-config <path>       Codex config.toml (default: ~/.codex/config.toml)
  --agy-model <model-id>      Google Antigravity model (required when AGY is selected)
  --task <id>                 Run only one fixture (optional)
  --project-instructions <mode> P-only mode: compiled, legacy, or off
  --task-verification <mode>   P-only verification: evidence, audit, or off
  --project-instruction-compiler-model <provider/id> Dedicated P compiler model
  --project-instructions-file <path> Authoritative source copied into each P fixture
  --thinking <level>           P reasoning level: off, minimal, low, medium, high, or xhigh
  --runs <n>                  Complete repetitions (default: 1)
  --timeout-seconds <n>       Per-agent task timeout (default: ${defaultTimeoutSeconds})
  --minimum-timeout-seconds <n> Raise shorter fixture timeouts to at least this value
  --max-runtime-seconds <n>   Overall deadline (default: ${defaultMaxRuntimeSeconds})
  --output <dir>              Results directory
                              (default: benchmarks/results/<timestamp>)
  --help                      Show this help

Each result directory contains compressed JSONL session recordings, stderr logs, the
final fixture workspaces, results.json, and report.md. No real session files
are created; auth and model configuration are copied only to a temporary
directory and removed when the benchmark exits.
`);
}

function parsePositiveInteger(value: string, name: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) throw new Error(`${name} must be a positive integer`);
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
      .map((agent) => agent.trim())
      .filter(Boolean);
    if (!agents.every(isAgentId)) throw new Error(`Unsupported agent: ${agents.find((agent) => !isAgentId(agent))}`);
    options.agents = agents;
  } else if (argument === "--models-file") options.modelsFile = resolve(value);
  else if (argument === "--pi-version") options.piVersion = value;
  else if (argument === "--kilo-model") options.kiloModel = value;
  else if (argument === "--kilo-version") options.kiloVersion = value;
  else if (argument === "--kilo-config") options.kiloConfig = resolve(value);
  else if (argument === "--expected-resolved-model") options.expectedResolvedModel = value;
  else if (argument === "--codex-model") options.codexModel = value;
  else if (argument === "--codex-config") options.codexConfig = resolve(value);
  else if (argument === "--agy-model") options.agyModel = value;
  else if (argument === "--task") options.task = value;
  else if (argument === "--project-instructions") {
    if (value !== "compiled" && value !== "legacy" && value !== "off") {
      throw new Error("--project-instructions must be compiled, legacy, or off");
    }
    options.projectInstructions = value;
  } else if (argument === "--project-instruction-compiler-model") {
    options.projectInstructionCompilerModel = value;
  } else if (argument === "--task-verification") {
    if (value !== "evidence" && value !== "audit" && value !== "off") {
      throw new Error("--task-verification must be evidence, audit, or off");
    }
    options.taskVerificationMode = value;
  } else if (argument === "--project-instructions-file") options.projectInstructionsFile = resolve(value);
  else if (argument === "--thinking") {
    if (!isThinkingLevel(value)) throw new Error("--thinking must be off, minimal, low, medium, high, or xhigh");
    options.thinking = value;
  } else if (argument === "--output") options.output = resolve(value);
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
  };
  const stringOptions = new Set([
    "--model",
    "--p-cli",
    "--project-instruction-probe",
    "--project-instruction-proof-receipt",
    "--agents",
    "--models-file",
    "--pi-version",
    "--kilo-model",
    "--kilo-version",
    "--kilo-config",
    "--expected-resolved-model",
    "--codex-model",
    "--codex-config",
    "--agy-model",
    "--task",
    "--project-instructions",
    "--project-instruction-compiler-model",
    "--task-verification",
    "--project-instructions-file",
    "--thinking",
    "--output",
  ]);
  const integerOptions = new Set([
    "--runs",
    "--timeout-seconds",
    "--minimum-timeout-seconds",
    "--max-runtime-seconds",
    "--kilo-startup-timeout-seconds",
  ]);
  for (let index = 0; index < argv.length; index += 1) {
    const argument = argv[index];
    if (argument === undefined) continue;
    if (argument === "--help" || argument === "-h") {
      options.help = true;
      continue;
    }
    if (stringOptions.has(argument)) {
      assignStringOption(options, argument, valueAfter(argv, index, argument));
      index += 1;
      continue;
    }
    if (integerOptions.has(argument)) {
      const value = parsePositiveInteger(valueAfter(argv, index, argument), argument);
      if (argument === "--runs") options.runs = value;
      else if (argument === "--timeout-seconds") options.timeoutSeconds = value;
      else if (argument === "--minimum-timeout-seconds") options.minimumTimeoutSeconds = value;
      else if (argument === "--max-runtime-seconds") options.maxRuntimeSeconds = value;
      else options.kiloStartupTimeoutSeconds = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown option: ${argument}`);
  }
  if (options.help) return options;
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
    if (!options.expectedResolvedModel) {
      throw new Error("--expected-resolved-model is required when Kilo runs without PI/P");
    }
  }
  if (options.agents.includes("codex") && !options.codexModel) {
    throw new Error("--codex-model is required when Codex is selected");
  }
  if (options.agents.includes("agy") && !options.agyModel) {
    throw new Error("--agy-model is required when AGY is selected");
  }
  return options;
}
