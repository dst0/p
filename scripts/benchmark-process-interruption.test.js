import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { PassThrough } from "node:stream";
import test from "node:test";

import { BenchmarkInterruptedError } from "./benchmark-interruption.js";
import { benchmarkProcessGroupOptions, signalBenchmarkProcessTree } from "./benchmark-process-control.js";
import {
  certifyBenchmarkProjectInstructions,
  runBenchmarkSeedHelper,
} from "./benchmark-project-instruction-seed-runner.js";
import { runBenchmarkChild } from "./benchmark-project-instructions-liveness.js";

test("process-group control is POSIX-only with a direct-child fallback", () => {
  const options = { stdio: "ignore" };
  assert.equal(benchmarkProcessGroupOptions(options, "win32"), options);
  assert.deepEqual(benchmarkProcessGroupOptions(options, "darwin"), { ...options, detached: true });
  const directSignals = [];
  const groupSignals = [];
  const child = { pid: 42, kill: (signal) => directSignals.push(signal) };
  signalBenchmarkProcessTree(child, "SIGTERM", {
    platform: "darwin",
    kill: (pid, signal) => {
      groupSignals.push([pid, signal]);
      throw new Error("groups unavailable");
    },
  });
  assert.deepEqual(groupSignals, [[-42, "SIGTERM"]]);
  assert.deepEqual(directSignals, ["SIGTERM"]);
});

async function waitFor(check, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!check()) {
    if (Date.now() >= deadline) throw new Error("timed out waiting for child evidence");
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

function processExists(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") return false;
    throw error;
  }
}

function resistantTreeSource(pidPath, heartbeatPath, parentResists = true, readyPath) {
  const descendant = `
    const { appendFileSync } = require("node:fs");
    process.on("SIGTERM", () => {});
    setInterval(() => appendFileSync(${JSON.stringify(heartbeatPath)}, "x"), 10);
  `;
  return `
    const { spawn } = require("node:child_process");
    const { writeFileSync } = require("node:fs");
    const child = spawn(process.execPath, ["-e", ${JSON.stringify(descendant)}], { stdio: "ignore" });
    writeFileSync(${JSON.stringify(pidPath)}, String(child.pid));
    process.on("SIGTERM", () => ${parentResists ? "{}" : "process.exit(0)"});
    ${readyPath ? `writeFileSync(${JSON.stringify(readyPath)}, "ready");` : ""}
    setInterval(() => {}, 1000);
  `;
}

async function assertTreeStopped(pidPath, heartbeatPath) {
  const descendantPid = Number(readFileSync(pidPath, "utf8"));
  const before = existsSync(heartbeatPath) ? statSync(heartbeatPath).size : 0;
  await new Promise((resolve) => setTimeout(resolve, 100));
  const after = existsSync(heartbeatPath) ? statSync(heartbeatPath).size : 0;
  try {
    assert.equal(after, before);
    await waitFor(() => !processExists(descendantPid), 1_500);
    assert.equal(processExists(descendantPid), false);
  } finally {
    if (processExists(descendantPid)) process.kill(descendantPid, "SIGKILL");
  }
}

test("paired child interruption terminates resistant descendants before resolving", { timeout: 5_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-child-tree-"));
  const pidPath = join(root, "descendant.pid");
  const heartbeatPath = join(root, "heartbeat");
  const readyPath = join(root, "ready");
  const controller = new AbortController();
  try {
    const resultPromise = runBenchmarkChild(
      process.execPath,
      ["-e", resistantTreeSource(pidPath, heartbeatPath, false, readyPath)],
      { stdio: "ignore" },
      undefined,
      { signal: controller.signal, killGraceMs: 50 },
    );
    await waitFor(() => existsSync(readyPath) && existsSync(heartbeatPath));
    controller.abort(new BenchmarkInterruptedError("SIGINT"));
    const result = await resultPromise;
    assert.equal(result.interruption, controller.signal.reason);
    await assertTreeStopped(pidPath, heartbeatPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("seed helper interruption is asynchronous, bounded, and terminates descendants", { timeout: 5_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-seed-tree-"));
  const helper = join(root, "helper.js");
  const pidPath = join(root, "descendant.pid");
  const heartbeatPath = join(root, "heartbeat");
  const controller = new AbortController();
  writeFileSync(helper, resistantTreeSource(pidPath, heartbeatPath, false));
  try {
    const resultPromise = runBenchmarkSeedHelper(helper, [], 10_000, {
      signal: controller.signal,
      killGraceMs: 50,
    });
    assert.equal(resultPromise instanceof Promise, true);
    await waitFor(() => existsSync(pidPath) && existsSync(heartbeatPath));
    controller.abort(new BenchmarkInterruptedError("SIGTERM"));
    await assert.rejects(resultPromise, (error) => error === controller.signal.reason);
    await assertTreeStopped(pidPath, heartbeatPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("termination rejection settles paired-child and seed-helper interruptions", async () => {
  const cleanupError = new Error("kill cleanup failed");
  for (const wrapper of ["paired-child", "seed-helper"]) {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    child.kill = () => true;
    child.exitCode = 0;
    child.signalCode = null;
    const controller = new AbortController();
    const interruption = new BenchmarkInterruptedError("SIGTERM");
    const control = {
      signal: controller.signal,
      spawn: () => child,
      terminateProcessTree: async () => { throw cleanupError; },
    };
    const result = wrapper === "paired-child"
      ? runBenchmarkChild("unused", [], {}, undefined, control)
      : runBenchmarkSeedHelper("unused", [], 10_000, control);
    controller.abort(interruption);
    child.emit("close", 0, null);
    if (wrapper === "paired-child") {
      const settled = await result;
      assert.equal(settled.interruption, interruption);
      assert.equal(interruption.cleanupErrors?.at(-1), cleanupError);
    } else {
      await assert.rejects(result, (error) => error === interruption && error.cleanupErrors?.at(-1) === cleanupError);
    }
  }
});

test("certification cleanup failure remains secondary to interruption", { timeout: 5_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-certify-cleanup-"));
  const runtimeSnapshot = join(root, "runtime");
  const scratchRoot = join(root, "scratch");
  const privateRoot = join(root, "private");
  const readyPath = join(root, "ready");
  const sourceFile = join(root, "AGENTS.md");
  const authPath = join(privateRoot, "auth.json");
  const modelsPath = join(privateRoot, "models.json");
  const cleanupError = new Error("certification cleanup failed");
  const interruption = new BenchmarkInterruptedError("SIGINT");
  const controller = new AbortController();
  for (const path of [join(runtimeSnapshot, "scripts"), scratchRoot, privateRoot]) {
    mkdirSync(path, { recursive: true });
  }
  writeFileSync(sourceFile, "rules\n");
  writeFileSync(authPath, "{}\n");
  writeFileSync(modelsPath, "{}\n");
  writeFileSync(
    join(runtimeSnapshot, "scripts", "benchmark-project-instruction-seed.js"),
    `require("node:fs").writeFileSync(${JSON.stringify(readyPath)}, "ready"); process.on("SIGTERM", () => {}); setInterval(() => {}, 1000);`,
  );
  let captures = 0;
  try {
    const resultPromise = certifyBenchmarkProjectInstructions({
      scratchRoot,
      runtimeSnapshot,
      runtimeSha256: "a".repeat(64),
      sourceFile,
      sourceSha256: "b".repeat(64),
      privateSnapshots: { auth: { path: authPath }, models: { path: modelsPath } },
      compilerModel: "provider/model",
      authOutputGuard: { capture() { if (++captures > 1) throw cleanupError; } },
      signal: controller.signal,
      interruptionKillGraceMs: 50,
    });
    await waitFor(() => existsSync(readyPath));
    controller.abort(interruption);
    await assert.rejects(
      resultPromise,
      (error) => error === interruption && error.cleanupErrors?.[0] === cleanupError,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("outer runner cancellation cannot orphan its nested agent group", { timeout: 5_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-nested-agent-tree-"));
  const pidPath = join(root, "agent.pid");
  const heartbeatPath = join(root, "agent-heartbeat");
  const readyPath = join(root, "agent-ready");
  const agentTurnModule = pathToFileURL(join(process.cwd(), "scripts", "benchmark-agent-turn.js")).href;
  const interruptionModule = pathToFileURL(join(process.cwd(), "scripts", "benchmark-interruption.js")).href;
  const agentSource = `
    const { appendFileSync, writeFileSync } = require("node:fs");
    writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));
    process.on("SIGTERM", () => {});
    writeFileSync(${JSON.stringify(readyPath)}, "ready");
    setInterval(() => appendFileSync(${JSON.stringify(heartbeatPath)}, "x"), 10);
  `;
  const runnerSource = `
    import { Writable } from "node:stream";
    import { runBenchmarkAgentTurn } from ${JSON.stringify(agentTurnModule)};
    import { createBenchmarkSignalController } from ${JSON.stringify(interruptionModule)};
    const controller = createBenchmarkSignalController();
    const recording = {
      stream: new Writable({ write(_chunk, _encoding, callback) { callback(); } }),
      onFailure() { return () => {}; },
      capture: {},
    };
    try {
      await runBenchmarkAgentTurn(
        { executable: process.execPath, args: ["-e", ${JSON.stringify(agentSource)}], cwd: process.cwd(), env: process.env },
        10_000,
        recording,
        new Set(),
        { signal: controller.signal, projectInstructions: true, interruptionKillGraceMs: 100 },
      );
    } catch {} finally { controller.dispose(); }
  `;
  const controller = new AbortController();
  try {
    const resultPromise = runBenchmarkChild(
      process.execPath,
      ["--input-type=module", "-e", runnerSource],
      { cwd: process.cwd(), stdio: "ignore" },
      undefined,
      { signal: controller.signal, killGraceMs: 40 },
    );
    await waitFor(() => existsSync(readyPath) && existsSync(heartbeatPath));
    controller.abort(new BenchmarkInterruptedError("SIGTERM"));
    await resultPromise;
    await assertTreeStopped(pidPath, heartbeatPath);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
