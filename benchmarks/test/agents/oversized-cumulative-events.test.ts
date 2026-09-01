import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { createBenchmarkJsonlLineCapture } from "../../src/agents/jsonl-line-capture.ts";
import type { BenchmarkTurnOptions } from "../../src/agents/turn.ts";
import { runBenchmarkAgentTurn } from "../../src/agents/turn.ts";
import { createBenchmarkRecording } from "../../src/harness/recording-lifecycle.ts";
import { allowsCanonicalPAgentEnd } from "../../src/workloads/agent-turn-runner.ts";

const metricEventTypes = new Set(["result"]);

function canonicalAgentEnd(willRetry: boolean): string {
  const escapedText = String.raw`] \" [ \\ nested 😀 café`;
  return `${JSON.stringify({
    type: "agent_end",
    messages: [
      { role: "user", content: [{ type: "text", text: escapedText }], timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "thinking", thinking: escapedText },
          { type: "toolCall", id: "call-1", name: "write", arguments: { matrix: [[escapedText]] } },
          { type: "text", text: escapedText.repeat(8) },
        ],
        api: "openai-completions",
        provider: "fixture",
        model: "fixture-model",
        usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, totalTokens: 2, cost: {} },
        stopReason: "toolUse",
        timestamp: 2,
      },
    ],
    willRetry,
  })}\n`;
}

const agentEnd = canonicalAgentEnd(false);

function command(source: string) {
  return {
    executable: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: process.env,
  };
}

function createLineCapture(maxLineBytes: number) {
  const lines: string[] = [];
  let skipped = 0;
  const capture = createBenchmarkJsonlLineCapture({
    allowCanonicalPAgentEnd: true,
    maxLineBytes,
    onLine: (line) => lines.push(line),
    onOversizedNonMetricLine: () => {
      skipped += 1;
    },
  });
  return { capture, lines, skipped: () => skipped };
}

async function runOutput(output: string, options: BenchmarkTurnOptions = {}) {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-oversized-record-"));
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  try {
    return await runBenchmarkAgentTurn(
      command(`process.stdout.write(${JSON.stringify(output)})`),
      250,
      recording,
      metricEventTypes,
      { outputLimits: { maxLineBytes: 64 }, ...options },
    );
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
}

test("production-shaped agent_end recognition survives every split and both retry suffixes", () => {
  for (const willRetry of [false, true]) {
    const line = canonicalAgentEnd(willRetry).trimEnd();
    for (let split = 0; split <= line.length; split += 1) {
      const state = createLineCapture(64);
      state.capture.append(line.slice(0, split));
      state.capture.append(line.slice(split));
      state.capture.append("\r");
      state.capture.append("\n");
      state.capture.finish();
      assert.equal(state.skipped(), 1, `${willRetry}/${split}`);
      assert.deepEqual(state.lines, [], `${willRetry}/${split}`);
    }
  }
});

test("runner enables cumulative agent_end handling for P only", () => {
  assert.equal(allowsCanonicalPAgentEnd("p"), true);
  for (const agent of ["pi", "codex", "kilo", "agy"] as const) {
    assert.equal(allowsCanonicalPAgentEnd(agent), false, agent);
  }
});

test("CRLF delimiter bytes do not cause an exact-boundary semantic line to overflow", () => {
  const line = JSON.stringify({ type: "result", value: "ok" });
  for (const chunks of [[`${line}\r\n`], [`${line}\r`, "\n"]]) {
    const state = createLineCapture(Buffer.byteLength(line));
    for (const chunk of chunks) state.capture.append(chunk);
    state.capture.finish();
    assert.equal(state.skipped(), 0);
    assert.deepEqual(state.lines, [line]);
  }
});

test("oversized cumulative agent_end stays lossless and preserves later metric ordinals", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-agent-end-"));
  const finalPath = join(root, "turn.jsonl.br");
  const recording = createBenchmarkRecording(finalPath);
  const resultLine = `${JSON.stringify({ type: "result", status: "success" })}\n`;
  const output = `${agentEnd}\n${agentEnd}${resultLine}`;
  try {
    const result = await runBenchmarkAgentTurn(
      command(`process.stdout.write(${JSON.stringify(output)})`),
      5_000,
      recording,
      metricEventTypes,
      { allowCanonicalPAgentEnd: true, outputLimits: { maxLineBytes: 64 } },
    );

    assert.equal(result.code, 0);
    assert.equal(result.error, undefined);
    assert.equal(result.rawEventCount, 3);
    assert.equal(result.metricEventCount, 1);
    assert.deepEqual(JSON.parse(result.stdout), { type: "result", status: "success", benchmarkEventOrdinal: 3 });
    await recording.finalize();
    assert.equal(brotliDecompressSync(readFileSync(finalPath)).toString("utf8"), output);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("the exception rejects wrong producers, duplicate types, semantic records, and missing delimiters", async () => {
  const duplicateType = `{"type":"agent_end","messages":["${"x".repeat(256)}"],"type":"message_end","message":{},"willRetry":false}\n`;
  const cases: Array<{ output: string; options?: BenchmarkTurnOptions }> = [
    { output: agentEnd },
    { output: duplicateType, options: { allowCanonicalPAgentEnd: true } },
    {
      output: `${JSON.stringify({ type: "message_end", message: "x".repeat(256) })}\n`,
      options: { allowCanonicalPAgentEnd: true },
    },
    { output: agentEnd.trimEnd(), options: { allowCanonicalPAgentEnd: true } },
  ];
  for (const scenario of cases) {
    const result = await runOutput(scenario.output, scenario.options);
    assert.match(result.error ?? "", /stdout line exceeded 64 bytes/u);
    assert.equal(result.captureOverflow?.captureName, "stdout line");
  }
});

test("periodic oversized agent_end records do not renew semantic-progress liveness", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-agent-end-liveness-"));
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  try {
    const result = await runBenchmarkAgentTurn(
      command(`const line=${JSON.stringify(agentEnd)}; setInterval(() => process.stdout.write(line), 20);`),
      250,
      recording,
      metricEventTypes,
      {
        allowCanonicalPAgentEnd: true,
        outputLimits: { maxLineBytes: 64 },
        progressEventTypes: metricEventTypes,
        progressGraceMs: 150,
        timeoutMode: "semantic_progress",
      },
    );
    assert.equal(result.timedOut, true);
    assert.equal(result.timeoutKind, "inactivity");
    assert.ok(result.rawEventCount > 0);
    assert.ok(result.elapsedMs < 2_000);
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});
