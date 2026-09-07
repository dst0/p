import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { pathToFileURL } from "node:url";

const signalCases: Array<[NodeJS.Signals, number]> = [
  ["SIGINT", 130],
  ["SIGTERM", 143],
];

for (const [signalName, exitCode] of signalCases) {
  test(`${signalName} writes terminal evidence and removes every owned private root`, { timeout: 15_000 }, async () => {
    const root = mkdtempSync(join(tmpdir(), "p-paired-signal-process-"));
    const runtime = join(root, "runtime");
    const scratch = join(root, "scratch");
    const privateRoot = join(root, "private");
    const output = join(root, "run-v5.0.1-rc.1-signal-process");
    for (const path of [runtime, scratch, privateRoot, join(root, "packages", "coding-agent", "dist")]) {
      mkdirSync(path, { recursive: true });
    }
    const authPath = join(privateRoot, "auth.json");
    const modelsPath = join(privateRoot, "models.json");
    writeFileSync(join(root, "AGENTS.md"), "rules\n");
    writeFileSync(join(root, "packages", "coding-agent", "dist", "cli.js"), "runtime\n");
    writeFileSync(authPath, "{}\n");
    writeFileSync(modelsPath, "{}\n");
    const benchmarkModule = pathToFileURL(join(process.cwd(), "benchmarks", "src", "run-project-instructions.ts")).href;
    const scheduleModule = pathToFileURL(
      join(process.cwd(), "benchmarks", "src", "project-instructions", "run-schedule.ts"),
    ).href;
    const interruptionModule = pathToFileURL(
      join(process.cwd(), "benchmarks", "src", "harness", "interruption.ts"),
    ).href;
    const source = `
    import { rmSync } from "node:fs";
    import { runProjectInstructionsBenchmark } from ${JSON.stringify(benchmarkModule)};
    import { runPairedBenchmarkSchedule } from ${JSON.stringify(scheduleModule)};
    import { createBenchmarkSignalController } from ${JSON.stringify(interruptionModule)};
    const controller = createBenchmarkSignalController();
    try {
      await runProjectInstructionsBenchmark({
        argv: ["--model", "provider/model", "--task", "event-sourced-inventory", "--output", ${JSON.stringify(output)}],
        environment: { P_BENCHMARK_CANDIDATE_VERSION: "5.0.1-rc.1" },
        root: ${JSON.stringify(root)}, signal: controller.signal,
        dependencies: {
          createResources: () => ({ runtimeSnapshot: ${JSON.stringify(runtime)}, scratchRoot: ${JSON.stringify(scratch)}, privateSnapshots: { auth: { path: ${JSON.stringify(authPath)} }, models: { path: ${JSON.stringify(modelsPath)} }, dispose() {} }, dispose() { for (const path of [${JSON.stringify(runtime)}, ${JSON.stringify(scratch)}, ${JSON.stringify(privateRoot)}]) rmSync(path, { recursive: true, force: true }); } }),
          createAuthOutputGuard: () => undefined, privateInputEvidence: () => ({}),
          hashRuntime: () => "a".repeat(64), registerCandidate: () => {},
          certify: () => ({ certificate: { compilerPreparation: { usage: { total: 0 }, elapsedMs: 0 } } }),
          runSchedule: (context) => runPairedBenchmarkSchedule(context, {
            hashRuntime: () => "a".repeat(64), setExitCode() {},
            runCell: async ({ signal }) => {
              const keepAlive = setInterval(() => {}, 1_000);
              process.stdout.write("READY\\n");
              try {
                await new Promise((_, reject) => {
                  if (signal.aborted) reject(signal.reason);
                  else signal.addEventListener("abort", () => reject(signal.reason), { once: true });
                });
              } finally { clearInterval(keepAlive); }
            },
          }),
        },
      });
    } finally { controller.dispose(); }
  `;
    const child = spawn(process.execPath, ["--input-type=module", "-e", source], {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (text) => {
      stderr += text;
    });
    try {
      await new Promise<void>((resolve, reject) => {
        child.stdout.setEncoding("utf8");
        child.stdout.on("data", (text) => {
          if (text.includes("READY")) resolve();
        });
        child.once("error", reject);
      });
      child.kill(signalName);
      const exit = await new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve) =>
        child.once("close", (code, signal) => resolve({ code, signal })),
      );
      assert.deepEqual(exit, { code: exitCode, signal: null }, stderr);
      const results = JSON.parse(readFileSync(join(output, "results.json"), "utf8"));
      const report = readFileSync(join(output, "report.md"), "utf8");
      assert.equal(results.runStatus, "interrupted");
      assert.equal(results.completed, false);
      assert.equal(results.gate.passed, false);
      assert.equal(results.samples.length, 0);
      assert.equal(results.summary, null);
      assert.match(report, /Correctness gate: \*\*INTERRUPTED\*\*/u);
      assert.doesNotMatch(report, /Correctness gate: \*\*(?:PASSED|RUNNING)\*\*/u);
      for (const path of [runtime, scratch, privateRoot]) assert.equal(existsSync(path), false);
    } finally {
      if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
      rmSync(root, { recursive: true, force: true });
    }
  });
}
