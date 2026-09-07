import assert from "node:assert/strict";
import fs from "node:fs";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  runBoundedProcessCommand,
  sanitizeDiagnostics,
  terminateProcessGroup,
} from "./bounded-process-command.js";

test("descendant cleanup on timeout using unix socket fixture", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bounded-timeout-test-"));
  const socketPath = path.join(tempDir, "test.sock");
  const readyPath = path.join(tempDir, "ready.flag");
  const helperScript = path.join(tempDir, "helper.js");

  const helperCode = [
    "import { spawn } from \"node:child_process\";",
    "import fs from \"node:fs\";",
    "const grandchildCode = `",
    "import net from \"node:net\";",
    "import fs from \"node:fs\";",
    "const server = net.createServer((c) => c.end(\"alive\"));",
    "server.listen(" + JSON.stringify(socketPath) + ", () => {",
    "  fs.writeFileSync(" + JSON.stringify(readyPath) + ", \"ready\");",
    "});",
    "setInterval(() => {}, 10000);",
    "`;",
    "const grandchild = spawn(process.execPath, [\"--input-type=module\", \"-e\", grandchildCode], { stdio: \"inherit\" });",
    "const deadline = Date.now() + 5000;",
    "while (!fs.existsSync(" + JSON.stringify(readyPath) + ") && Date.now() < deadline) {",
    "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);",
    "}",
    "Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 30000);",
  ].join("\n");
  fs.writeFileSync(helperScript, helperCode);

  try {
    let error;
    try {
      await runBoundedProcessCommand(
        process.execPath,
        [helperScript],
        { timeout: 600, graceMs: 100 },
      );
    } catch (err) {
      error = err;
    }

    assert.ok(error, "Expected bounded command to time out");
    assert.match(error.message, /timed out after 600ms/);
    assert.ok(fs.existsSync(readyPath), "Grandchild ready flag must exist, proving grandchild was alive");

    await new Promise((resolve, reject) => {
      const client = net.createConnection(socketPath);
      client.on("connect", () => {
        client.end();
        reject(new Error("Grandchild socket listener is unexpectedly still running"));
      });
      client.on("error", () => {
        resolve();
      });
    });
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});
test("descendant cleanup on buffer overflow using unix socket fixture", async () => {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "bounded-overflow-test-"));
  const socketPath = path.join(tempDir, "test.sock");
  const readyPath = path.join(tempDir, "ready.flag");
  const helperScript = path.join(tempDir, "helper.js");

  const helperCode = [
    "import { spawn } from \"node:child_process\";",
    "import fs from \"node:fs\";",
    "const grandchildCode = `",
    "import net from \"node:net\";",
    "import fs from \"node:fs\";",
    "const server = net.createServer((c) => c.end(\"alive\"));",
    "server.listen(" + JSON.stringify(socketPath) + ", () => {",
    "  fs.writeFileSync(" + JSON.stringify(readyPath) + ", \"ready\");",
    "});",
    "setInterval(() => {}, 10000);",
    "`;",
    "const grandchild = spawn(process.execPath, [\"--input-type=module\", \"-e\", grandchildCode], { stdio: \"inherit\" });",
    "const deadline = Date.now() + 5000;",
    "while (!fs.existsSync(" + JSON.stringify(readyPath) + ") && Date.now() < deadline) {",
    "  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 50);",
    "}",
    "while (true) {",
    "  process.stdout.write('a'.repeat(1024));",
    "}",
  ].join("\n");
  fs.writeFileSync(helperScript, helperCode);

  try {
    let error;
    try {
      await runBoundedProcessCommand(
        process.execPath,
        [helperScript],
        { maxBuffer: 2048, timeout: 10000, graceMs: 100 },
      );
    } catch (err) {
      error = err;
    }

    assert.ok(error, "Expected buffer overflow error");
    assert.match(error.message, /stdout exceeded buffer limit of 2048 bytes/);
    assert.ok(fs.existsSync(readyPath), "Grandchild ready flag must exist, proving grandchild was alive");

    await new Promise((resolve, reject) => {
      const client = net.createConnection(socketPath);
      client.on("connect", () => {
        client.end();
        reject(new Error("Grandchild socket listener is unexpectedly still running after buffer overflow"));
      });
      client.on("error", () => {
        resolve();
      });
    });
  } finally {
    fs.rmSync(tempDir, { force: true, recursive: true });
  }
});
test("kills process group on stderr buffer overflow", async () => {
  let error;
  try {
    await runBoundedProcessCommand(
      process.execPath,
      ["-e", "while(true) { process.stderr.write('b'.repeat(1024)); }"],
      { maxBuffer: 2048, timeout: 5000, graceMs: 50 },
    );
  } catch (err) {
    error = err;
  }
  assert.ok(error, "Expected buffer overflow error");
  assert.match(error.message, /stderr exceeded buffer limit of 2048 bytes/);
});

test("separates stdout and stderr without cross-contamination", async () => {
  const result = await runBoundedProcessCommand(
    process.execPath,
    [
      "-e",
      "process.stdout.write('OUT_DATA\\n'); process.stderr.write('ERR_DATA\\n');",
    ],
    { timeout: 5000 },
  );
  assert.equal(result.status, 0);
  assert.equal(result.stdout.trim(), "OUT_DATA");
  assert.equal(result.stderr.trim(), "ERR_DATA");
});

test("returns non-zero exit status on normal command failure", async () => {
  const result = await runBoundedProcessCommand(
    process.execPath,
    ["-e", "process.stderr.write('fatal error\\n'); process.exit(42);"],
    { timeout: 5000 },
  );
  assert.equal(result.status, 42);
  assert.equal(result.stderr.trim(), "fatal error");
});

test("sanitizes diagnostics and local paths", () => {
  assert.equal(sanitizeDiagnostics("/Users/dst/dev/p/package.json failed"), "[path] failed");
  assert.equal(sanitizeDiagnostics("/tmp/a/b/c error"), "[path] error");
  const longText = "x".repeat(600);
  const sanitized = sanitizeDiagnostics(longText, 500);
  assert.equal(sanitized.length, 503);
  assert.ok(sanitized.endsWith("..."));
});

test("terminateProcessGroup skips SIGKILL when process group exits during SIGTERM grace", async () => {
  const originalKill = process.kill;
  const recordedCalls = [];
  const syntheticPid = 42424;
  const isPosix = process.platform !== "win32";
  const expectedTarget = isPosix ? -syntheticPid : syntheticPid;

  process.kill = (target, signal) => {
    recordedCalls.push({ target, signal });
    if (signal === 0) {
      const err = new Error("kill ESRCH");
      err.code = "ESRCH";
      throw err;
    }
  };

  try {
    await terminateProcessGroup(syntheticPid, true, 10);
    assert.deepEqual(recordedCalls, [
      { target: expectedTarget, signal: "SIGTERM" },
      { target: expectedTarget, signal: 0 },
    ]);
    assert.equal(
      recordedCalls.some((call) => call.signal === "SIGKILL"),
      false,
      "SIGKILL must not be sent when existence check returns ESRCH after SIGTERM",
    );
  } finally {
    process.kill = originalKill;
  }
});

test("terminateProcessGroup returns immediately when initial SIGTERM throws ESRCH", async () => {
  const originalKill = process.kill;
  const recordedCalls = [];
  const syntheticPid = 42424;
  const isPosix = process.platform !== "win32";
  const expectedTarget = isPosix ? -syntheticPid : syntheticPid;

  process.kill = (target, signal) => {
    recordedCalls.push({ target, signal });
    if (signal === "SIGTERM") {
      const err = new Error("kill ESRCH");
      err.code = "ESRCH";
      throw err;
    }
  };

  try {
    await terminateProcessGroup(syntheticPid, true, 10);
    assert.deepEqual(recordedCalls, [
      { target: expectedTarget, signal: "SIGTERM" },
    ]);
    assert.equal(
      recordedCalls.some((call) => call.signal === 0),
      false,
      "signal-0 probe must not be sent when initial SIGTERM returns ESRCH",
    );
    assert.equal(
      recordedCalls.some((call) => call.signal === "SIGKILL"),
      false,
      "SIGKILL must not be sent when initial SIGTERM returns ESRCH",
    );
  } finally {
    process.kill = originalKill;
  }
});
