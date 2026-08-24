import assert from "node:assert/strict";
import { test } from "node:test";
import { BenchmarkInterruptedError } from "../../src/harness/interruption.ts";
import { runPairedBenchmarkSchedule } from "../../src/project-instructions/run-schedule.ts";

type PairedScheduleContext = Parameters<typeof runPairedBenchmarkSchedule>[0];
type PairedDocument = PairedScheduleContext["document"];

function runningDocument(): PairedDocument {
  return {
    schedule: [],
    samples: [],
    runStatus: "running",
    completed: false,
    gate: { passed: false },
  } as unknown as PairedDocument;
}

test("schedule leaves terminal publication to global finalization", async () => {
  const interruption = new BenchmarkInterruptedError("SIGINT");
  const document = runningDocument();
  let publicationCount = 0;
  await assert.rejects(
    runPairedBenchmarkSchedule(
      {
        options: {},
        output: "/output",
        scratchRoot: "/scratch",
        runtimeSnapshot: "/runtime",
        runtimeSha256: "a".repeat(64),
        schedule: [{ run: 1, task: "task", modes: ["legacy"] }],
        document,
        deadline: Date.now() + 1_000,
        repoRoot: "/repo",
      } as PairedScheduleContext,
      {
        hashRuntime: () => "a".repeat(64),
        runCell: async () => {
          throw interruption;
        },
        writeEvidence: () => {
          publicationCount += 1;
        },
        setExitCode: () => {},
      },
    ),
    (error) => error === interruption,
  );
  assert.equal(document.runStatus, "interrupted");
  assert.equal(publicationCount, 0);
});

test("an aborted signal dominates returned samples and secondary cell errors", async () => {
  for (const outcome of ["returned", "threw"]) {
    const controller = new AbortController();
    const interruption = new BenchmarkInterruptedError("SIGINT");
    const secondary = new Error("secondary cell cleanup failure");
    const document = runningDocument();
    await assert.rejects(
      runPairedBenchmarkSchedule(
        {
          options: {},
          output: "/output",
          scratchRoot: "/scratch",
          runtimeSnapshot: "/runtime",
          runtimeSha256: "a".repeat(64),
          schedule: [{ run: 1, task: "task", modes: ["legacy"] }],
          document,
          deadline: Date.now() + 1_000,
          repoRoot: "/repo",
          signal: controller.signal,
        } as PairedScheduleContext,
        {
          hashRuntime: () => "a".repeat(64),
          writeEvidence: () => {},
          setExitCode: () => {
            throw new Error("must not set exit 2");
          },
          runCell: async () => {
            controller.abort(interruption);
            if (outcome === "threw") throw secondary;
            return {
              run: 1,
              task: "task",
              mode: "legacy",
              status: "passed",
              elapsedMs: 1,
              metrics: { usage: { totalTokens: 1 } },
              quality: { passed: true, rawScore: 1, maxScore: 1, checks: [{ passed: true }] },
            };
          },
        },
      ),
      (error) => error === interruption && (outcome === "returned" || interruption.cleanupErrors?.[0] === secondary),
    );
    assert.equal(document.runStatus, "interrupted");
    assert.equal(document.completed, false);
    assert.equal(document.gate.passed, false);
  }
});
