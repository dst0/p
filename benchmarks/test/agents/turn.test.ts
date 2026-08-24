import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import type { BenchmarkTurnOptions } from "../../src/agents/turn.ts";
import { runBenchmarkAgentTurn } from "../../src/agents/turn.ts";
import { BenchmarkInterruptedError } from "../../src/harness/interruption.ts";
import { createBenchmarkRecording } from "../../src/harness/recording-lifecycle.ts";

const metricEventTypes = new Set(["result"]);

function command(source: string) {
  return {
    executable: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: process.env,
  };
}

async function runFailedTurn(source: string, options: BenchmarkTurnOptions) {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-cap-"));
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  try {
    return await runBenchmarkAgentTurn(command(source), 10_000, recording, metricEventTypes, options);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
}

test("records child stdout bytes exactly while decoding a separate parser path", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-bytes-"));
  const finalPath = join(root, "turn.jsonl.br");
  const expected = Buffer.from([0x66, 0x80, 0x0a, 0x7b, 0x7d, 0x0a]);
  const recording = createBenchmarkRecording(finalPath);
  try {
    const result = await runBenchmarkAgentTurn(
      command(`process.stdout.write(Buffer.from([${[...expected].join(",")}]))`),
      5_000,
      recording,
      metricEventTypes,
    );
    assert.equal(result.code, 0);
    await recording.finalize();
    assert.deepEqual(brotliDecompressSync(readFileSync(finalPath)), expected);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("pipes large output with backpressure and preserves every byte", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-backpressure-"));
  const finalPath = join(root, "turn.jsonl.br");
  const recording = createBenchmarkRecording(finalPath);
  try {
    const result = await runBenchmarkAgentTurn(
      command("process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 97));"),
      5_000,
      recording,
      metricEventTypes,
      { outputLimits: { maxLineBytes: 3 * 1024 * 1024 } },
    );
    assert.equal(result.code, 0);
    await recording.finalize();
    const decoded = brotliDecompressSync(readFileSync(finalPath));
    assert.equal(decoded.length, 2 * 1024 * 1024);
    assert.equal(
      decoded.every((byte) => byte === 97),
      true,
    );
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("line bounds apply per JSONL record instead of the containing OS chunk", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-lines-"));
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  try {
    const result = await runBenchmarkAgentTurn(
      command('process.stdout.write("{}\\n".repeat(100));'),
      5_000,
      recording,
      metricEventTypes,
      { outputLimits: { maxLineBytes: 4 } },
    );
    assert.equal(result.code, 0);
    assert.equal(result.error, undefined);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("output overflow terminates and waits for the child with an explicit failure", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-overflow-"));
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  try {
    const result = await runBenchmarkAgentTurn(
      command('process.stdout.write("x".repeat(1024)); setInterval(() => {}, 1000);'),
      10_000,
      recording,
      metricEventTypes,
      { outputLimits: { maxLineBytes: 64 }, turn: 2 },
    );
    assert.match(result.error ?? "", /stdout line exceeded 64 bytes/);
    assert.deepEqual(result.captureOverflow, {
      kind: "capture_overflow",
      captureName: "stdout line",
      limitBytes: 64,
      observedBytesAtLeast: 1024,
      turn: 2,
    });
    assert.equal(result.signal, "SIGTERM");
    assert.ok(result.elapsedMs < 2_000);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("raw recording overflow publishes a bounded prefix after killing a resistant child", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-recording-cap-"));
  const finalPath = join(root, "turn.jsonl.br");
  const recording = createBenchmarkRecording(finalPath, { maxBytes: 64 * 1024 });
  try {
    const result = await runBenchmarkAgentTurn(
      command(`
        process.on("SIGTERM", () => {});
        const chunk = Buffer.alloc(16 * 1024, 120);
        setInterval(() => { for (let index = 0; index < 8; index += 1) process.stdout.write(chunk); }, 0);
      `),
      10_000,
      recording,
      metricEventTypes,
      { failureKillGraceMs: 50, outputLimits: { maxLineBytes: 1024 * 1024 }, turn: 3 },
    );
    assert.equal(result.signal, "SIGKILL");
    assert.equal(result.captureOverflow?.kind, "capture_overflow");
    assert.equal(result.captureOverflow?.captureName, "raw recording");
    assert.equal(result.captureOverflow?.limitBytes, 64 * 1024);
    assert.ok((result.captureOverflow?.observedBytesAtLeast ?? 0) > 64 * 1024);
    assert.equal(result.captureOverflow?.turn, 3);
    assert.deepEqual(result.recordingCapture, {
      format: "chunked-brotli-v1",
      archiveBytes: 0,
      archiveLimitBytes: 256 * 1024 * 1024,
      bytes: 64 * 1024,
      limitBytes: 64 * 1024,
      partial: true,
      storageBytes: 64 * 1024,
      storageLimitBytes: 256 * 1024 * 1024,
    });
    assert.ok(result.elapsedMs < 2_000);
    await recording.finalize();
    const decoded = brotliDecompressSync(readFileSync(finalPath));
    assert.equal(decoded.length, 64 * 1024);
    assert.equal(
      decoded.every((byte) => byte === 120),
      true,
    );
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("recording write failure terminates and waits for the child immediately", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-write-error-"));
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  try {
    setTimeout(() => recording.stream.destroy(new Error("simulated disk full")), 50);
    const result = await runBenchmarkAgentTurn(
      command('setInterval(() => process.stdout.write("{}\\n"), 10);'),
      10_000,
      recording,
      metricEventTypes,
    );
    assert.match(result.error ?? "", /simulated disk full/);
    assert.equal(result.signal, "SIGTERM");
    assert.ok(result.elapsedMs < 2_000);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("raw probe, stderr, and metric captures each fail at an explicit bound", async () => {
  const cases = [
    {
      source: 'process.stdout.write("x".repeat(1024)); setInterval(() => {}, 1000);',
      options: { collectRawStdout: true, outputLimits: { maxLineBytes: 2_048, maxRawStdoutBytes: 64 } },
      pattern: /raw stdout exceeded 64 bytes/,
    },
    {
      source: 'process.stderr.write("x".repeat(1024)); setInterval(() => {}, 1000);',
      options: { outputLimits: { maxStderrBytes: 64 } },
      pattern: /stderr exceeded 64 bytes/,
    },
    {
      source:
        'process.stdout.write(JSON.stringify({type:"result",value:"x".repeat(1024)})+"\\n"); setInterval(() => {}, 1000);',
      options: { outputLimits: { maxLineBytes: 2_048, maxMetricBytes: 64 } },
      pattern: /metric output exceeded 64 bytes/,
    },
  ];
  for (const scenario of cases) {
    const result = await runFailedTurn(scenario.source, scenario.options);
    assert.match(result.error ?? "", scenario.pattern);
    assert.equal(result.captureOverflow?.kind, "capture_overflow");
    assert.equal(result.signal, "SIGTERM");
    assert.ok(result.elapsedMs < 2_000);
  }
});

test("project-instruction turns use IPC once and do not expose it to grandchildren", async () => {
  const receipt = "a".repeat(64);
  const source = `
    const { spawnSync } = require("node:child_process");
    process.send({ schemaVersion: 1, kind: "project-instruction-startup-proof", receiptSha256: ${JSON.stringify(receipt)}, proof: { requestedMode: "compiled", sourceSha256: "b".repeat(64), systemPromptSha256: "c".repeat(64), systemPromptBytes: 10, hasLegacyMarker: false, hasCompiledMarker: true, compiledInstructionsInjected: true, sourceLoaded: true, legacySourceInjected: false, legacyInjectedBlockHashes: [], legacyExpectedBlockHashes: [] } });
    process.disconnect();
    const grandchild = spawnSync(process.execPath, ["-e", "process.stdout.write(String(typeof process.send))"], { encoding: "utf8" });
    process.stderr.write(grandchild.stdout);
    process.stdout.write(JSON.stringify({ type: "result" }) + "\\n");
  `;
  const result = await runFailedTurn(source, { projectInstructionProofReceipt: receipt });
  assert.equal(result.projectInstructionProof?.requestedMode, "compiled");
  assert.equal(result.stderr, "undefined");
});

test("cooperative interruption kills a resistant agent child before recording cleanup", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-interrupt-"));
  const finalPath = join(root, "turn.jsonl.br");
  const recording = createBenchmarkRecording(finalPath);
  const controller = new AbortController();
  const startedAt = Date.now();
  setTimeout(() => controller.abort(new BenchmarkInterruptedError("SIGINT")), 50);
  try {
    await assert.rejects(
      runBenchmarkAgentTurn(
        command('process.on("SIGTERM", () => {}); setInterval(() => process.stdout.write("{}\\n"), 10);'),
        10_000,
        recording,
        metricEventTypes,
        { signal: controller.signal, failureKillGraceMs: 50 },
      ),
      (error) => error instanceof BenchmarkInterruptedError && error.signalName === "SIGINT",
    );
    await recording.abort();
    assert.equal(existsSync(recording.activePath), false);
    assert.equal(existsSync(finalPath), false);
    assert.ok(Date.now() - startedAt < 2_000);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("termination rejection stays secondary to an agent-turn interruption", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-turn-termination-rejection-"));
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  const controller = new AbortController();
  const interruption = new BenchmarkInterruptedError("SIGTERM");
  const cleanupError = new Error("kill cleanup failed");
  try {
    const result = runBenchmarkAgentTurn(
      command("setTimeout(() => process.exit(0), 50)"),
      10_000,
      recording,
      metricEventTypes,
      {
        signal: controller.signal,
        terminateProcessTree: async () => {
          throw cleanupError;
        },
      },
    );
    controller.abort(interruption);
    await assert.rejects(result, (error) => error === interruption && interruption.cleanupErrors?.[0] === cleanupError);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});
