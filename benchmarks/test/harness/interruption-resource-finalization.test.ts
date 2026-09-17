import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { abortBenchmarkRecording, finalizeBenchmarkAgentResources } from "../../src/agents/resources-finalization.ts";
import { BenchmarkInterruptedError } from "../../src/harness/interruption.ts";
import {
  benchmarkStartupProbeFailure,
  finalizeBenchmarkStartupEvidence,
  finalizeKiloStartupEvidence,
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

test("ordinary primary failures remain first when recording and startup cleanup also fail", async () => {
  const primary = new Error("primary");
  const cleanup = new Error("cleanup");
  await assert.rejects(
    abortBenchmarkRecording({ abort: async () => Promise.reject(cleanup) }, primary),
    (error) => error instanceof AggregateError && error.errors[0] === primary && error.errors[1] === cleanup,
  );
  assert.throws(
    () => finalizeBenchmarkStartupEvidence("/nonexistent/private/diagnostics", { status: "failed" }, primary),
    (error) => error instanceof AggregateError && error.errors[0] === primary,
  );
});

test("unsafe Kilo startup finalization never traverses a symlink-swapped config tree", () => {
  const root = mkdtempSync(join(tmpdir(), "unsafe-kilo-startup-finalization-"));
  try {
    const config = join(root, "config");
    const diagnostics = join(root, "diagnostics");
    const outside = join(root, "outside");
    mkdirSync(join(outside, "kilo", "log"), { recursive: true });
    mkdirSync(config);
    mkdirSync(diagnostics);
    writeFileSync(join(outside, "kilo", "log", "secret.log"), "outside");
    symlinkSync(outside, join(config, "data"), "dir");
    const evidence = { status: "failed" };
    finalizeKiloStartupEvidence(config, diagnostics, evidence, new Error("primary"), false);
    assert.equal("runtimeFiles" in evidence, false);
    assert.equal(existsSync(join(diagnostics, "runtime-logs", "secret.log")), false);
    assert.equal(readFileSync(join(outside, "kilo", "log", "secret.log"), "utf8"), "outside");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
