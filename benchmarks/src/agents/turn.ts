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
  BenchmarkOutputOverflowError,
  captureOverflowEvidence,
  createBoundedTextCapture,
  resolveBenchmarkOutputLimits,
} from "../harness/output-capture.ts";
import { benchmarkProcessGroupOptions, terminateBenchmarkProcessTree } from "../harness/process-control.ts";
import { sanitizeBenchmarkGitEnvironment } from "../harness/workspace-repository.ts";
import { createProjectInstructionProofIpcCapture } from "../project-instructions/proof-ipc.ts";
import { createBenchmarkEventCapture } from "../project-instructions/stream.ts";

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

interface BenchmarkEventCapture {
  process(text: string): void;
  readonly metricOutput: string;
  readonly metricEventCount: number;
  readonly rawEventCount: number;
  readonly runtimeContexts: unknown[];
  readonly stopMarkerSeen: boolean;
  readonly userTurns: unknown[];
}

interface BenchmarkProofCapture {
  accept(message: unknown): void;
  finish(): Record<string, unknown> | undefined;
}

export interface BenchmarkTurnOptions {
  outputLimits?: Partial<BenchmarkOutputLimits>;
  projectInstructionProofReceipt?: string;
  collectRawStdout?: boolean;
  eventOrdinalBase?: number;
  stopOnMarker?: string;
  terminateProcessTree?: (child: ChildProcess, graceMs: number) => Promise<boolean>;
  interruptionKillGraceMs?: number;
  failureKillGraceMs?: number;
  signal?: AbortSignal;
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
      maxMetricEvents: limits.maxMetricEvents,
      maxRuntimeContexts: limits.maxRuntimeContexts,
      stopMarker: options.stopOnMarker,
    }) as BenchmarkEventCapture;
    let stdoutBuffer = "";
    let failure: string | undefined;
    let timedOut = false;
    let stoppedByMarker = false;
    let childError: string | undefined;
    let terminationPromise: Promise<boolean | { terminationError: unknown }> | undefined;
    let captureOverflow: ReturnType<typeof captureOverflowEvidence>;
    let interruption: BenchmarkInterruptedError | undefined;
    const terminateTree = options.terminateProcessTree ?? terminateBenchmarkProcessTree;

    const terminate = (
      error: unknown,
      reason: "timeout" | "marker" | "interruption" | "recording" | "capture",
    ): void => {
      if (error) {
        failure ??= errorMessage(error);
        captureOverflow ??= captureOverflowEvidence(error, options.turn);
      }
      if (reason === "timeout") timedOut = true;
      if (reason === "marker") stoppedByMarker = true;
      const killGraceMs =
        reason === "interruption"
          ? (options.interruptionKillGraceMs ?? options.failureKillGraceMs ?? 5_000)
          : error
            ? (options.failureKillGraceMs ?? 250)
            : 5_000;
      terminationPromise ??= Promise.resolve()
        .then(() => terminateTree(child, killGraceMs))
        .catch((terminationError) => ({ terminationError }));
    };
    const interrupt = () => {
      interruption ??= benchmarkInterruptionFromSignal(options.signal);
      terminate(undefined, "interruption");
    };
    const timer = setTimeout(() => terminate(undefined, "timeout"), timeoutMs);
    const removeFailureHandler = recording.onFailure((error) => terminate(error, "recording"));

    const processText = (text: string): void => {
      if (failure || stoppedByMarker) return;
      rawStdout?.append(text);
      const lines = `${stdoutBuffer}${text}`.split(/\r?\n/u);
      stdoutBuffer = lines.pop() ?? "";
      for (const line of lines) {
        const lineBytes = Buffer.byteLength(line, "utf8");
        if (lineBytes > limits.maxLineBytes) {
          throw new BenchmarkOutputOverflowError("stdout line", limits.maxLineBytes, lineBytes);
        }
        eventCapture.process(line);
      }
      const bufferedLineBytes = Buffer.byteLength(stdoutBuffer, "utf8");
      if (bufferedLineBytes > limits.maxLineBytes) {
        throw new BenchmarkOutputOverflowError("stdout line", limits.maxLineBytes, bufferedLineBytes);
      }
      if (eventCapture.stopMarkerSeen) terminate(undefined, "marker");
    };

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
    child.once("close", async (code, signal) => {
      child.stdout.unpipe(recording.stream);
      clearTimeout(timer);
      const termination = terminationPromise ? await terminationPromise : true;
      const terminationError = typeof termination === "object" ? termination.terminationError : undefined;
      const treeStopped = typeof termination === "boolean" ? termination : false;
      removeFailureHandler();
      options.signal?.removeEventListener("abort", interrupt);
      if (terminationError) {
        if (interruption) attachBenchmarkCleanupError(interruption, terminationError);
        else failure ??= errorMessage(terminationError);
      }
      if (interruption) {
        if (!terminationError && !treeStopped)
          attachBenchmarkCleanupError(interruption, new Error("benchmark process tree did not terminate"));
        rejectResult(interruption);
        return;
      }
      try {
        processText(stdoutDecoder.end());
        if (!failure && !stoppedByMarker) eventCapture.process(stdoutBuffer);
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
        rawEventCount: eventCapture.rawEventCount,
        metricEventCount: eventCapture.metricEventCount,
        runtimeContexts: eventCapture.runtimeContexts,
        userTurns: eventCapture.userTurns,
        rawStdout: rawStdout?.value(),
        recordingCapture: recording.capture,
        projectInstructionProof: proofCapture?.finish(),
        elapsedMs: performance.now() - startedAt,
      });
    });
    options.signal?.addEventListener("abort", interrupt, { once: true });
    if (options.signal?.aborted) interrupt();
  });
}
