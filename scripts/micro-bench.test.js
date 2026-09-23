import assert from "node:assert/strict";
import test from "node:test";
import { CEREMONY_TOOLS, collectAnswerText, computeMetrics, evaluateSuccess, parseSessionEvents } from "./micro-bench.js";

const T0 = "2026-09-23T00:00:00.000Z";
const T1 = "2026-09-23T00:00:42.000Z";

function assistantEvent(timestamp, content, usage) {
  return { type: "message", timestamp, message: { role: "assistant", content, usage, stopReason: content.some((c) => c.type === "toolCall") ? "toolUse" : "stop" } };
}

const FIXTURE_EVENTS = [
  { type: "session", timestamp: T0, id: "s1" },
  { type: "message", timestamp: T0, message: { role: "user", content: [{ type: "text", text: "What does src/math.ts export?" }] } },
  assistantEvent(T0, [{ type: "toolCall", id: "1", name: "read", arguments: {} }], { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120 }),
  { type: "message", timestamp: T0, message: { role: "toolResult", toolCallId: "1", toolName: "read", content: [] } },
  // No totalTokens field: computeMetrics must fall back to input+output+cacheRead+cacheWrite.
  assistantEvent(T0, [{ type: "toolCall", id: "2", name: "update_session_state", arguments: {} }], { input: 50, output: 10, cacheRead: 100, cacheWrite: 0 }),
  { type: "message", timestamp: T0, message: { role: "toolResult", toolCallId: "2", toolName: "update_session_state", content: [] } },
  assistantEvent(T0, [{ type: "text", text: "It exports add and sub." }], { input: 10, output: 5, totalTokens: 15 }),
  assistantEvent(T1, [{ type: "toolCall", id: "3", name: "finish_work", arguments: { summary: "add and sub, done" } }], { input: 5, output: 5, totalTokens: 10 }),
  { type: "message", timestamp: T1, message: { role: "toolResult", toolCallId: "3", toolName: "finish_work", content: [] } },
];

const FIXTURE_TEXT = `${FIXTURE_EVENTS.map((e) => JSON.stringify(e)).join("\n")}\n{not valid json\n`;

test("parseSessionEvents parses valid lines and skips malformed ones", () => {
  const events = parseSessionEvents(FIXTURE_TEXT);
  assert.equal(events.length, FIXTURE_EVENTS.length);
  assert.equal(events[0].type, "session");
});

test("computeMetrics counts calls, ceremony overhead, tokens (with fallback), and wall time", () => {
  const metrics = computeMetrics(FIXTURE_EVENTS);
  assert.equal(metrics.modelCalls, 4);
  assert.equal(metrics.toolCalls, 3);
  assert.equal(metrics.ceremonyCalls, 2); // update_session_state + finish_work
  assert.equal(metrics.firstRequestInputTokens, 100);
  assert.equal(metrics.totalTokens, 120 + 160 + 15 + 10); // 160 = fallback sum for the untotaled message
  assert.equal(metrics.wallSeconds, 42);
});

test("computeMetrics honors a custom ceremony tool set", () => {
  const metrics = computeMetrics(FIXTURE_EVENTS, new Set(["read"]));
  assert.equal(metrics.ceremonyCalls, 1);
});

test("computeMetrics defaults to CEREMONY_TOOLS and returns zeros for an empty session", () => {
  assert.ok(CEREMONY_TOOLS.has("finish_work"));
  assert.deepEqual(computeMetrics([]), { modelCalls: 0, toolCalls: 0, ceremonyCalls: 0, firstRequestInputTokens: 0, totalTokens: 0, wallSeconds: 0 });
});

test("collectAnswerText joins assistant text and finish_work summaries, skipping other tool calls", () => {
  const text = collectAnswerText(FIXTURE_EVENTS);
  assert.match(text, /It exports add and sub\./);
  assert.match(text, /add and sub, done/);
  assert.doesNotMatch(text, /update_session_state/);
});

test("evaluateSuccess requires every pattern to match for text-checked prompts", () => {
  const prompt = { check: "text", patterns: [/add/i, /sub/i] };
  assert.equal(evaluateSuccess(prompt, "exports add and sub", undefined), true);
  assert.equal(evaluateSuccess(prompt, "exports add only", undefined), false);
});

test("evaluateSuccess uses the fixture test exit code for exit-checked prompts", () => {
  const prompt = { check: "exit" };
  assert.equal(evaluateSuccess(prompt, "irrelevant text", 0), true);
  assert.equal(evaluateSuccess(prompt, "irrelevant text", 1), false);
});
