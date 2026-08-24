import { existsSync } from "node:fs";
import { join } from "node:path";
import { assessSample } from "./benchmark-project-instructions-core.js";
import { createClassifiedBenchmarkGateFailure } from "./benchmark-project-instructions-failure.js";
import { runPairedBenchmarkCell } from "./benchmark-project-instructions-cell.js";
import { writePairedBenchmarkEvidence } from "./benchmark-project-instructions-output.js";
import { hashRuntimeSnapshot } from "./benchmark-runtime-snapshot.js";
import {
  attachBenchmarkCleanupError,
  benchmarkInterruptionFromSignal,
  isBenchmarkInterruptedError,
  throwIfBenchmarkInterrupted,
} from "./benchmark-interruption.js";

const defaultOperations = {
  now: Date.now,
  hashRuntime: (runtimeSnapshot) => hashRuntimeSnapshot(runtimeSnapshot, process.execPath),
  runCell: runPairedBenchmarkCell,
  writeEvidence: writePairedBenchmarkEvidence,
  setExitCode: (value) => {
    process.exitCode = value;
  },
};

export async function runPairedBenchmarkSchedule(context, operationOverrides = {}) {
  const operations = { ...defaultOperations, ...operationOverrides };
  const { options, output, scratchRoot, runtimeSnapshot, runtimeSha256, schedule, document, deadline } = context;
  let stopped = false;
  let stopError;
  outer: for (const pair of schedule) {
    for (const mode of pair.modes) {
      try {
        throwIfBenchmarkInterrupted(context.signal);
        const remainingSeconds = Math.ceil((deadline - operations.now()) / 1000);
        if (remainingSeconds <= 0) throw new Error("overall deadline reached");
        if (operations.hashRuntime(runtimeSnapshot) !== runtimeSha256) {
          throw new Error("immutable P runtime changed before the benchmark cell");
        }
        const cellOutput = join(output, "cells", `run-${pair.run}`, pair.task, mode);
        if (existsSync(cellOutput)) throw new Error("benchmark cell output already exists");
        const scratchOutput = join(scratchRoot, `run-${pair.run}`, pair.task, mode);
        const progressPath = join(output, "progress", `run-${pair.run}-${pair.task}-${mode}.jsonl`);
        console.log(`[run ${pair.run}] ${pair.task}/${mode}: starting`);
        const sample = await operations.runCell({
          options,
          pair,
          mode,
          cellOutput,
          scratchOutput,
          remainingSeconds,
          runtimeSnapshot,
          runtimeSha256,
          progressPath,
          output,
          repoRoot: context.repoRoot,
          signal: context.signal,
        });
        throwIfBenchmarkInterrupted(context.signal);
        document.samples.push(sample);
        const assessment = assessSample(sample);
        if (!assessment.passed) {
          document.gate = {
            passed: false,
            failure: createClassifiedBenchmarkGateFailure(pair, mode, assessment.reason, {
              liveness: sample.liveness,
            }),
          };
          document.runStatus = "failed";
          stopped = true;
          break outer;
        }
      } catch (error) {
        const interruption = benchmarkInterruptionFromSignal(context.signal) ?? (isBenchmarkInterruptedError(error) ? error : undefined);
        if (interruption && error !== interruption) attachBenchmarkCleanupError(interruption, error);
        const failureError = interruption ?? error;
        document.gate = {
          passed: false,
          failure: createClassifiedBenchmarkGateFailure(pair, mode, failureError),
        };
        document.runStatus = interruption ? "interrupted" : "failed";
        stopped = true;
        stopError = failureError;
        break outer;
      }
      operations.writeEvidence(output, document);
    }
  }
  document.completed = !stopped && document.samples.length === schedule.length * 2;
  if (document.completed) {
    document.gate = { passed: true };
    document.runStatus = "completed";
  } else if (!stopped) {
    const next = schedule.find(
      (pair) => !document.samples.some((sample) => sample.run === pair.run && sample.task === pair.task),
    );
    document.gate = {
      passed: false,
      failure: createClassifiedBenchmarkGateFailure(next ?? schedule.at(-1), "unknown", "paired run ended early"),
    };
    document.runStatus = "failed";
  }
  if (document.runStatus === "failed" && !context.signal?.aborted) operations.setExitCode(2);
  if (isBenchmarkInterruptedError(stopError)) throw stopError;
  return document;
}
