import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { augmentBenchmarkPath } from "../agents/environment.ts";
import { sanitizeBenchmarkGitEnvironment } from "../harness/workspace-repository.ts";
import { configureProjectInstructionProbe } from "../project-instructions/evidence.ts";
import { type AgentId, type RunnerOptions, repoRoot } from "./runner-options.ts";
import type { BenchmarkTask } from "./task-definition.ts";

export type AgentCommand = {
  executable: string;
  args: string[];
  env: NodeJS.ProcessEnv;
  cwd: string;
};

export type PromptTask = Pick<BenchmarkTask, "prompt" | "timeoutSeconds"> & { isProbe?: boolean };

function required(value: string | undefined, option: string): string {
  if (!value) throw new Error(`${option} is required`);
  return value;
}

function kiloEnvironment(configDir: string): NodeJS.ProcessEnv {
  return {
    ...sanitizeBenchmarkGitEnvironment(),
    HOME: configDir,
    NO_COLOR: "1",
    XDG_CACHE_HOME: join(configDir, "cache"),
    XDG_CONFIG_HOME: join(configDir, "config"),
    XDG_DATA_HOME: join(configDir, "data"),
    XDG_STATE_HOME: join(configDir, "state"),
  };
}

export function commandForAgent(
  agent: AgentId,
  options: RunnerOptions,
  task: PromptTask,
  configDir: string,
  workspace: string,
  isContinue = false,
  promptOverride?: string,
): AgentCommand {
  const prompt = promptOverride ?? task.prompt;
  if (agent === "agy") {
    const args = [
      "--model",
      required(options.agyModel, "--agy-model"),
      "--dangerously-skip-permissions",
      "--output-format",
      "stream-json",
      "--print-timeout",
      `${task.timeoutSeconds ?? options.timeoutSeconds}s`,
      isContinue ? "--continue" : "--new-project",
      "-p",
      prompt,
    ];
    return {
      executable: "agy",
      args,
      env: { ...sanitizeBenchmarkGitEnvironment(), NO_COLOR: "1" },
      cwd: workspace,
    };
  }
  if (agent === "kilo") {
    const args = ["run", "--model", required(options.kiloModel, "--kilo-model"), "--format", "json", "--pure"];
    if (!task.isProbe) args.push("--auto");
    args.push("--dir", workspace);
    if (isContinue) args.push("--continue");
    args.push(prompt);
    return { executable: "kilo", args, env: kiloEnvironment(configDir), cwd: workspace };
  }
  if (agent === "codex") {
    return {
      executable: "codex",
      args: [
        "exec",
        "-c",
        'model_provider="blackbox-ai-gateway"',
        "-m",
        required(options.codexModel, "--codex-model"),
        "--json",
        "--dangerously-bypass-approvals-and-sandbox",
        "--color",
        "never",
        "-C",
        workspace,
        prompt,
      ],
      env: { ...sanitizeBenchmarkGitEnvironment(), NO_COLOR: "1", CODEX_HOME: configDir },
      cwd: workspace,
    };
  }
  const commonArgs = [
    "--mode",
    "json",
    "--model",
    required(options.model, "--model"),
    "--no-extensions",
    "--no-skills",
    "--no-themes",
  ];
  if (!(agent === "p" && options.projectInstructions)) commonArgs.push("--no-context-files");
  if (isContinue) commonArgs.push("--continue");
  const env: NodeJS.ProcessEnv = sanitizeBenchmarkGitEnvironment();
  env.P_CODING_AGENT_DIR = configDir;
  env.PI_CODING_AGENT_DIR = configDir;
  if (agent === "p" && options.projectInstructions) env.HOME = configDir;
  if (agent === "p" && options.projectInstructions) {
    configureProjectInstructionProbe(
      commonArgs,
      env,
      options,
      workspace,
      required(options.projectInstructionProofReceipt, "--project-instruction-proof-receipt"),
    );
  }
  commonArgs.push(prompt);
  env.P_SKIP_VERSION_CHECK = "1";
  env.PI_SKIP_VERSION_CHECK = "1";
  const caPath = join(homedir(), ".p", "agent", "ca.pem");
  if (existsSync(caPath)) env.NODE_EXTRA_CA_CERTS = caPath;
  env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  env.NO_COLOR = "1";
  env.PATH = augmentBenchmarkPath(repoRoot);
  if (agent === "p") {
    return { executable: process.execPath, args: [options.pCli, ...commonArgs], env, cwd: workspace };
  }
  return {
    executable: "npm",
    args: [
      "exec",
      "--yes",
      `--package=@earendil-works/pi-coding-agent@${options.piVersion}`,
      "--",
      "pi",
      ...commonArgs,
    ],
    env,
    cwd: workspace,
  };
}

export function commandForKiloModelResolution(
  options: RunnerOptions,
  configDir: string,
  workspace: string,
): AgentCommand {
  const kiloModel = required(options.kiloModel, "--kilo-model");
  const separator = kiloModel.indexOf("/");
  const provider = separator === -1 ? kiloModel : kiloModel.slice(0, separator);
  return {
    executable: "kilo",
    args: ["models", provider, "--verbose", "--pure"],
    env: kiloEnvironment(configDir),
    cwd: workspace,
  };
}
