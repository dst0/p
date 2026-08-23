import { spawn, spawnSync } from "node:child_process";
import {
  appendFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { dirname, relative } from "node:path";
import { brotliCompressSync, constants as zlibConstants } from "node:zlib";
import { describeBenchmarkProjectInstructionAction } from "./benchmark-project-instruction-routing.js";
import { createSemanticRecordingFollower } from "./benchmark-project-instructions-recording-follower.js";
import { sanitizeBenchmarkGitEnvironment } from "./benchmark-workspace-repository.js";

export const CELL_HEARTBEAT_INTERVAL_MS = 50_000;
const CELL_OBSERVATION_INTERVAL_MS = 1_000;
const INTERNAL_PATH_PREFIXES = [".pdev/", ".pdev\\"];
export function createUnavailableCellLiveness() {
  return {
    heartbeatIntervalMs: CELL_HEARTBEAT_INTERVAL_MS,
    heartbeatCount: 0,
    firstMutationElapsedMs: null,
    requirementDefinitionAttemptCount: null,
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
    requirementDefinitionAttemptCount: state.semanticEvidenceAvailable
      ? state.requirementDefinitionAttemptCount
      : undefined,
    ...extra,
  };
}
function appendProgress(state, event, extra) {
  appendFileSync(state.progressPath, `${JSON.stringify(progressRecord(state, event, extra))}\n`, "utf8");
}

function semanticPhase(phases) {
  return ["delivery", "closure", "verification", "testing", "implementation", "discovery"].find((phase) =>
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
  if (event.type !== "tool_execution_start" || typeof event.toolName !== "string") return;
  const identity = event.toolCallId ?? event.benchmarkEventOrdinal;
  if (identity !== undefined) {
    const key = String(identity);
    if (state.seenToolEvents.has(key)) return;
    state.seenToolEvents.add(key);
  }
  state.semanticEventCount += 1;
  if (event.toolName === "record_requirement_audit" && event.args?.action === "define") {
    state.requirementDefinitionAttemptCount += 1;
  }
  const action = describeBenchmarkProjectInstructionAction(event.toolName, event.args, event.toolDescription);
  if (!action) return;
  state.mutationCount += 1;
  state.firstMutationElapsedMs ??= Math.max(0, state.now() - state.startedAt);
  state.phase = semanticPhase(action.phases) ?? "action";
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
    semanticEvidenceAvailable: false,
    semanticEvidenceComplete: false,
    seenToolEvents: new Set(),
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
      state.seenToolEvents.clear();
    },
  });
  mkdirSync(dirname(state.progressPath), { recursive: true });
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
      `[progress] ${options.label ?? "benchmark cell"}: ${state.phase}, ${Math.round((state.now() - state.startedAt) / 1000)}s elapsed, ${state.mutationCount} potentially-mutating starts, ${definitionAttempts} definition attempts, ${state.semanticEventCount} semantic events`,
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
      state.phase = finalOptions.outcome === "process_completed" && !requiredEvidenceFailed ? "completed" : "failed";
      const definitionAttempts = state.semanticEvidenceComplete
        ? state.requirementDefinitionAttemptCount
        : (finalOptions.requirementDefinitionAttemptCount ?? null);
      appendProgress(state, state.phase, {
        outcome: finalOptions.outcome,
        requirementDefinitionAttemptCount: definitionAttempts,
      });
      const compressedPath = `${state.progressPath}.br`;
      writeFileSync(
        compressedPath,
        brotliCompressSync(readFileSync(state.progressPath), {
          params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 },
        }),
      );
      rmSync(state.progressPath);
      state.finalized = true;
      return {
        ...createUnavailableCellLiveness(),
        heartbeatIntervalMs: options.heartbeatIntervalMs ?? CELL_HEARTBEAT_INTERVAL_MS,
        heartbeatCount: state.heartbeatCount,
        firstMutationElapsedMs: state.firstMutationElapsedMs ?? null,
        requirementDefinitionAttemptCount: definitionAttempts,
        semanticSequence: state.semanticEventCount,
        mutationCount: state.mutationCount,
        semanticEvidenceAvailable: state.semanticEvidenceAvailable,
        semanticEvidenceComplete: state.semanticEvidenceComplete,
        progressEvidence: state.progressEvidence,
      };
    },
  };
}

export function runBenchmarkChild(executable, args, options) {
  return new Promise((resolveResult) => {
    let settled = false;
    const settle = (result) => {
      if (settled) return;
      settled = true;
      resolveResult(result);
    };
    const child = spawn(executable, args, options);
    child.once("error", (error) => settle({ status: undefined, signal: undefined, error }));
    child.once("close", (status, signal) => settle({ status, signal, error: undefined }));
  });
}
