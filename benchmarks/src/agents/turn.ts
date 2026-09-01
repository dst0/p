import type { ChildProcess, ChildProcessWithoutNullStreams } from "node:child_process";
import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import type { Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";
import {
  attachBenchmarkCleanupError,
  type BenchmarkInterruptedError,
  benchmarkInterruptionFromSignal,
} from "../harness/interruption.ts";
import type { BenchmarkOutputLimits } from "../harness/output-capture.ts";
import {
  captureOverflowEvidence,
  createBoundedTextCapture,
  resolveBenchmarkOutputLimits,
} from "../harness/output-capture.ts";
import { benchmarkProcessGroupOptions, terminateBenchmarkProcessTree } from "../harness/process-control.ts";
import { sanitizeBenchmarkGitEnvironment } from "../harness/workspace-repository.ts";
import { createProjectInstructionProofIpcCapture } from "../project-instructions/proof-ipc.ts";
import { type BenchmarkEventCapture, createBenchmarkEventCapture } from "../project-instructions/stream.ts";
import { createBenchmarkJsonlLineCapture } from "./jsonl-line-capture.ts";
import {
  type BenchmarkTerminationReason,
  type BenchmarkTimeoutKind,
  type BenchmarkTimeoutMode,
  BenchmarkTurnTimeoutController,
} from "./turn-timeout.ts";

export type { BenchmarkTimeoutKind } from "./turn-timeout.ts";

interface BenchmarkTurnCommand {
  executable: string;
  args: readonly string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
}

interface BenchmarkRecording {
  stream: Writable;
  capture: BenchmarkRecordingCapture;
  onFailure(handler: (error: unknown) => void): () => void;
}

export interface BenchmarkRecordingCapture {
  format: string;
  archiveBytes: number;
  archiveLimitBytes: number;
  bytes: number;
  limitBytes: number;
  partial: boolean;
  storageBytes: number;
  storageLimitBytes: number;
}
interface BenchmarkProofCapture {
  accept(message: unknown): void;
  finish(): Record<string, unknown> | undefined;
}

export interface BenchmarkTurnOptions {
  allowCanonicalPAgentEnd?: boolean;
  outputLimits?: Partial<BenchmarkOutputLimits>;
  projectInstructionProofReceipt?: string;
  collectRawStdout?: boolean;
  eventOrdinalBase?: number;
  stopOnMarker?: string;
  terminateProcessTree?: (child: ChildProcess, graceMs: number) => Promise<boolean>;
  interruptionKillGraceMs?: number;
  failureKillGraceMs?: number;
  hardTimeoutMs?: number;
  maxMetricEvents?: number;
  onMetricEvent?: (event: Record<string, unknown>) => void;
  progressEventTypes?: ReadonlySet<string>;
  progressGraceMs?: number;
  retainMetricOutput?: boolean;
  signal?: AbortSignal;
  timeoutMode?: BenchmarkTimeoutMode;
  turn?: number;
}
export interface BenchmarkAgentTurnResult {
  stdout: string;
  stderr: string;
  code: number | null;
  signal: NodeJS.Signals | null;
  error: string | undefined;
  captureOverflow: ReturnType<typeof captureOverflowEvidence>;
  timedOut: boolean;
  timeoutKind: BenchmarkTimeoutKind | undefined;
  rawEventCount: number;
  metricEventCount: number;
  runtimeContexts: unknown[];
  userTurns: unknown[];
  rawStdout: string | undefined;
  recordingCapture: BenchmarkRecordingCapture;
  projectInstructionProof: Record<string, unknown> | undefined;
  elapsedMs: number;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function runBenchmarkAgentTurn(
  command: BenchmarkTurnCommand,
  timeoutMs: number,
  recording: BenchmarkRecording,
  metricEventTypes: ReadonlySet<string>,
  options: BenchmarkTurnOptions = {},
): Promise<BenchmarkAgentTurnResult> {
  if (options.retainMetricOutput === false && !options.onMetricEvent) {
    throw new Error("non-retained metric output requires an event observer");
  }
  return new Promise((resolveResult, rejectResult) => {
    const limits = resolveBenchmarkOutputLimits(options.outputLimits);
    const startedAt = performance.now();
    const proofCapture: BenchmarkProofCapture | undefined = options.projectInstructionProofReceipt
      ? (createProjectInstructionProofIpcCapture(options.projectInstructionProofReceipt) as BenchmarkProofCapture)
      : undefined;
    const stdio: ["ignore", "pipe", "pipe"] | ["ignore", "pipe", "pipe", "ipc"] = proofCapture
      ? ["ignore", "pipe", "pipe", "ipc"]
      : ["ignore", "pipe", "pipe"];
    const child = spawn(
      command.executable,
      [...command.args],
      benchmarkProcessGroupOptions({
        cwd: command.cwd,
        env: sanitizeBenchmarkGitEnvironment(command.env),
        stdio,
      }),
    ) as ChildProcessWithoutNullStreams;
    if (proofCapture) child.on("message", (message) => proofCapture.accept(message));
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const rawStdout = options.collectRawStdout
      ? createBoundedTextCapture("raw stdout", limits.maxRawStdoutBytes)
      : undefined;
    const stderr = createBoundedTextCapture("stderr", limits.maxStderrBytes);
    const eventCapture = createBenchmarkEventCapture(new Set(metricEventTypes), options.eventOrdinalBase, {
      maxMetricBytes: limits.maxMetricBytes,
      maxMetricEvents: options.maxMetricEvents ?? limits.maxMetricEvents,
      maxRuntimeContexts: limits.maxRuntimeContexts,
      onMetricEvent: options.onMetricEvent,
      progressEventTypes: options.progressEventTypes,
      retainMetricOutput: options.retainMetricOutput,
      stopMarker: options.stopOnMarker,
    }) as BenchmarkEventCapture;
    let failure: string | undefined;
    let timedOut = false;
    let timeoutKind: BenchmarkTimeoutKind | undefined;
    let stoppedByMarker = false;
    let childError: string | undefined;
    let terminationPromise: Promise<boolean | { terminationError: unknown }> | undefined;
    let captureOverflow: ReturnType<typeof captureOverflowEvidence>;
    let interruption: BenchmarkInterruptedError | undefined;
    let failedCleanupTimer: ReturnType<typeof setTimeout> | undefined;
    let settled = false;
    let terminationReason: BenchmarkTerminationReason | undefined;
    let timeoutController: BenchmarkTurnTimeoutController | undefined;
    const terminateTree = options.terminateProcessTree ?? terminateBenchmarkProcessTree;

    const terminate = (error: unknown, reason: BenchmarkTerminationReason): void => {
      if (terminationReason) return;
      terminationReason = reason;
      timeoutController?.stop();
      if (error) {
        failure = errorMessage(error);
        captureOverflow = captureOverflowEvidence(error, options.turn);
      }
      if (reason === "hard_deadline" || reason === "inactivity" || reason === "wall_clock") {
        timedOut = true;
        timeoutKind = reason;
      }
      if (reason === "marker") stoppedByMarker = true;
      const killGraceMs =
        reason === "interruption"
          ? (options.interruptionKillGraceMs ?? options.failureKillGraceMs ?? 5_000)
          : error
            ? (options.failureKillGraceMs ?? 250)
            : 5_000;
      terminationPromise = Promise.resolve()
        .then(() => terminateTree(child, killGraceMs))
        .catch((terminationError) => ({ terminationError }));
      void terminationPromise.then((termination) => {
        if (termination === true) return;
        child.stdout.unpipe(recording.stream);
        child.stdout.destroy();
        child.stderr.destroy();
        if (child.connected) child.disconnect();
        child.unref();
        failedCleanupTimer = setTimeout(() => {
          void settleResult(child.exitCode, child.signalCode);
        }, 100);
      });
    };
    const interrupt = () => {
      interruption ??= benchmarkInterruptionFromSignal(options.signal);
      terminate(undefined, "interruption");
    };
    const timeoutMode = options.timeoutMode ?? "wall_clock";
    const progressGraceMs = options.progressGraceMs ?? Math.min(timeoutMs, 300_000);
    timeoutController = new BenchmarkTurnTimeoutController({
      hardTimeoutMs: options.hardTimeoutMs,
      onTimeout: (kind) => terminate(undefined, kind),
      progressGraceMs,
      startedAt,
      timeoutMode,
      timeoutMs,
    });
    child.once("exit", () => timeoutController?.stop());
    const removeFailureHandler = recording.onFailure((error) => terminate(error, "recording"));

    const processText = (text: string): void => {
      if (failure || stoppedByMarker) return;
      rawStdout?.append(text);
      stdoutLines.append(text);
    };

    const stdoutLines = createBenchmarkJsonlLineCapture({
      allowCanonicalPAgentEnd: options.allowCanonicalPAgentEnd,
      maxLineBytes: limits.maxLineBytes,
      onLine: (line) => {
        if (eventCapture.process(line)) timeoutController?.renewSemanticProgress();
        if (eventCapture.stopMarkerSeen) terminate(undefined, "marker");
      },
      onOversizedNonMetricLine: () => eventCapture.skipNonMetricLine(),
    });

    child.stdout.pipe(recording.stream, { end: false });
    child.stdout.on("data", (chunk) => {
      try {
        processText(stdoutDecoder.write(chunk));
      } catch (error) {
        terminate(error, "capture");
      }
    });
    child.stderr.on("data", (chunk) => {
      if (failure) return;
      try {
        stderr.append(stderrDecoder.write(chunk));
      } catch (error) {
        terminate(error, "capture");
      }
    });
    child.once("error", (error) => {
      childError = errorMessage(error);
    });
    async function settleResult(code: number | null, signal: NodeJS.Signals | null): Promise<void> {
      if (settled) return;
      settled = true;
      if (failedCleanupTimer) clearTimeout(failedCleanupTimer);
      child.stdout.unpipe(recording.stream);
      timeoutController?.stop();
      const termination = terminationPromise ? await terminationPromise : true;
      if (failedCleanupTimer) clearTimeout(failedCleanupTimer);
      const terminationError = typeof termination === "object" ? termination.terminationError : undefined;
      const treeStopped = typeof termination === "boolean" ? termination : false;
      const cleanupError =
        terminationError ??
        (terminationPromise && !treeStopped ? new Error("benchmark process tree did not terminate") : undefined);
      removeFailureHandler();
      options.signal?.removeEventListener("abort", interrupt);
      if (cleanupError && interruption) attachBenchmarkCleanupError(interruption, cleanupError);
      if (interruption) {
        rejectResult(interruption);
        return;
      }
      if (cleanupError) {
        rejectResult(cleanupError);
        return;
      }
      try {
        if (!failure && !stoppedByMarker) stdoutLines.finish(stdoutDecoder.end());
        if (!failure) stderr.append(stderrDecoder.end());
      } catch (error) {
        failure ??= errorMessage(error);
        captureOverflow ??= captureOverflowEvidence(error, options.turn);
      }
      resolveResult({
        stdout: eventCapture.metricOutput,
        stderr: stderr.value(),
        code: stoppedByMarker ? 0 : code,
        signal: stoppedByMarker ? null : signal,
        error: failure ?? childError,
        captureOverflow,
        timedOut,
        timeoutKind,
        rawEventCount: eventCapture.rawEventCount,
        metricEventCount: eventCapture.metricEventCount,
        runtimeContexts: eventCapture.runtimeContexts,
        userTurns: eventCapture.userTurns,
        rawStdout: rawStdout?.value(),
        recordingCapture: recording.capture,
        projectInstructionProof: proofCapture?.finish(),
        elapsedMs: performance.now() - startedAt,
      });
    }
    child.once("close", (code, signal) => void settleResult(code, signal));
    options.signal?.addEventListener("abort", interrupt, { once: true });
    if (options.signal?.aborted) interrupt();
  });
}
