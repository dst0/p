import { existsSync } from "node:fs";
import { join } from "node:path";
import { assessSample } from "./benchmark-project-instructions-core.js";
import { createClassifiedBenchmarkGateFailure } from "./benchmark-project-instructions-failure.js";
import { runPairedBenchmarkCell } from "./benchmark-project-instructions-cell.js";
import { writePairedBenchmarkEvidence } from "./benchmark-project-instructions-output.js";
import { hashRuntimeSnapshot } from "./benchmark-runtime-snapshot.js";

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
  outer: for (const pair of schedule) {
    for (const mode of pair.modes) {
      try {
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
        });
        document.samples.push(sample);
        const assessment = assessSample(sample);
        if (!assessment.passed) {
          document.gate = {
            passed: false,
            failure: createClassifiedBenchmarkGateFailure(pair, mode, assessment.reason, {
              liveness: sample.liveness,
            }),
          };
          operations.writeEvidence(output, document);
          break outer;
        }
      } catch (error) {
        document.gate = {
          passed: false,
          failure: createClassifiedBenchmarkGateFailure(pair, mode, error),
        };
        operations.writeEvidence(output, document);
        break outer;
      }
      operations.writeEvidence(output, document);
    }
  }
  document.completed = document.gate.passed && document.samples.length === schedule.length * 2;
  if (!document.completed && document.gate.passed) {
    const next = schedule.find(
      (pair) => !document.samples.some((sample) => sample.run === pair.run && sample.task === pair.task),
    );
    document.gate = {
      passed: false,
      failure: createClassifiedBenchmarkGateFailure(next ?? schedule.at(-1), "unknown", "paired run ended early"),
    };
  }
  operations.writeEvidence(output, document);
  console.log(`Report: ${join(output, "report.md")}`);
  if (!document.gate.passed) operations.setExitCode(2);
  return document;
}
