import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliDecompressSync } from "node:zlib";
import { runBenchmarkAgentTurn } from "../../src/agents/turn.ts";
import { DEFAULT_BENCHMARK_OUTPUT_LIMITS } from "../../src/harness/output-capture.ts";
import { createBenchmarkRecording } from "../../src/harness/recording-lifecycle.ts";
import { createPRecordingMetricsAccumulator } from "../../src/workloads/recording-metrics.ts";

const pMetricEventTypes = new Set(["message_end", "tool_execution_end", "tool_execution_start", "turn_end"]);
const pairCount = 520;
const resultPayloadBytes = 32 * 1024;

function command(source: string) {
  return {
    executable: process.execPath,
    args: ["-e", source],
    cwd: process.cwd(),
    env: process.env,
  };
}

function toolStart(index: number) {
  return {
    type: "tool_execution_start",
    toolCallId: `call-${index}`,
    toolName: "fixture_tool",
    args: { index },
  };
}

function toolEnd(index: number, payload: string) {
  return {
    type: "tool_execution_end",
    toolCallId: `call-${index}`,
    toolName: "fixture_tool",
    result: { content: [{ type: "text", text: payload }] },
    isError: index % 100 === 0,
    executed: true,
  };
}

const finalMessage = {
  type: "message_end",
  message: {
    role: "assistant",
    content: [{ type: "text", text: "AFTER_LEGACY_METRIC_LIMIT" }],
    responseModel: "fixture-model",
    usage: { input: 11, output: 7, cacheRead: 3, cacheWrite: 2, totalTokens: 23 },
    stopReason: "stop",
  },
};
const finalTurn = { type: "turn_end", message: finalMessage.message, toolResults: [] };

function expectedRawStream(): string {
  const payload = "x".repeat(resultPayloadBytes);
  const lines: string[] = [];
  for (let index = 0; index < pairCount; index += 1) {
    lines.push(JSON.stringify(toolStart(index)), JSON.stringify(toolEnd(index, payload)));
  }
  lines.push(JSON.stringify(finalMessage), JSON.stringify(finalTurn));
  return `${lines.join("\n")}\n`;
}

test(
  "many individually bounded P metrics cross 16 MiB without retaining aggregate payload text",
  { timeout: 60_000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "p-benchmark-metric-aggregate-"));
    const finalPath = join(root, "turn.jsonl.br");
    const recording = createBenchmarkRecording(finalPath);
    const expectedRaw = expectedRawStream();
    assert.ok(Buffer.byteLength(expectedRaw) > DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxMetricBytes);
    assert.ok(
      Buffer.byteLength(`${JSON.stringify(toolEnd(0, "x".repeat(resultPayloadBytes)))}\n`) <
        DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxLineBytes,
    );

    const source = `
    const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
    const payload = "x".repeat(${resultPayloadBytes});
    for (let index = 0; index < ${pairCount}; index += 1) {
      emit({ type: "tool_execution_start", toolCallId: "call-" + index, toolName: "fixture_tool", args: { index } });
      emit({
        type: "tool_execution_end",
        toolCallId: "call-" + index,
        toolName: "fixture_tool",
        result: { content: [{ type: "text", text: payload }] },
        isError: index % 100 === 0,
        executed: true,
      });
    }
    emit(${JSON.stringify(finalMessage)});
    emit(${JSON.stringify(finalTurn)});
  `;
    const metricsAccumulator = createPRecordingMetricsAccumulator();

    try {
      const result = await runBenchmarkAgentTurn(command(source), 30_000, recording, pMetricEventTypes, {
        onMetricEvent: (event) => metricsAccumulator.observe(event),
        retainMetricOutput: false,
      });
      assert.equal(result.error, undefined);
      assert.equal(result.captureOverflow, undefined);
      assert.equal(result.code, 0);
      assert.equal(result.rawEventCount, pairCount * 2 + 2);
      assert.equal(result.metricEventCount, pairCount * 2 + 2);
      assert.equal(result.stdout, "");

      const metrics = metricsAccumulator.snapshot();
      assert.equal(metrics.eventCount, pairCount * 2 + 2);
      assert.equal(metrics.toolCalls, pairCount);
      assert.equal(metrics.toolErrors, 6);
      assert.equal(metrics.toolNames.fixture_tool, pairCount);
      assert.equal(metrics.turns, 1);
      assert.equal(metrics.assistantMessages, 1);
      assert.equal(metrics.finalText, "AFTER_LEGACY_METRIC_LIMIT");
      assert.deepEqual(metrics.usage, { input: 11, output: 7, cacheRead: 3, cacheWrite: 2, totalTokens: 23 });

      await recording.finalize();
      const archivedRaw = brotliDecompressSync(readFileSync(finalPath));
      assert.equal(archivedRaw.byteLength, Buffer.byteLength(expectedRaw));
      assert.equal(
        createHash("sha256").update(archivedRaw).digest("hex"),
        createHash("sha256").update(expectedRaw).digest("hex"),
      );
    } finally {
      await recording.abort();
      rmSync(root, { recursive: true, force: true });
    }
  },
);

test("one valid metric record above 1 MiB remains fail-closed", { timeout: 60_000 }, async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-single-metric-line-"));
  const recording = createBenchmarkRecording(join(root, "turn.jsonl.br"));
  try {
    const result = await runBenchmarkAgentTurn(
      command(`
        process.stdout.write(JSON.stringify({ type: "message_end", message: { role: "assistant", content: [{ type: "text", text: "x".repeat(${DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxLineBytes}) }] } }) + "\\n");
        setInterval(() => {}, 1000);
      `),
      10_000,
      recording,
      pMetricEventTypes,
      { failureKillGraceMs: 50 },
    );
    assert.match(result.error ?? "", /stdout line exceeded 1048576 bytes/u);
    assert.equal(result.captureOverflow?.captureName, "stdout line");
    assert.equal(result.captureOverflow?.limitBytes, DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxLineBytes);
    assert.ok((result.captureOverflow?.observedBytesAtLeast ?? 0) > DEFAULT_BENCHMARK_OUTPUT_LIMITS.maxLineBytes);
    assert.equal(result.signal, "SIGTERM");
  } finally {
    await recording.abort();
    rmSync(root, { recursive: true, force: true });
  }
});

test("malformed canonical-looking agent_end is not silently discarded", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-malformed-agent-end-"));
  const malformedMessages = [
    `[${"x".repeat(256)}]`,
    `[${"1 2,".repeat(64)}null]`,
    `[${"1e+,".repeat(64)}null]`,
    `[${"{],".repeat(64)}null]`,
    `[${"null,,".repeat(64)}null]`,
    `[${'"key":'.repeat(64)}null]`,
  ];
  try {
    for (const [index, messages] of malformedMessages.entries()) {
      const finalPath = join(root, `turn-${index}.jsonl.br`);
      const recording = createBenchmarkRecording(finalPath);
      const malformed = `{"type":"agent_end","messages":${messages},"willRetry":false}\n`;
      try {
        const result = await runBenchmarkAgentTurn(
          command(`process.stdout.write(${JSON.stringify(malformed)})`),
          5_000,
          recording,
          pMetricEventTypes,
          { allowCanonicalPAgentEnd: true, outputLimits: { maxLineBytes: 64 } },
        );
        assert.match(result.error ?? "", /stdout line exceeded 64 bytes/u, messages.slice(0, 32));
        assert.equal(result.captureOverflow?.captureName, "stdout line");
        await recording.finalize();
        assert.equal(brotliDecompressSync(readFileSync(finalPath)).toString("utf8"), malformed);
      } finally {
        await recording.abort();
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
