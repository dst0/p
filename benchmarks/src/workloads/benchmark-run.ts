import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { augmentBenchmarkPath } from "../agents/environment.ts";
import { type BenchmarkAgentDirectories, createBenchmarkAgentDirectories } from "../agents/private-directories.ts";
import { finalizeBenchmarkAgentResources } from "../agents/resources-finalization.ts";
import { createBenchmarkAuthOutputGuard } from "../harness/auth-output-guard.ts";
import { consumeBenchmarkAuthSource } from "../harness/auth-source.ts";
import { assertCertifiedOutputWritePath } from "../harness/certified-output-integrity.ts";
import { verifyBenchmarkEvaluationSnapshot } from "../harness/evaluation-freeze.ts";
import { modelAliasForAgent } from "../harness/model-attribution.ts";
import type { BenchmarkResult } from "../harness/report.ts";
import { writeBenchmarkStderrLog } from "../harness/stderr-log.ts";
import { createBenchmarkWorkspace } from "../harness/workspace-repository.ts";
import { captureRecordedProjectInstructionEvidence } from "../project-instructions/evidence.ts";
import { sendCommittedProjectInstructionOuterAuthority } from "../project-instructions/outer-authority.ts";
import { nudgePenaltyPerNudge, runAgentTask } from "./agent-turn-runner.ts";
import { publishBenchmarkEvidence } from "./benchmark-evidence-publication.ts";
import { createBenchmarkOutputPath } from "./benchmark-output.ts";
import { finalizeAgentBenchmarkRun, isBenchmarkMutableArtifactsUnsafeError } from "./benchmark-run-finalization.ts";
import { validateBenchmarkRuntimeInputs } from "./benchmark-runtime-validation.ts";
import {
  planRunCells,
  runCertifiedPreflights,
  setupCertifiedBenchmark,
  verifyWorkspaceInstructions,
} from "./certification.ts";
import { createCertifiedTaskVariants } from "./certification-holdout.ts";
import { sanitizeCertifiedReceiptArtifacts } from "./certification-receipt-cleanup.ts";
import { resolveAgentVersions } from "./installed-agent-versions.ts";
import { parseRecording } from "./recording-metrics.ts";
import { parseRunnerArgs, printRunnerHelp, repoRoot } from "./runner-options.ts";
import {
  type AgyStartupEvidence,
  type KiloStartupEvidence,
  runAgyStartupProbe,
  runKiloStartupProbe,
} from "./startup-probes.ts";
import { benchmarkTasks, createTaskBaseline } from "./task-registry.ts";

const defaultAuthFile = consumeBenchmarkAuthSource();
process.env.PATH = augmentBenchmarkPath(repoRoot);
type BenchmarkResultRow = BenchmarkResult & Record<string, unknown>;
const ensureDirectory = (path: string) => {
  assertCertifiedOutputWritePath(path);
  mkdirSync(path, { recursive: true });
};
const cleanupGeneratedWorkspaceState = (ws: string) => {
  assertCertifiedOutputWritePath(join(ws, ".pdev"));
  rmSync(join(ws, ".pdev"), { recursive: true, force: true });
};
const formatMilliseconds = (v: number) => `${Math.round(v)} ms`;
const formatNumber = (v: number) => Math.round(v).toLocaleString("en-US");
export async function runAgentBenchmark(signal: AbortSignal): Promise<void> {
  const options = Object.assign(parseRunnerArgs(process.argv.slice(2)), { signal });
  if (options.help) {
    printRunnerHelp();
    return;
  }
  validateBenchmarkRuntimeInputs(options);
  const versions = resolveAgentVersions(options);
  const requestedTasks = options.task ? benchmarkTasks.filter((task) => task.id === options.task) : benchmarkTasks;
  if (requestedTasks.length === 0) throw new Error(`Unknown task: ${options.task}`);
  const output = createBenchmarkOutputPath(options);
  for (const dir of ["", "recordings", "stderr"]) ensureDirectory(join(output, dir));
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
  let mutableArtifactsSafe = true;
  let primaryError: unknown;
  let publishReleaseEvidence: (() => void) | undefined;
  let projectInstructionOuterAuthority: Parameters<typeof sendCommittedProjectInstructionOuterAuthority>[1] | undefined;
  let validateReleaseEvidence: (() => void) | undefined;
  const {
    freeze: evaluationFreeze,
    binding: harnessBinding,
    holdout,
    receiptValue,
  } = setupCertifiedBenchmark(options, versions, repoRoot, output);
  const selectedTasks =
    options.certified && harnessBinding && holdout
      ? createCertifiedTaskVariants(requestedTasks, holdout)
      : requestedTasks;
  try {
    agentDirs = createBenchmarkAgentDirectories({
      ...options,
      authFile: defaultAuthFile,
    });
    for (const a of ["pi", "p"] as const) authOutputGuard.capture(join(agentDirs.dirs[a], "auth.json"));
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
    if (options.certified && harnessBinding && receiptValue && agentDirs) {
      harnessBinding.receipts = await runCertifiedPreflights(
        options,
        agentDirs.dirs,
        output,
        deadline,
        receiptValue,
        harnessBinding,
      );
    }
    for (let run = 1; run <= options.runs; run += 1) {
      for (const { agent, task } of planRunCells(options.agents, selectedTasks, run, options.certified)) {
        if (deadline - performance.now() <= 0) {
          results.push({ run, agent, task: task.id, status: "skipped" });
          console.log(`[run ${run}] ${agent}/${task.id}: skipped (overall deadline reached)`);
          continue;
        }
        const workspace = createBenchmarkWorkspace(output, agent, run, task, options);
        if (options.certified && harnessBinding) {
          verifyWorkspaceInstructions(workspace, harnessBinding.projectInstructions.sha256);
        }
        const baseline = createTaskBaseline(task);
        const taskTimeout = Math.max(task.timeoutSeconds ?? options.timeoutSeconds, options.minimumTimeoutSeconds ?? 0);
        const recordingName = `${agent}-run-${run}-${task.id}.jsonl.br`;
        const stderrStem = `${agent}-run-${run}-${task.id}`;
        let result: Awaited<ReturnType<typeof runAgentTask>>;
        try {
          result = await runAgentTask(
            agent,
            options,
            task,
            agentDirs.dirs[agent],
            workspace,
            join(output, "recordings", recordingName),
            taskTimeout,
            deadline,
          );
        } catch (error) {
          if (isBenchmarkMutableArtifactsUnsafeError(error)) mutableArtifactsSafe = false;
          throw error;
        }
        if (options.certified && harnessBinding) {
          verifyWorkspaceInstructions(workspace, harnessBinding.projectInstructions.sha256);
        }
        const stderrName = writeBenchmarkStderrLog(join(output, "stderr"), stderrStem, result.stderr);
        const metrics = result.metrics ?? parseRecording(result.stdout, agent);
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
        if (evaluationFreeze && !verifyBenchmarkEvaluationSnapshot(evaluationFreeze.evaluator)) {
          throw new Error("Benchmark evaluator snapshot integrity compromised during execution");
        }
        const quality = await task.verify(
          workspace,
          baseline,
          metrics.finalText,
          evaluationFreeze
            ? {
                evaluatorFixturesRoot: join(evaluationFreeze.evaluator.path, "benchmarks", "fixtures"),
                evaluator: evaluationFreeze.evaluator,
              }
            : undefined,
        );
        const penalty = result.nudges * nudgePenaltyPerNudge;
        Object.assign(quality, {
          rawScore: quality.score,
          penalty,
          score: Math.max(0, quality.score - penalty),
          nudges: result.nudges,
          finishNotesCreated: existsSync(join(workspace, "finish_notes.md")),
        });
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
          timeoutKind: result.timeoutKind,
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
    const publication = publishBenchmarkEvidence({
      options,
      versions,
      results,
      output,
      repoRoot,
      tasks: selectedTasks,
      startupProbes,
      evaluationFreeze,
      harnessBinding,
    });
    projectInstructionOuterAuthority = publication.projectInstructionOuterAuthority;
    publishReleaseEvidence = publication.publishReleaseEvidence;
    validateReleaseEvidence = publication.validateReleaseEvidence;
    console.log(`Report: ${publication.reportPath}`);
    if (publication.shouldFail) process.exitCode = 1;
  } catch (error) {
    primaryError = error;
    if (isBenchmarkMutableArtifactsUnsafeError(error)) mutableArtifactsSafe = false;
    throw error;
  } finally {
    finalizeAgentBenchmarkRun({
      primaryError,
      mutableArtifactsSafe,
      finalizeAgentResources: () => finalizeBenchmarkAgentResources(agentDirs, authOutputGuard, output, options.signal),
      sanitizeReceipt: (safe) => {
        if (receiptValue) sanitizeCertifiedReceiptArtifacts(output, receiptValue, { mutableArtifactsSafe: safe });
      },
      validateReleaseEvidence,
      disposeFreeze: () => evaluationFreeze?.dispose(),
      publishReleaseEvidence,
    });
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
