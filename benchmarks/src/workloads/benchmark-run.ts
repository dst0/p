import { existsSync, mkdirSync, rmSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { augmentBenchmarkPath } from "../agents/environment.ts";
import { type BenchmarkAgentDirectories, createBenchmarkAgentDirectories } from "../agents/private-directories.ts";
import { finalizeBenchmarkAgentResources } from "../agents/resources-finalization.ts";
import { createBenchmarkAuthOutputGuard } from "../harness/auth-output-guard.ts";
import { consumeBenchmarkAuthSource } from "../harness/auth-source.ts";
import { benchmarkModels, modelAliasForAgent } from "../harness/model-attribution.ts";
import { type BenchmarkResult, createBenchmarkReport } from "../harness/report.ts";
import { sanitizeBenchmarkEvidence } from "../harness/result-sanitization.ts";
import { writeBenchmarkStderrLog } from "../harness/stderr-log.ts";
import { createBenchmarkWorkspace } from "../harness/workspace-repository.ts";
import { captureRecordedProjectInstructionEvidence } from "../project-instructions/evidence.ts";
import {
  sendCommittedProjectInstructionOuterAuthority,
  writeProjectInstructionResultPublication,
} from "../project-instructions/outer-authority.ts";
import { nudgePenaltyPerNudge, runAgentTask } from "./agent-turn-runner.ts";
import { resolveAgentVersions } from "./installed-agent-versions.ts";
import { parseRecording } from "./recording-metrics.ts";
import { parseRunnerArgs, printRunnerHelp, type RunnerOptions, repoRoot } from "./runner-options.ts";
import {
  type AgyStartupEvidence,
  type KiloStartupEvidence,
  runAgyStartupProbe,
  runKiloStartupProbe,
} from "./startup-probes.ts";
import { benchmarkTasks, createTaskBaseline } from "./task-registry.ts";

const defaultAuthFile = consumeBenchmarkAuthSource();
process.env.PATH = augmentBenchmarkPath(repoRoot);

type BenchmarkResultRow = BenchmarkResult & {
  description?: string;
  exitCode?: number | null | undefined;
  signal?: NodeJS.Signals | null;
  timedOut?: boolean;
  error?: string;
  captureOverflow?: unknown;
  recordingCapture?: unknown;
  modelAlias?: string;
  nudges?: number;
  nudgePenalty?: number;
  recording?: string;
  stderr?: string;
  workspace?: string;
  projectInstructionEvidence?: unknown;
};

function ensureDirectory(path: string): void {
  mkdirSync(path, { recursive: true });
}

function cleanupGeneratedWorkspaceState(workspace: string): void {
  rmSync(join(workspace, ".pdev"), { recursive: true, force: true });
}

function formatMilliseconds(value: number): string {
  return `${Math.round(value)} ms`;
}

function formatNumber(value: number): string {
  return Math.round(value).toLocaleString("en-US");
}

function validateRuntimeInputs(options: RunnerOptions): void {
  if (!existsSync(options.pCli)) {
    throw new Error(`Missing ${options.pCli}; build packages/coding-agent before running the benchmark`);
  }
  if (options.projectInstructions && !existsSync(options.projectInstructionsFile)) {
    throw new Error(`Missing ${options.projectInstructionsFile}`);
  }
  if (options.projectInstructions && !existsSync(options.projectInstructionProbe)) {
    throw new Error(`Missing ${options.projectInstructionProbe}`);
  }
  if (options.agents.some((agent) => agent === "pi" || agent === "p") && !existsSync(options.modelsFile)) {
    console.warn(
      `Warning: models file not found at ${options.modelsFile}; built-in provider configuration will be used`,
    );
  }
  if (options.agents.includes("kilo") && !existsSync(options.kiloConfig)) {
    throw new Error(`Kilo config not found at ${options.kiloConfig}`);
  }
}

export async function runAgentBenchmark(signal: AbortSignal): Promise<void> {
  const options = Object.assign(parseRunnerArgs(process.argv.slice(2)), { signal });
  if (options.help) {
    printRunnerHelp();
    return;
  }
  validateRuntimeInputs(options);
  const versions = resolveAgentVersions(options);
  const selectedTasks = options.task ? benchmarkTasks.filter((task) => task.id === options.task) : benchmarkTasks;
  if (selectedTasks.length === 0) throw new Error(`Unknown task: ${options.task}`);
  const output =
    options.output ?? join(repoRoot, "benchmarks", "results", new Date().toISOString().replaceAll(/[:.]/g, "-"));
  ensureDirectory(output);
  ensureDirectory(join(output, "recordings"));
  ensureDirectory(join(output, "stderr"));
  const results: BenchmarkResultRow[] = [];
  const startupProbes: { kilo?: KiloStartupEvidence; agy?: AgyStartupEvidence } = {};
  const deadline = performance.now() + options.maxRuntimeSeconds * 1000;
  console.log(`Benchmark output: ${output}`);
  console.log(`PI/P model: ${options.model ?? "not selected"}`);
  if (options.agents.includes("kilo")) console.log(`Kilo model: ${options.kiloModel}`);
  if (options.agents.includes("codex")) console.log(`Codex model: ${options.codexModel}`);
  if (options.agents.includes("agy")) console.log(`AGY model: ${options.agyModel}`);
  console.log(`Versions: ${options.agents.map((agent) => `${agent} ${versions[agent]}`).join(", ")}`);
  console.log(`Sequential order: ${options.agents.join(" -> ")}`);
  const authOutputGuard = createBenchmarkAuthOutputGuard([defaultAuthFile]);
  let agentDirs: BenchmarkAgentDirectories | undefined;
  let projectInstructionOuterAuthority: Parameters<typeof sendCommittedProjectInstructionOuterAuthority>[1] | undefined;
  const resultPath = join(output, "results.json");
  try {
    agentDirs = createBenchmarkAgentDirectories({
      ...options,
      authFile: defaultAuthFile,
    });
    for (const agent of ["pi", "p"] as const) {
      authOutputGuard.capture(join(agentDirs.dirs[agent], "auth.json"));
    }
    if (options.agents.includes("kilo")) {
      const evidence = await runKiloStartupProbe(options, agentDirs.dirs.kilo, output, deadline);
      startupProbes.kilo = evidence;
      console.log(`Kilo startup probe: passed, resolved ${evidence.resolvedModel}`);
    }
    if (options.agents.includes("agy")) {
      const evidence = await runAgyStartupProbe(options, agentDirs.dirs.agy, output, deadline);
      startupProbes.agy = evidence;
      console.log(`AGY startup probe: passed, resolved ${evidence.resolvedModel}`);
    }
    for (let run = 1; run <= options.runs; run += 1) {
      for (const agent of options.agents) {
        for (const task of selectedTasks) {
          if (deadline - performance.now() <= 0) {
            results.push({ run, agent, task: task.id, status: "skipped" });
            console.log(`[run ${run}] ${agent}/${task.id}: skipped (overall deadline reached)`);
            continue;
          }
          const workspace = createBenchmarkWorkspace(output, agent, run, task, options);
          const baseline = createTaskBaseline(task);
          const taskTimeout = Math.max(
            task.timeoutSeconds ?? options.timeoutSeconds,
            options.minimumTimeoutSeconds ?? 0,
          );
          const recordingName = `${agent}-run-${run}-${task.id}.jsonl.br`;
          const stderrStem = `${agent}-run-${run}-${task.id}`;
          const result = await runAgentTask(
            agent,
            options,
            task,
            agentDirs.dirs[agent],
            workspace,
            join(output, "recordings", recordingName),
            taskTimeout,
            deadline,
          );
          const stderrName = writeBenchmarkStderrLog(join(output, "stderr"), stderrStem, result.stderr);
          const metrics = parseRecording(result.stdout, agent);
          metrics.rawEventCount = result.rawEventCount;
          const projectInstructionEvidence = options.projectInstructions
            ? captureRecordedProjectInstructionEvidence(
                workspace,
                options.projectInstructions,
                options.taskVerificationMode,
                options.projectInstructionsFile,
                result,
                metrics,
              )
            : undefined;
          cleanupGeneratedWorkspaceState(workspace);
          const quality = task.verify(workspace, baseline, metrics.finalText);
          const penalty = result.nudges * nudgePenaltyPerNudge;
          quality.rawScore = quality.score;
          quality.penalty = penalty;
          quality.score = Math.max(0, quality.score - penalty);
          quality.nudges = result.nudges;
          quality.finishNotesCreated = existsSync(join(workspace, "finish_notes.md"));
          const status = result.timedOut
            ? "timed_out"
            : result.code === 0 && metrics.errors.length === 0 && quality.passed
              ? "passed"
              : "failed";
          results.push({
            run,
            agent,
            task: task.id,
            description: task.description,
            status,
            elapsedMs: result.elapsedMs,
            exitCode: result.code,
            signal: result.signal,
            timedOut: result.timedOut,
            error: result.error,
            captureOverflow: result.captureOverflow,
            recordingCapture: result.recordingCapture,
            modelAlias: modelAliasForAgent(agent, options),
            nudges: result.nudges,
            nudgePenalty: penalty,
            recording: join("recordings", recordingName),
            stderr: join("stderr", stderrName),
            workspace: workspace.slice(output.length + 1),
            projectInstructionEvidence,
            metrics,
            quality,
          });
          const nudgeNotice =
            result.nudges > 0 ? ` (${result.nudges} nudge${result.nudges === 1 ? "" : "s"}, -${penalty} pts)` : "";
          console.log(
            `[run ${run}] ${agent}/${task.id}: ${status}${nudgeNotice}, ${formatMilliseconds(result.elapsedMs)}, ${formatNumber(metrics.usage.totalTokens)} tokens, ${metrics.toolCalls} tool calls`,
          );
        }
      }
    }
    const reportStartupProbes = {
      ...(startupProbes.kilo?.resolvedModel
        ? { kilo: { status: startupProbes.kilo.status, resolvedModel: startupProbes.kilo.resolvedModel } }
        : {}),
      ...(startupProbes.agy?.resolvedModel
        ? { agy: { status: startupProbes.agy.status, resolvedModel: startupProbes.agy.resolvedModel } }
        : {}),
    };
    const summaries = createBenchmarkReport(
      options,
      versions,
      results,
      output,
      selectedTasks,
      reportStartupProbes,
      nudgePenaltyPerNudge,
    );
    const resultDocument = {
      generatedAt: new Date().toISOString(),
      agents: options.agents,
      models: benchmarkModels(options),
      versions,
      startupProbes,
      runs: options.runs,
      timeoutSeconds: options.timeoutSeconds,
      maxRuntimeSeconds: options.maxRuntimeSeconds,
      projectInstructions: options.projectInstructions,
      taskVerificationMode: options.taskVerificationMode,
      tasks: selectedTasks.map(({ id, description, timeoutSeconds }) => ({
        id,
        description,
        timeoutSeconds,
      })),
      summaries,
      results,
    };
    const sanitized = sanitizeBenchmarkEvidence(resultDocument, {
      output,
      repoRoot,
      home: homedir(),
    });
    projectInstructionOuterAuthority = writeProjectInstructionResultPublication(
      resultPath,
      sanitized as Parameters<typeof writeProjectInstructionResultPublication>[1],
      options.projectInstructions,
    );
    console.log(`Report: ${join(output, "report.md")}`);
    if (!results.some((result) => result.status !== "skipped")) process.exitCode = 1;
  } finally {
    finalizeBenchmarkAgentResources(agentDirs, authOutputGuard, output, options.signal);
  }
  if (projectInstructionOuterAuthority) {
    if (!options.projectInstructionProofReceipt) {
      throw new Error("Project instruction proof receipt is missing from the committed result");
    }
    await sendCommittedProjectInstructionOuterAuthority(
      options.projectInstructionProofReceipt,
      projectInstructionOuterAuthority,
    );
  }
}
