import { spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative } from "node:path";
import { replacePrivateBrotliText } from "./benchmark-private-brotli.js";
import {
  describeBenchmarkProjectInstructionAction,
  inferBenchmarkProjectInstructionActionPhases,
} from "./benchmark-project-instruction-routing.js";
import { createSemanticRecordingFollower } from "./benchmark-project-instructions-recording-follower.js";
import { sanitizeBenchmarkGitEnvironment } from "./benchmark-workspace-repository.js";
export { runBenchmarkChild } from "./benchmark-project-instructions-child-process.js";
export const CELL_HEARTBEAT_INTERVAL_MS = 50_000;
const CELL_OBSERVATION_INTERVAL_MS = 1_000;
const INTERNAL_PATH_PREFIXES = [".pdev/", ".pdev\\"];
export function createUnavailableCellLiveness() {
  return {
    heartbeatIntervalMs: CELL_HEARTBEAT_INTERVAL_MS,
    heartbeatCount: 0,
    firstMutationElapsedMs: null,
    requirementDefinitionAttemptCount: null,
    observedRequirementDefinitionAttemptCount: 0,
    requirementDefinitionRepairAttemptCount: null,
    observedRequirementDefinitionRepairAttemptCount: 0,
    semanticSequence: 0,
    mutationCount: 0,
    semanticEvidenceAvailable: false,
    semanticEvidenceComplete: false,
    progressEvidence: null,
  };
}
function changedWorkspacePathCount(workspace) {
  if (typeof workspace !== "string" || !existsSync(workspace)) return undefined;
  const result = spawnSync("git", ["status", "--porcelain=v1", "-z", "--untracked-files=all"], {
    cwd: workspace,
    encoding: "utf8",
    env: sanitizeBenchmarkGitEnvironment(process.env),
    stdio: ["ignore", "pipe", "ignore"],
    timeout: 5_000,
  });
  if (result.status !== 0) return undefined;
  return result.stdout
    .split("\0")
    .filter(Boolean)
    .map((entry) => entry.slice(3))
    .filter((path) => !INTERNAL_PATH_PREFIXES.some((prefix) => path.startsWith(prefix))).length;
}
function progressRecord(state, event, extra = {}) {
  return {
    schemaVersion: 1,
    event,
    elapsedMs: Math.max(0, state.now() - state.startedAt),
    phase: state.phase,
    mutationObserved: state.firstMutationElapsedMs !== undefined,
    firstMutationElapsedMs: state.firstMutationElapsedMs,
    changedPathCount: state.changedPathCount,
    semanticEventCount: state.semanticEventCount,
    mutationCount: state.mutationCount,
    semanticEvidenceAvailable: state.semanticEvidenceAvailable,
    semanticEvidenceComplete: state.semanticEvidenceComplete,
    requirementDefinitionAttemptCount: state.semanticEvidenceComplete
      ? state.requirementDefinitionAttemptCount
      : null,
    observedRequirementDefinitionAttemptCount: state.requirementDefinitionAttemptCount,
    requirementDefinitionRepairAttemptCount: state.semanticEvidenceComplete
      ? state.requirementDefinitionRepairAttemptCount
      : null,
    observedRequirementDefinitionRepairAttemptCount: state.requirementDefinitionRepairAttemptCount,
    ...extra,
  };
}
function appendProgress(state, event, extra) {
  appendFileSync(state.progressPath, `${JSON.stringify(progressRecord(state, event, extra))}\n`, "utf8");
}
function semanticPhase(phases) {
  return ["delivery", "closure", "verification", "testing", "implementation", "planning", "discovery", "intake"].find((phase) =>
    phases.includes(phase),
  );
}
function processSemanticLine(state, line) {
  let event;
  try {
    event = JSON.parse(line);
  } catch {
    return;
  }
  if (event.type === "tool_execution_end") {
    const key = String(event.toolCallId ?? event.benchmarkEventOrdinal ?? "");
    const completed = state.activeTools.get(key);
    if (!completed) return;
    state.activeTools.delete(key);
    state.phase = [...state.activeTools.values()].at(-1)?.phase ?? completed.settledPhase;
    return;
  }
  if (event.type !== "tool_execution_start" || typeof event.toolName !== "string") return;
  const identity = event.toolCallId ?? event.benchmarkEventOrdinal;
  const key = String(identity ?? `anonymous-${state.semanticEventCount}`);
  if (identity !== undefined) {
    if (state.seenToolEvents.has(key)) return;
    state.seenToolEvents.add(key);
  }
  state.semanticEventCount += 1;
  if (event.toolName === "record_requirement_audit") {
    const defining = event.args?.action === "define";
    const repairing = event.args?.action === "repair_definition";
    if (defining) state.requirementDefinitionAttemptCount += 1;
    if (repairing) state.requirementDefinitionRepairAttemptCount += 1;
    const phase = defining || repairing ? "requirement_definition" : "verification";
    state.activeTools.set(key, { phase, settledPhase: defining || repairing ? "planning" : "idle" });
    state.phase = phase;
    return;
  }
  const action = describeBenchmarkProjectInstructionAction(event.toolName, event.args, event.toolDescription);
  if (!action) {
    const phase = semanticPhase(
      inferBenchmarkProjectInstructionActionPhases(event.toolName, event.args, event.toolDescription),
    );
    state.activeTools.set(key, { phase: phase ?? "action", settledPhase: "idle" });
    if (phase) state.phase = phase;
    return;
  }
  state.mutationCount += 1;
  state.firstMutationElapsedMs ??= Math.max(0, state.now() - state.startedAt);
  state.phase = semanticPhase(action.phases) ?? "action";
  state.activeTools.set(key, { phase: state.phase, settledPhase: "idle" });
}
function semanticCaptureIsPartial(recordingCapture, captureOverflow) {
  if (recordingCapture?.partial === true) return true;
  return (
    captureOverflow?.kind === "capture_overflow" &&
    (["raw recording", "recording storage", "recording archive"].includes(captureOverflow.captureName) ||
      recordingCapture === undefined)
  );
}
export function createCellLivenessMonitor(options) {
  const state = {
    now: options.now ?? Date.now,
    startedAt: (options.now ?? Date.now)(),
    progressPath: options.progressPath,
    progressEvidence: `${relative(options.evidenceRoot ?? dirname(options.progressPath), options.progressPath)}.br`,
    inspectWorkspace: options.inspectWorkspace ?? (() => changedWorkspacePathCount(options.workspace)),
    phase: "starting",
    changedPathCount: undefined,
    firstMutationElapsedMs: undefined,
    heartbeatCount: 0,
    semanticEventCount: 0,
    mutationCount: 0,
    requirementDefinitionAttemptCount: 0,
    requirementDefinitionRepairAttemptCount: 0,
    semanticEvidenceAvailable: false,
    semanticEvidenceComplete: false,
    seenToolEvents: new Set(),
    activeTools: new Map(),
    finalized: false,
  };
  const hasSemanticRecording = Boolean(
    options.activeRecordingPath || options.chunkDirectory || options.finalRecordingPath,
  );
  const recordingFollower = createSemanticRecordingFollower({
    activeRecordingPath: options.activeRecordingPath,
    chunkDirectory: options.chunkDirectory,
    finalRecordingPath: options.finalRecordingPath,
    manifestPath: options.manifestPath,
    processLine: (line) => processSemanticLine(state, line),
    resetSemanticState() {
      state.semanticEventCount = 0;
      state.mutationCount = 0;
      state.requirementDefinitionAttemptCount = 0;
      state.requirementDefinitionRepairAttemptCount = 0;
      state.seenToolEvents.clear();
      state.activeTools.clear();
    },
  });
  mkdirSync(dirname(state.progressPath), { recursive: true });
  writeFileSync(state.progressPath, "", { encoding: "utf8", flag: "wx", mode: 0o600 });
  appendProgress(state, "started");
  const observe = () => {
    const observation = recordingFollower.observe();
    state.semanticEvidenceAvailable = observation.available;
    const count = hasSemanticRecording ? undefined : state.inspectWorkspace();
    if (count !== undefined) state.changedPathCount = count;
    if (hasSemanticRecording) {
      if (state.semanticEvidenceAvailable && state.phase === "starting") state.phase = "discovery";
    } else if (count > 0) {
      state.phase = "implementation";
      state.firstMutationElapsedMs ??= Math.max(0, state.now() - state.startedAt);
    } else if (count === 0 && state.phase === "starting") {
      state.phase = "discovery";
    }
  };
  const heartbeat = () => {
    observe();
    state.heartbeatCount += 1;
    appendProgress(state, "heartbeat");
    const definitionAttempts = state.semanticEvidenceAvailable ? state.requirementDefinitionAttemptCount : "n/a";
    console.log(
      `[progress] ${options.label ?? "benchmark cell"}: ${state.phase}, ${Math.round((state.now() - state.startedAt) / 1000)}s elapsed, ${state.mutationCount} potentially-mutating starts, ${definitionAttempts} full definitions, ${state.requirementDefinitionRepairAttemptCount} repairs, ${state.semanticEventCount} semantic events`,
    );
  };
  const schedule = options.schedule ?? setInterval;
  const cancel = options.cancel ?? clearInterval;
  const observationTimer = schedule(observe, options.observationIntervalMs ?? CELL_OBSERVATION_INTERVAL_MS);
  const heartbeatTimer = schedule(heartbeat, options.heartbeatIntervalMs ?? CELL_HEARTBEAT_INTERVAL_MS);
  return {
    observe,
    heartbeat,
    async finalize(finalOptions) {
      if (state.finalized) throw new Error("cell liveness monitor was already finalized");
      cancel(observationTimer);
      cancel(heartbeatTimer);
      observe();
      try {
        const finalEvidence = await recordingFollower.finalize(finalOptions);
        state.semanticEvidenceAvailable = finalEvidence.available;
        state.semanticEvidenceComplete = finalEvidence.complete;
      } catch {
        state.semanticEvidenceComplete = false;
      }
      if (
        semanticCaptureIsPartial(finalOptions.recordingCapture, finalOptions.captureOverflow) ||
        (state.semanticEvidenceAvailable && finalOptions.captureMetadataValid !== true)
      ) {
        state.semanticEvidenceComplete = false;
      }
      const requiredEvidenceFailed =
        finalOptions.requireSemanticEvidence === true &&
        (!state.semanticEvidenceAvailable || !state.semanticEvidenceComplete);
      state.phase =
        finalOptions.outcome === "process_completed" && !requiredEvidenceFailed
          ? "completed"
          : finalOptions.outcome === "interrupted"
            ? "interrupted"
            : "failed";
      const definitionAttempts = state.semanticEvidenceComplete ? state.requirementDefinitionAttemptCount : null;
      const repairAttempts = state.semanticEvidenceComplete ? state.requirementDefinitionRepairAttemptCount : null;
      appendProgress(state, state.phase, {
        outcome: finalOptions.outcome,
        requirementDefinitionAttemptCount: definitionAttempts,
        observedRequirementDefinitionAttemptCount: state.requirementDefinitionAttemptCount,
        requirementDefinitionRepairAttemptCount: repairAttempts,
        observedRequirementDefinitionRepairAttemptCount: state.requirementDefinitionRepairAttemptCount,
      });
      const compressedPath = `${state.progressPath}.br`;
      replacePrivateBrotliText(compressedPath, readFileSync(state.progressPath, "utf8"));
      rmSync(state.progressPath);
      state.finalized = true;
      return {
        ...createUnavailableCellLiveness(),
        heartbeatIntervalMs: options.heartbeatIntervalMs ?? CELL_HEARTBEAT_INTERVAL_MS,
        heartbeatCount: state.heartbeatCount,
        firstMutationElapsedMs: state.firstMutationElapsedMs ?? null,
        requirementDefinitionAttemptCount: definitionAttempts,
        observedRequirementDefinitionAttemptCount: state.requirementDefinitionAttemptCount,
        requirementDefinitionRepairAttemptCount: repairAttempts,
        observedRequirementDefinitionRepairAttemptCount: state.requirementDefinitionRepairAttemptCount,
        semanticSequence: state.semanticEventCount,
        mutationCount: state.mutationCount,
        semanticEvidenceAvailable: state.semanticEvidenceAvailable,
        semanticEvidenceComplete: state.semanticEvidenceComplete,
        progressEvidence: state.progressEvidence,
      };
    },
  };
}
