import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

import { runRealSemanticSearchSmoke } from "./indexing-semantic-smoke-runner.js";

test("semantic smoke cannot leave reinstall waiting forever after reporting search success", { skip: process.platform === "win32" }, async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p-semantic-smoke-lifecycle-"));
  const scriptPath = path.join(directory, "stalled-smoke.js");
  const pidPath = path.join(directory, "smoke.pid");
  const descendantPidPath = path.join(directory, "smoke-descendant.pid");
  fs.writeFileSync(
    scriptPath,
    [
      'import fs from "node:fs";',
      'import { spawn } from "node:child_process";',
      `fs.writeFileSync(${JSON.stringify(pidPath)}, String(process.pid));`,
      'const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "inherit" });',
      `fs.writeFileSync(${JSON.stringify(descendantPidPath)}, String(descendant.pid));`,
      'console.log("Real semantic-search smoke passed (1 result)");',
      'console.warn("Could not remove semantic-search smoke collection: HTTP 500");',
      "setInterval(() => {}, 1000);",
    ].join("\n"),
  );

  let watchdog;
  try {
    const startedAt = Date.now();
    await assert.rejects(
      Promise.race([
        runRealSemanticSearchSmoke({}, { scriptPath, timeoutMs: 10_000 }),
        new Promise((_, reject) => {
          watchdog = setTimeout(() => reject(new Error("test watchdog expired before smoke cleanup")), 30_000);
        }),
      ]),
      /timed out after 10000ms/,
    );
    assert.ok(Date.now() - startedAt < 20_000, "the installer must receive a bounded failure");
    assert.ok(fs.existsSync(pidPath), "the smoke process must have reached its post-search hang");
    assert.ok(fs.existsSync(descendantPidPath), "the smoke process must have started its backend child");
    const pid = Number(fs.readFileSync(pidPath, "utf8"));
    const descendantPid = Number(fs.readFileSync(descendantPidPath, "utf8"));
    assert.throws(() => process.kill(pid, 0), { code: "ESRCH" });
    const state = spawnSync("ps", ["-p", String(descendantPid), "-o", "state="], { encoding: "utf8" });
    assert.ok(state.status !== 0 || state.stdout.trim().startsWith("Z"), "the descendant must no longer run");
  } finally {
    clearTimeout(watchdog);
    if (fs.existsSync(pidPath)) {
      const pid = Number(fs.readFileSync(pidPath, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(-pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
    if (fs.existsSync(descendantPidPath)) {
      const pid = Number(fs.readFileSync(descendantPidPath, "utf8"));
      if (Number.isSafeInteger(pid) && pid > 0) {
        try {
          process.kill(pid, "SIGKILL");
        } catch (error) {
          if (error.code !== "ESRCH") throw error;
        }
      }
    }
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("semantic smoke preserves the selected environment and reports a successful child", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p-semantic-smoke-success-"));
  const scriptPath = path.join(directory, "successful-smoke.js");
  fs.writeFileSync(scriptPath, 'console.log(`semantic smoke marker: ${process.env.P_SMOKE_TEST_MARKER}`);\n');
  try {
    const result = await runRealSemanticSearchSmoke(
      { P_SMOKE_TEST_MARKER: "configured" },
      { scriptPath, timeoutMs: 10_000 },
    );
    assert.equal(result.status, 0);
    assert.match(result.stdout, /semantic smoke marker: configured/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test("semantic smoke reports a nonzero child exit", async () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "p-semantic-smoke-exit-"));
  const scriptPath = path.join(directory, "failed-smoke.js");
  fs.writeFileSync(scriptPath, "process.exit(7);\n");
  try {
    await assert.rejects(runRealSemanticSearchSmoke({}, { scriptPath, timeoutMs: 10_000 }), /status 7/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});
