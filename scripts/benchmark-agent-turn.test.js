import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";

import { runBenchmarkAgentTurn } from "./benchmark-agent-turn.js";
import { createBenchmarkRecording } from "./benchmark-recording-lifecycle.js";

const metricEventTypes = new Set(["result"]);

function command(source) {
  return {
    executable: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: process.env,
  };
}

async function runFailedTurn(source, options) {
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
      command('process.stdout.write(Buffer.alloc(2 * 1024 * 1024, 97));'),
      5_000,
      recording,
      metricEventTypes,
      { outputLimits: { maxLineBytes: 3 * 1024 * 1024 } },
    );
    assert.equal(result.code, 0);
    await recording.finalize();
    const decoded = brotliDecompressSync(readFileSync(finalPath));
    assert.equal(decoded.length, 2 * 1024 * 1024);
    assert.equal(decoded.every((byte) => byte === 97), true);
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
    assert.match(result.error, /stdout line exceeded 64 bytes/);
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
    assert.ok(result.captureOverflow?.observedBytesAtLeast > 64 * 1024);
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
    assert.ok(result.elapsedMs < 1_000);
    await recording.finalize();
    const decoded = brotliDecompressSync(readFileSync(finalPath));
    assert.equal(decoded.length, 64 * 1024);
    assert.equal(decoded.every((byte) => byte === 120), true);
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
    assert.match(result.error, /simulated disk full/);
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
      source: 'process.stdout.write(JSON.stringify({type:"result",value:"x".repeat(1024)})+"\\n"); setInterval(() => {}, 1000);',
      options: { outputLimits: { maxLineBytes: 2_048, maxMetricBytes: 64 } },
      pattern: /metric output exceeded 64 bytes/,
    },
  ];
  for (const scenario of cases) {
    const result = await runFailedTurn(scenario.source, scenario.options);
    assert.match(result.error, scenario.pattern);
    assert.equal(result.captureOverflow?.kind, "capture_overflow");
    assert.equal(result.signal, "SIGTERM");
    assert.ok(result.elapsedMs < 2_000);
  }
});
