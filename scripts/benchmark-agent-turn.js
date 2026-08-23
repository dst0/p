import { spawn } from "node:child_process";
import { performance } from "node:perf_hooks";
import { StringDecoder } from "node:string_decoder";

import {
  BenchmarkOutputOverflowError,
  captureOverflowEvidence,
  createBoundedTextCapture,
  resolveBenchmarkOutputLimits,
} from "./benchmark-output-capture.js";
import { createBenchmarkEventCapture } from "./benchmark-project-instruction-stream.js";
import { sanitizeBenchmarkGitEnvironment } from "./benchmark-workspace-repository.js";

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export function runBenchmarkAgentTurn(
  command,
  timeoutMs,
  recording,
  metricEventTypes,
  options = {},
) {
  return new Promise((resolveResult) => {
    const limits = resolveBenchmarkOutputLimits(options.outputLimits);
    const startedAt = performance.now();
    const child = spawn(command.executable, command.args, {
      cwd: command.cwd,
      env: sanitizeBenchmarkGitEnvironment(command.env),
      stdio: ["ignore", "pipe", "pipe"],
    });
    const stdoutDecoder = new StringDecoder("utf8");
    const stderrDecoder = new StringDecoder("utf8");
    const rawStdout = options.collectRawStdout
      ? createBoundedTextCapture("raw stdout", limits.maxRawStdoutBytes)
      : undefined;
    const stderr = createBoundedTextCapture("stderr", limits.maxStderrBytes);
    const eventCapture = createBenchmarkEventCapture(metricEventTypes, options.eventOrdinalBase, {
      maxMetricBytes: limits.maxMetricBytes,
      maxMetricEvents: limits.maxMetricEvents,
      maxRuntimeContexts: limits.maxRuntimeContexts,
      stopMarker: options.stopOnMarker,
    });
    let stdoutBuffer = "";
    let failure;
    let timedOut = false;
    let stoppedByMarker = false;
    let childError;
    let killTimer;
    let captureOverflow;

    const terminate = (error, reason) => {
      if (error) {
        failure ??= errorMessage(error);
        captureOverflow ??= captureOverflowEvidence(error, options.turn);
      }
      if (reason === "timeout") timedOut = true;
      if (reason === "marker") stoppedByMarker = true;
      child.kill("SIGTERM");
      const killGraceMs = error ? (options.failureKillGraceMs ?? 250) : 5000;
      killTimer ??= setTimeout(() => child.kill("SIGKILL"), killGraceMs);
    };
    const timer = setTimeout(() => terminate(undefined, "timeout"), timeoutMs);
    const removeFailureHandler = recording.onFailure((error) => terminate(error, "recording"));

    const processText = (text) => {
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
    child.once("close", (code, signal) => {
      child.stdout.unpipe(recording.stream);
      clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      removeFailureHandler();
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
        elapsedMs: performance.now() - startedAt,
      });
    });
  });
}
