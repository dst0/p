import { spawnSync } from "node:child_process";
import { appendFileSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, relative } from "node:path";
import { replacePrivateBrotliText } from "../harness/private-brotli.ts";
import { sanitizeBenchmarkGitEnvironment } from "../harness/workspace-repository.ts";
import type { SemanticEventState, SemanticTool } from "./liveness-events.ts";
import { processSemanticLine } from "./liveness-events.ts";
import { createSemanticRecordingFollower } from "./run-recording-follower.ts";
export const CELL_HEARTBEAT_INTERVAL_MS = 50_000;
const CELL_OBSERVATION_INTERVAL_MS = 1_000;
const INTERNAL_PATH_PREFIXES = [".pdev/", ".pdev\\"];
export type CellLiveness = {
  heartbeatIntervalMs: number;
  heartbeatCount: number;
  firstMutationElapsedMs: number | null;
  requirementDefinitionAttemptCount: number | null;
  observedRequirementDefinitionAttemptCount: number;
  semanticSequence: number;
  mutationCount: number;
  semanticEvidenceAvailable: boolean;
  semanticEvidenceComplete: boolean;
  progressEvidence: string | null;
};
type SemanticCapture = {
  format?: string;
  archiveBytes?: number;
  archiveLimitBytes?: number;
  partial?: boolean;
  bytes?: number;
  limitBytes?: number;
  storageBytes?: number;
  storageLimitBytes?: number;
};
type CaptureOverflow = {
  kind?: string;
  captureName?: string;
  limitBytes?: number;
  observedBytesAtLeast?: number;
  limitCount?: number;
  observedCountAtLeast?: number;
  turn?: number;
};
type MonitorFinalizeOptions = {
  recordingCapture?: SemanticCapture;
  captureOverflow?: CaptureOverflow;
  captureMetadataValid?: boolean;
  requireSemanticEvidence?: boolean;
  outcome: "process_completed" | "interrupted" | string;
};
type MonitorOptions = {
  now?: () => number;
  progressPath: string;
  evidenceRoot?: string;
  inspectWorkspace?: () => number | undefined;
  workspace?: string;
  activeRecordingPath?: string;
  chunkDirectory?: string;
  finalRecordingPath?: string;
  manifestPath?: string;
  label?: string;
  schedule?: (callback: () => void, intervalMs: number) => unknown;
  cancel?: (timer: unknown) => void;
  observationIntervalMs?: number;
  heartbeatIntervalMs?: number;
};
type MonitorState = SemanticEventState & {
  now: () => number;
  startedAt: number;
  progressPath: string;
  progressEvidence: string;
  inspectWorkspace: () => number | undefined;
  phase: string;
  changedPathCount?: number;
  firstMutationElapsedMs?: number;
  heartbeatCount: number;
  semanticEventCount: number;
  mutationCount: number;
  requirementDefinitionAttemptCount: number;
  semanticEvidenceAvailable: boolean;
  semanticEvidenceComplete: boolean;
  finalized: boolean;
};

export function createUnavailableCellLiveness(): CellLiveness {
  return {
    heartbeatIntervalMs: CELL_HEARTBEAT_INTERVAL_MS,
    heartbeatCount: 0,
    firstMutationElapsedMs: null,
    requirementDefinitionAttemptCount: null,
    observedRequirementDefinitionAttemptCount: 0,
    semanticSequence: 0,
    mutationCount: 0,
    semanticEvidenceAvailable: false,
    semanticEvidenceComplete: false,
    progressEvidence: null,
  };
}
function changedWorkspacePathCount(workspace: string | undefined): number | undefined {
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
function progressRecord(state: MonitorState, event: string, extra: Record<string, unknown> = {}) {
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
    requirementDefinitionAttemptCount: state.semanticEvidenceComplete ? state.requirementDefinitionAttemptCount : null,
    observedRequirementDefinitionAttemptCount: state.requirementDefinitionAttemptCount,
    ...extra,
  };
}
function appendProgress(state: MonitorState, event: string, extra?: Record<string, unknown>): void {
  appendFileSync(state.progressPath, `${JSON.stringify(progressRecord(state, event, extra))}\n`, "utf8");
}
function semanticCaptureIsPartial(
  recordingCapture: SemanticCapture | undefined,
  captureOverflow: CaptureOverflow | undefined,
): boolean {
  if (recordingCapture?.partial === true) return true;
  return (
    captureOverflow?.kind === "capture_overflow" &&
    (["raw recording", "recording storage", "recording archive"].includes(captureOverflow.captureName ?? "") ||
      recordingCapture === undefined)
  );
}
export function createCellLivenessMonitor(options: MonitorOptions): {
  observe(): void;
  heartbeat(): void;
  finalize(finalOptions: MonitorFinalizeOptions): Promise<CellLiveness>;
} {
  const state: MonitorState = {
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
    seenToolEvents: new Set<string>(),
    activeTools: new Map<string, SemanticTool>(),
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
    } else if (typeof count === "number" && count > 0) {
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
  const schedule =
    options.schedule ?? ((callback: () => void, intervalMs: number) => setInterval(callback, intervalMs));
  const cancel = options.cancel ?? ((timer: unknown) => clearInterval(timer as ReturnType<typeof setInterval>));
  const observationTimer = schedule(observe, options.observationIntervalMs ?? CELL_OBSERVATION_INTERVAL_MS);
  const heartbeatTimer = schedule(heartbeat, options.heartbeatIntervalMs ?? CELL_HEARTBEAT_INTERVAL_MS);
  return {
    observe,
    heartbeat,
    async finalize(finalOptions: MonitorFinalizeOptions) {
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
      appendProgress(state, state.phase, {
        outcome: finalOptions.outcome,
        requirementDefinitionAttemptCount: definitionAttempts,
        observedRequirementDefinitionAttemptCount: state.requirementDefinitionAttemptCount,
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
        semanticSequence: state.semanticEventCount,
        mutationCount: state.mutationCount,
        semanticEvidenceAvailable: state.semanticEvidenceAvailable,
        semanticEvidenceComplete: state.semanticEvidenceComplete,
        progressEvidence: state.progressEvidence,
      };
    },
  };
}
