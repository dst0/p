import assert from "node:assert/strict";
import { test } from "node:test";
import { abortBenchmarkRecording, finalizeBenchmarkAgentResources } from "../../src/agents/resources-finalization.ts";
import { BenchmarkInterruptedError } from "../../src/harness/interruption.ts";
import {
  benchmarkStartupProbeFailure,
  finalizeBenchmarkStartupEvidence,
} from "../../src/harness/startup-probe-finalization.ts";

test("agent recording and resource cleanup failures preserve interruption", async () => {
  const interruption = new BenchmarkInterruptedError("SIGINT");
  const recordingError = new Error("recording cleanup failed");
  await assert.rejects(
    abortBenchmarkRecording(
      {
        abort: async () => {
          throw recordingError;
        },
      },
      interruption,
    ),
    (error) => error === interruption && interruption.cleanupErrors?.[0] === recordingError,
  );
  const controller = new AbortController();
  const resourceInterruption = new BenchmarkInterruptedError("SIGINT");
  controller.abort(resourceInterruption);
  const calls: string[] = [];
  assert.throws(
    () =>
      finalizeBenchmarkAgentResources(
        {
          root: "/root",
          dirs: { pi: "/pi", p: "/p" },
          dispose: () => {
            calls.push("dispose");
            throw new Error("dispose");
          },
        },
        {
          capture: (path) => {
            calls.push(path);
            throw new Error("capture");
          },
          sanitizeTree: () => {
            calls.push("sanitize");
            throw new Error("sanitize");
          },
          retainTree: () => {
            throw new Error("retain should not run");
          },
        },
        "/output",
        controller.signal,
      ),
    (error) => error === resourceInterruption && resourceInterruption.cleanupErrors?.length === 4,
  );
  assert.deepEqual(calls, ["/pi/auth.json", "/p/auth.json", "dispose", "sanitize"]);
});

test("startup probes preserve signal identity through diagnostics failure", () => {
  const interruption = new BenchmarkInterruptedError("SIGTERM");
  const evidence = { status: "running" };
  assert.equal(benchmarkStartupProbeFailure(interruption, evidence, "/diagnostics"), interruption);
  assert.equal(evidence.status, "failed");
  assert.throws(
    () => finalizeBenchmarkStartupEvidence("/nonexistent/private/diagnostics", evidence, interruption),
    (error) => error === interruption && interruption.cleanupErrors?.length === 1,
  );
});
