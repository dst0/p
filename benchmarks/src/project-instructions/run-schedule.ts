import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  attachBenchmarkCleanupError,
  benchmarkInterruptionFromSignal,
  isBenchmarkInterruptedError,
  throwIfBenchmarkInterrupted,
} from "../harness/interruption.ts";
import { hashRuntimeSnapshot } from "../harness/runtime-snapshot.ts";
import type { PairedCellContext } from "./run-cell.ts";
import { runPairedBenchmarkCell } from "./run-cell.ts";
import type { PairedScheduleCell } from "./run-core.ts";
import { assessSample } from "./run-core.ts";
import { createClassifiedBenchmarkGateFailure } from "./run-failure.ts";
import { writePairedBenchmarkEvidence } from "./run-output.ts";

const defaultOperations = {
  now: Date.now,
  hashRuntime: (runtimeSnapshot: string) => hashRuntimeSnapshot(runtimeSnapshot, process.execPath),
  runCell: runPairedBenchmarkCell,
  writeEvidence: writePairedBenchmarkEvidence,
  setExitCode: (value: number) => {
    process.exitCode = value;
  },
};

type ScheduleDocument = Parameters<typeof writePairedBenchmarkEvidence>[1];
type ScheduleContext = {
  options: PairedCellContext["options"];
  output: string;
  scratchRoot: string;
  runtimeSnapshot: string;
  runtimeSha256: string;
  schedule: PairedScheduleCell[];
  document: ScheduleDocument;
  deadline: number;
  repoRoot: string;
  signal?: AbortSignal;
};
type ScheduleOperations = typeof defaultOperations;

export async function runPairedBenchmarkSchedule(
  context: ScheduleContext,
  operationOverrides: Partial<ScheduleOperations> = {},
): Promise<ScheduleDocument> {
  const operations = { ...defaultOperations, ...operationOverrides };
  const { options, output, scratchRoot, runtimeSnapshot, runtimeSha256, schedule, document, deadline } = context;
  let stopped = false;
  let stopError: unknown;
  outer: for (const pair of schedule) {
    for (const condition of pair.conditions) {
      try {
        throwIfBenchmarkInterrupted(context.signal);
        const remainingSeconds = Math.ceil((deadline - operations.now()) / 1000);
        if (remainingSeconds <= 0) throw new Error("overall deadline reached");
        if (operations.hashRuntime(runtimeSnapshot) !== runtimeSha256) {
          throw new Error("immutable P runtime changed before the benchmark cell");
        }
        const cellOutput = join(output, "cells", `run-${pair.run}`, pair.task, condition);
        if (existsSync(cellOutput)) throw new Error("benchmark cell output already exists");
        const scratchOutput = join(scratchRoot, `run-${pair.run}`, pair.task, condition);
        const progressPath = join(output, "progress", `run-${pair.run}-${pair.task}-${condition}.jsonl`);
        console.log(`[run ${pair.run}] ${pair.task}/${condition}: starting`);
        const sample = await operations.runCell({
          options,
          pair,
          condition,
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
            failure: createClassifiedBenchmarkGateFailure(pair, condition, assessment.reason, {
              liveness: sample.liveness,
            }),
          };
          document.runStatus = "failed";
          stopped = true;
          break outer;
        }
      } catch (error) {
        const interruption =
          benchmarkInterruptionFromSignal(context.signal) ?? (isBenchmarkInterruptedError(error) ? error : undefined);
        if (interruption && error !== interruption) attachBenchmarkCleanupError(interruption, error);
        const failureError = interruption ?? error;
        document.gate = {
          passed: false,
          failure: createClassifiedBenchmarkGateFailure(pair, condition, failureError),
        };
        document.runStatus = interruption ? "interrupted" : "failed";
        stopped = true;
        stopError = failureError;
        break outer;
      }
      operations.writeEvidence(output, document);
    }
  }
  document.completed = !stopped && document.samples.length === schedule.length * 3;
  if (document.completed) {
    document.gate = { passed: true };
    document.runStatus = "completed";
  } else if (!stopped) {
    const next = schedule.find(
      (pair) => !document.samples.some((sample) => sample.run === pair.run && sample.task === pair.task),
    );
    document.gate = {
      passed: false,
      failure: createClassifiedBenchmarkGateFailure(
        next ?? schedule.at(-1) ?? { run: 0, task: "unknown" },
        "unknown",
        "paired run ended early",
      ),
    };
    document.runStatus = "failed";
  }
  if (document.runStatus === "failed" && !context.signal?.aborted) operations.setExitCode(2);
  if (isBenchmarkInterruptedError(stopError)) throw stopError;
  return document;
}
