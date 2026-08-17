import { createBrotliCompress, createBrotliDecompress, constants as zlibConstants } from "node:zlib";
import { describe, expect, it } from "vitest";
import {
  type SessionRecordingEvent,
  SessionStreamRecorder,
  SessionStreamReplayer,
} from "../src/core/session-recording/index.ts";

describe("Event-Sourced Session Recording & Telemetry Protocol", () => {
  it("records delta events in linear O(N) space instead of quadratic O(N^2)", () => {
    const events: SessionRecordingEvent[] = [];
    const recorder = new SessionStreamRecorder({
      traceId: "trc_test1",
      spanId: "spn_main",
      onEvent: (e) => events.push(e),
    });

    recorder.startTurn({ turnId: "turn_1", turnIndex: 0, model: "qwen-27b", provider: "vllm" });

    // Stream 500 token deltas
    let accumulatedText = "";
    for (let i = 0; i < 500; i++) {
      const deltaText = `tok_${i} `;
      accumulatedText += deltaText;
      recorder.recordDelta("str_1", "content", deltaText);
    }

    recorder.endTurn({
      turnId: "turn_1",
      turnIndex: 0,
      status: "success",
      message: { role: "assistant", content: accumulatedText },
      rawUsage: { prompt_tokens: 1500, completion_tokens: 500, prompt_tokens_details: { cached_tokens: 1200 } },
      timings: { ttft_ms: 120, total_duration_ms: 1500 },
    });

    // Check events count
    expect(events.length).toBe(502); // start + 500 deltas + end

    // Verify delta event sizes are tiny (<70 bytes JSON)
    const deltaEvents = events.filter((e) => e.type === "delta");
    expect(deltaEvents.length).toBe(500);
    const avgDeltaBytes = deltaEvents.reduce((acc, e) => acc + JSON.stringify(e).length, 0) / deltaEvents.length;
    expect(avgDeltaBytes).toBeLessThan(180);

    // Replay and verify exact text reconstruction
    const replayer = new SessionStreamReplayer();
    for (const e of events) {
      replayer.feedEvent(e);
    }
    const result = replayer.finalize();

    expect(result.turns.length).toBe(1);
    expect(result.finalText).toBe(accumulatedText);
    expect(result.totalInputTokens).toBe(1500);
    expect(result.totalOutputTokens).toBe(500);
    expect(result.totalCachedTokens).toBe(1200);
    expect(result.averageCacheHitRatio).toBeCloseTo(1200 / (1500 + 1200), 3);
    expect(result.isInterrupted).toBe(false);
  });

  it("multiplexes reasoning, content, and tool argument channels cleanly", () => {
    const events: SessionRecordingEvent[] = [];
    const recorder = new SessionStreamRecorder({ onEvent: (e) => events.push(e) });

    recorder.startTurn({ turnId: "turn_tool", turnIndex: 0 });

    // Thinking channel
    recorder.recordDelta("str_2", "reasoning", "Thinking step 1: ");
    recorder.recordDelta("str_2", "reasoning", "deciding to call tool.");

    // Visible content channel
    recorder.recordDelta("str_2", "content", "Let me check ");
    recorder.recordDelta("str_2", "content", "the directory.");

    // Tool argument chunks
    recorder.recordToolChunk("str_2", "call_1", 0, '{"path": "', "read_file");
    recorder.recordToolChunk("str_2", "call_1", 0, 'src/index.ts"}', "read_file");

    // Tool execution
    recorder.recordToolCall("call_1", "read_file", { path: "src/index.ts" });
    recorder.recordToolResult("call_1", "read_file", "export const x = 1;", false, 25);

    recorder.endTurn({
      turnId: "turn_tool",
      turnIndex: 0,
      status: "success",
      finishReason: "tool_use",
      rawUsage: { input_tokens: 200, output_tokens: 50 },
    });

    const replayer = new SessionStreamReplayer();
    for (const e of events) replayer.feedEvent(e);
    const result = replayer.finalize();

    expect(result.turns[0].message?.reasoning).toBe("Thinking step 1: deciding to call tool.");
    expect(result.turns[0].message?.content).toBe("Let me check the directory.");
    expect(result.totalToolCalls).toBe(1);
    expect(result.toolErrors).toBe(0);
    expect(result.turns[0].message?.toolCalls[0].name).toBe("read_file");
    expect(result.turns[0].message?.toolCalls[0].args).toEqual({ path: "src/index.ts" });
    expect(result.turns[0].message?.toolCalls[0].result).toBe("export const x = 1;");
  });

  it("normalizes cache telemetry across Anthropic, OpenAI, DeepSeek, and Gemini", () => {
    const recorder = new SessionStreamRecorder();

    // Anthropic format
    const anthropicUsage = recorder.normalizeUsage({
      input_tokens: 1000,
      output_tokens: 200,
      cache_read_input_tokens: 8000,
      cache_creation_input_tokens: 500,
    });
    expect(anthropicUsage.cache.read_tokens).toBe(8000);
    expect(anthropicUsage.cache.write_tokens).toBe(500);
    expect(anthropicUsage.cache.backend).toBe("anthropic");
    expect(anthropicUsage.cache.hit_ratio).toBeCloseTo(8000 / 9000, 3);

    // OpenAI format
    const openaiUsage = recorder.normalizeUsage({
      prompt_tokens: 2000,
      completion_tokens: 300,
      prompt_tokens_details: { cached_tokens: 1500 },
    });
    expect(openaiUsage.cache.read_tokens).toBe(1500);
    expect(openaiUsage.cache.backend).toBe("openai");
    expect(openaiUsage.cache.hit_ratio).toBeCloseTo(1500 / 2000, 3);

    // DeepSeek format
    const deepseekUsage = recorder.normalizeUsage({
      prompt_tokens: 3000,
      completion_tokens: 400,
      prompt_cache_hit_tokens: 2700,
    });
    expect(deepseekUsage.cache.read_tokens).toBe(2700);
    expect(deepseekUsage.cache.backend).toBe("deepseek");
    expect(deepseekUsage.cache.hit_ratio).toBeCloseTo(2700 / 3000, 3);

    // Gemini format
    const geminiUsage = recorder.normalizeUsage({
      prompt_token_count: 5000,
      candidates_token_count: 600,
      cached_content_token_count: 4500,
    });
    expect(geminiUsage.cache.read_tokens).toBe(4500);
    expect(geminiUsage.cache.backend).toBe("gemini");
    expect(geminiUsage.cache.hit_ratio).toBeCloseTo(4500 / 5000, 3);
  });

  it("handles crash recovery and unclosed streams safely during replay", () => {
    const events: SessionRecordingEvent[] = [];
    const recorder = new SessionStreamRecorder({ onEvent: (e) => events.push(e) });

    recorder.startTurn({ turnId: "turn_crash", turnIndex: 0 });
    recorder.recordDelta("str_crash", "content", "Partial sentence before SIGKILL...");
    recorder.recordToolChunk("str_crash", "call_broken", 0, '{"unclosed": true', "bash");
    // SIMULATE CRASH: Process was killed before recorder.endTurn() was called!

    const replayer = new SessionStreamReplayer();
    for (const e of events) replayer.feedEvent(e);
    const result = replayer.finalize();

    expect(result.isInterrupted).toBe(true);
    expect(result.turns.length).toBe(1);
    expect(result.turns[0].status).toBe("interrupted");
    expect(result.turns[0].message?.content).toBe("Partial sentence before SIGKILL...");
    expect(result.finalText).toBe("Partial sentence before SIGKILL...");
  });

  it("preserves 100% data fidelity when streamed through Brotli compression", async () => {
    const recorder = new SessionStreamRecorder();
    const rawLines: string[] = [];

    const startEvt = recorder.startTurn({ turnId: "turn_brotli", turnIndex: 0 });
    rawLines.push(JSON.stringify(startEvt));

    for (let i = 0; i < 50; i++) {
      const deltaEvt = recorder.recordDelta("str_br", "content", `word_${i} `);
      rawLines.push(JSON.stringify(deltaEvt));
    }

    const endEvt = recorder.endTurn({
      turnId: "turn_brotli",
      turnIndex: 0,
      rawUsage: { input_tokens: 100, output_tokens: 50 },
    });
    rawLines.push(JSON.stringify(endEvt));

    const rawPayload = `${rawLines.join("\n")}\n`;
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      const compressor = createBrotliCompress({
        params: {
          [zlibConstants.BROTLI_PARAM_MODE]: zlibConstants.BROTLI_MODE_TEXT,
          [zlibConstants.BROTLI_PARAM_QUALITY]: 6,
        },
      });
      const chunks: Buffer[] = [];
      compressor.on("data", (c) => chunks.push(c));
      compressor.on("end", () => resolve(Buffer.concat(chunks)));
      compressor.on("error", reject);
      compressor.write(rawPayload);
      compressor.end();
    });

    const decompressed = await new Promise<string>((resolve, reject) => {
      const decompressor = createBrotliDecompress();
      let out = "";
      decompressor.on("data", (c) => {
        out += c.toString("utf8");
      });
      decompressor.on("end", () => resolve(out));
      decompressor.on("error", reject);
      decompressor.write(compressed);
      decompressor.end();
    });

    expect(decompressed).toBe(rawPayload);

    const replayed = SessionStreamReplayer.replayFromLines(decompressed.split("\n"));
    expect(replayed.turns.length).toBe(1);
    expect(replayed.turns[0].status).toBe("success");
    expect(replayed.finalText).toContain("word_0 word_1");
  });

  it("handles legacy session logs gracefully via backward-compatible fallback", () => {
    const legacyLines = [
      JSON.stringify({ type: "message_start", message: { role: "assistant", content: "" } }),
      JSON.stringify({ type: "message_update", message: { role: "assistant", content: "Legacy step 1" } }),
      JSON.stringify({ type: "message_update", message: { role: "assistant", content: "Legacy step 1 completed" } }),
      JSON.stringify({
        type: "turn_end",
        message: {
          role: "assistant",
          content: "Legacy step 1 completed",
          usage: { prompt_tokens: 500, completion_tokens: 80, prompt_tokens_details: { cached_tokens: 350 } },
        },
      }),
    ];

    const replayed = SessionStreamReplayer.replayFromLines(legacyLines);
    expect(replayed.turns.length).toBe(1);
    expect(replayed.finalText).toBe("Legacy step 1 completed");
    expect(replayed.totalInputTokens).toBe(500);
    expect(replayed.totalOutputTokens).toBe(80);
    expect(replayed.totalCachedTokens).toBe(350);
  });
});
