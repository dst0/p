import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import type { runRecordedCommand } from "../../src/workloads/agent-turn-runner.ts";
import { isBenchmarkMutableArtifactsUnsafeError } from "../../src/workloads/benchmark-run-finalization.ts";
import { parseRunnerArgs } from "../../src/workloads/runner-options.ts";
import { runKiloStartupProbe } from "../../src/workloads/startup-probes.ts";

type ProbeResult = Awaited<ReturnType<typeof runRecordedCommand>>;

function result(overrides: Partial<ProbeResult> = {}): ProbeResult {
  return {
    stdout: "",
    stderr: "",
    code: 0,
    signal: null,
    timedOut: false,
    rawEventCount: 0,
    metricEventCount: 0,
    runtimeContexts: [],
    userTurns: [],
    elapsedMs: 1,
    ...overrides,
  };
}

const modelResolution = () => result({ rawStdout: 'surface/model\n{"api":{"id":"backend/model"}}\n' });

test("Kilo startup rejects wrong response, timeout, nonzero exit, parser failure, and raw echoed marker", async () => {
  const cases: Array<{ name: string; request: ProbeResult }> = [
    { name: "wrong response", request: result({ stdout: kiloText("wrong") }) },
    { name: "timeout", request: result({ timedOut: true, stdout: kiloText("benchmark-startup-ok") }) },
    { name: "nonzero", request: result({ code: 7, stdout: kiloText("benchmark-startup-ok") }) },
    {
      name: "parser failure",
      request: result({ stdout: `{malformed benchmark-startup-ok\n${kiloText("benchmark-startup-ok")}` }),
    },
    {
      name: "raw echoed marker",
      request: result({ stdout: `${JSON.stringify({ type: "request", prompt: "benchmark-startup-ok" })}\n` }),
    },
  ];
  for (const scenario of cases) {
    const root = mkdtempSync(join(tmpdir(), "kilo-startup-fail-closed-"));
    const config = join(root, "config");
    const output = join(root, "output");
    mkdirSync(config);
    mkdirSync(output);
    const options = parseRunnerArgs([
      "--agents",
      "kilo",
      "--kilo-model",
      "surface/model",
      "--expected-resolved-model",
      "backend/model",
    ]);
    let invocation = 0;
    try {
      await assert.rejects(
        runKiloStartupProbe(options, config, output, performance.now() + 10_000, async () => {
          invocation += 1;
          return invocation === 1 ? modelResolution() : scenario.request;
        }),
        scenario.name,
      );
      const statePath = join(output, "diagnostics", "kilo-startup", "state.json");
      assert.equal(existsSync(statePath), true, scenario.name);
      const state = JSON.parse(readFileSync(statePath, "utf8")) as { status: string; request?: { status: string } };
      assert.equal(state.status, "failed", scenario.name);
      assert.notEqual(state.request?.status, "passed", scenario.name);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a confirmed recording failure is not mislabeled as unconfirmed termination", async () => {
  const root = mkdtempSync(join(tmpdir(), "kilo-startup-confirmed-failure-"));
  const config = join(root, "config");
  const output = join(root, "output");
  mkdirSync(config);
  mkdirSync(output);
  const options = parseRunnerArgs([
    "--agents",
    "kilo",
    "--kilo-model",
    "surface/model",
    "--expected-resolved-model",
    "backend/model",
  ]);
  try {
    await assert.rejects(
      runKiloStartupProbe(options, config, output, performance.now() + 10_000, async () => {
        throw new Error("recording finalization failed after confirmed exit");
      }),
      (error) => !isBenchmarkMutableArtifactsUnsafeError(error),
    );
    assert.equal(existsSync(join(output, "diagnostics", "kilo-startup", "state.json")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

function kiloText(text: string): string {
  return `${JSON.stringify({ type: "step_finish", part: { id: "1", type: "step-finish", model: "backend/model", tokens: { input: 1, output: 1, total: 2 } } })}\n${JSON.stringify({ type: "text", part: { id: "2", type: "text", text } })}\n`;
}
