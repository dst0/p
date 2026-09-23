import assert from "node:assert/strict";
import test from "node:test";
import {
  CEREMONY_TOOLS,
  classifyWaitState,
  collectAnswerText,
  computeMetrics,
  evaluateSuccess,
  explainOutcome,
  extractRuntimeInfo,
  isTurnComplete,
  parseClaimedPass,
  parseSessionEvents,
  PROMPTS,
  summarizeResults,
} from "./micro-bench-metrics.js";

const T0 = "2026-09-23T00:00:00.000Z";
const T1 = "2026-09-23T00:00:42.000Z";

function assistantEvent(timestamp, content, usage, stopReason) {
  return {
    type: "message",
    timestamp,
    message: { role: "assistant", content, usage, stopReason: stopReason ?? (content.some((c) => c.type === "toolCall") ? "toolUse" : "stop") },
  };
}
const toolResultEvent = (timestamp, toolCallId, toolName) => ({ type: "message", timestamp, message: { role: "toolResult", toolCallId, toolName, content: [] } });

// Shaped like a real p session: ends in a finish_work toolResult, not a final assistant "stop".
const P_SHAPED_EVENTS = [
  { type: "session", timestamp: T0, id: "s1" },
  { type: "message", timestamp: T0, message: { role: "user", content: [{ type: "text", text: "What does src/math.ts export?" }] } },
  assistantEvent(T0, [{ type: "toolCall", id: "1", name: "read", arguments: {} }], { input: 100, output: 20, cacheRead: 0, cacheWrite: 0, totalTokens: 120 }),
  toolResultEvent(T0, "1", "read"),
  // No totalTokens field: computeMetrics must fall back to input+output+cacheRead+cacheWrite.
  assistantEvent(T0, [{ type: "toolCall", id: "2", name: "update_session_state", arguments: {} }], { input: 50, output: 10, cacheRead: 100, cacheWrite: 0 }),
  toolResultEvent(T0, "2", "update_session_state"),
  assistantEvent(T0, [{ type: "text", text: "It exports add and sub." }], { input: 10, output: 5, totalTokens: 15 }),
  assistantEvent(T1, [{ type: "toolCall", id: "3", name: "finish_work", arguments: { summary: "add and sub, done" } }], { input: 5, output: 5, totalTokens: 10 }),
  toolResultEvent(T1, "3", "finish_work"),
];

// Shaped like a real pi session: no ceremony, ends directly in an assistant "stop" message.
const PI_SHAPED_EVENTS = [
  { type: "model_change", timestamp: T0, provider: "mini-pc-11450", modelId: "mini-pc/qwen3.8-27b-iq4xs" },
  { type: "thinking_level_change", timestamp: T0, thinkingLevel: "medium" },
  { type: "message", timestamp: T0, message: { role: "user", content: [{ type: "text", text: "What does src/math.ts export?" }] } },
  assistantEvent(T0, [{ type: "toolCall", id: "1", name: "read", arguments: {} }], { input: 50, output: 10, totalTokens: 60 }),
  toolResultEvent(T0, "1", "read"),
  assistantEvent(T1, [{ type: "text", text: "It exports add and sub." }], { input: 10, output: 5, totalTokens: 15 }),
];

const FIXTURE_TEXT = `${P_SHAPED_EVENTS.map((e) => JSON.stringify(e)).join("\n")}\n{not valid json\n`;

test("parseSessionEvents parses valid lines and skips malformed ones", () => {
  const events = parseSessionEvents(FIXTURE_TEXT);
  assert.equal(events.length, P_SHAPED_EVENTS.length);
  assert.equal(events[0].type, "session");
});

test("isTurnComplete recognizes a p-shaped session ending in a finish_work toolResult", () => {
  assert.equal(isTurnComplete(P_SHAPED_EVENTS), true);
});

test("isTurnComplete recognizes a pi-shaped session ending in an assistant stop", () => {
  assert.equal(isTurnComplete(PI_SHAPED_EVENTS), true);
});

test("isTurnComplete is false while a tool call has no matching toolResult yet, regardless of idle time", () => {
  const midToolExecution = P_SHAPED_EVENTS.slice(0, -1); // drop the finish_work toolResult
  assert.equal(isTurnComplete(midToolExecution), false);
});

test("isTurnComplete is false when the last event is a toolResult from a non-terminal tool", () => {
  const midLoop = P_SHAPED_EVENTS.slice(0, 4); // ends after the "read" toolResult
  assert.equal(isTurnComplete(midLoop), false);
});

test("isTurnComplete honors a custom terminal-tools set", () => {
  const midLoop = P_SHAPED_EVENTS.slice(0, 4); // ends after the "read" toolResult
  assert.equal(isTurnComplete(midLoop, new Set(["read"])), true);
});

test("isTurnComplete follows the active branch via parentId, ignoring an abandoned sibling's dangling toolCall", () => {
  // A retried/regenerated turn: msgA (id a1) issues a toolCall that never gets a toolResult
  // because it was abandoned in favor of msgB (id a2), a SIBLING with the same parentId, which
  // is the real, already-finished branch. Written in file order: root, msgA, msgB.
  const root = { type: "session", timestamp: T0, id: "root" };
  const msgA = { type: "message", timestamp: T0, id: "a1", parentId: "root", message: { role: "assistant", content: [{ type: "toolCall", id: "orphan", name: "bash", arguments: {} }], stopReason: "toolUse" } };
  const msgB = { type: "message", timestamp: T1, id: "a2", parentId: "root", message: { role: "assistant", content: [{ type: "text", text: "Done." }], stopReason: "stop" } };
  const branched = [root, msgA, msgB];
  assert.equal(isTurnComplete(branched), true, "the active leaf (msgB) is complete; msgA's toolCall is on a dead branch");

  // Sanity: without the id/parentId tree, a flat reading would wrongly see "orphan" as pending
  // forever. Confirm that's specifically what activeEventPath's tree-walk fixes, by checking the
  // same content without ids falls back to flat (and would disagree if msgA came after msgB).
  const flatOrderMattersCase = [{ type: "message", timestamp: T0, message: msgB.message }, { type: "message", timestamp: T1, message: msgA.message }];
  assert.equal(isTurnComplete(flatOrderMattersCase), false, "without ids, the flat last-event (msgA's toolCall) is genuinely pending");
});

test("classifyWaitState distinguishes complete, stalled, and still-pending", () => {
  assert.equal(classifyWaitState(true, 5000, 5000, 90000), "complete");
  assert.equal(classifyWaitState(true, 4999, 5000, 90000), "pending", "not idle long enough yet, even though complete");
  assert.equal(classifyWaitState(false, 89999, 5000, 90000), "pending", "not stalled yet");
  assert.equal(classifyWaitState(false, 90000, 5000, 90000), "stalled");
  assert.equal(classifyWaitState(false, 1000, 5000, 90000), "pending");
});

test("computeMetrics counts calls, ceremony overhead, tokens (with fallback), and wall time", () => {
  const metrics = computeMetrics(P_SHAPED_EVENTS);
  assert.equal(metrics.modelCalls, 4);
  assert.equal(metrics.toolCalls, 3);
  assert.equal(metrics.ceremonyCalls, 2); // update_session_state + finish_work
  assert.equal(metrics.firstRequestInputTokens, 100);
  assert.equal(metrics.totalTokens, 120 + 160 + 15 + 10); // 160 = fallback sum for the untotaled message
  assert.equal(metrics.wallSeconds, 42);
});

test("computeMetrics honors a custom ceremony tool set and defaults to zeros for an empty session", () => {
  assert.equal(computeMetrics(P_SHAPED_EVENTS, new Set(["read"])).ceremonyCalls, 1);
  assert.ok(CEREMONY_TOOLS.has("finish_work"));
  assert.deepEqual(computeMetrics([]), { modelCalls: 0, toolCalls: 0, ceremonyCalls: 0, firstRequestInputTokens: 0, totalTokens: 0, wallSeconds: 0 });
});

test("collectAnswerText joins assistant text and finish_work summaries, skipping other tool calls", () => {
  const text = collectAnswerText(P_SHAPED_EVENTS);
  assert.match(text, /It exports add and sub\./);
  assert.match(text, /add and sub, done/);
  assert.doesNotMatch(text, /update_session_state/);
});

test("extractRuntimeInfo reads the first model_change/thinking_level_change events", () => {
  assert.deepEqual(extractRuntimeInfo(PI_SHAPED_EVENTS), { provider: "mini-pc-11450", model: "mini-pc/qwen3.8-27b-iq4xs", thinking: "medium" });
  assert.deepEqual(extractRuntimeInfo([]), { provider: undefined, model: undefined, thinking: undefined });
});

test("parseClaimedPass reads realistic agent answers, including ones mentioning both words", () => {
  // node:test's own summary style ("pass N" / "fail N") and paraphrases of it are NOT ambiguous
  // just because both words appear — a real run's exit code is nonzero iff fail count > 0.
  assert.equal(parseClaimedPass("All tests pass."), true);
  assert.equal(parseClaimedPass("2 tests failed: sub returns 5…"), false);
  assert.equal(parseClaimedPass("Tests fail"), false);
  assert.equal(parseClaimedPass("✖ 1 failing"), false);
  assert.equal(parseClaimedPass("The test suite does not pass"), false, "negation of pass must not read as a pass claim");
  assert.equal(parseClaimedPass("Ran node --test: 2 passed, 0 failed."), true, "a neutralized zero-fail count is not a fail claim");
  assert.equal(parseClaimedPass("ℹ pass 2\nℹ fail 0"), true, "raw node:test summary lines");
  assert.equal(parseClaimedPass("All tests passed, no failures."), true);
  assert.equal(parseClaimedPass("1 passed, 1 failed"), false, "any real non-zero failure count wins over a pass mention");
  assert.equal(parseClaimedPass("I ran the tests."), undefined, "no clear claim either way");
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

test("evaluateSuccess for agree-checked prompts requires the claim to match the real exit code", () => {
  const prompt = { check: "agree" };
  assert.equal(evaluateSuccess(prompt, "All tests pass.", 0), true, "claimed pass, really passed");
  assert.equal(evaluateSuccess(prompt, "All tests pass.", 1), false, "claimed pass, really failed");
  assert.equal(evaluateSuccess(prompt, "The tests failed.", 1), true, "claimed fail, really failed");
  assert.equal(evaluateSuccess(prompt, "The tests failed.", 0), false, "claimed fail, really passed");
  assert.equal(evaluateSuccess(prompt, "2 tests failed: sub returns 5", 1), true, "realistic fail claim, really failed");
  assert.equal(evaluateSuccess(prompt, "Ran node --test: 2 passed, 0 failed.", 0), true, "realistic pass claim, really passed");
  assert.equal(evaluateSuccess(prompt, "I ran node --test.", 0), false, "no clear claim never counts as agreement");
});

test("explainOutcome reports claimed/actual/reason for each check kind", () => {
  const exitOutcome = explainOutcome({ check: "exit" }, "irrelevant", 1);
  assert.deepEqual(exitOutcome, { success: false, claimed: undefined, actual: false, reason: "node --test exited 1" });

  const agreeOutcome = explainOutcome({ check: "agree" }, "All tests pass.", 1);
  assert.equal(agreeOutcome.success, false);
  assert.equal(agreeOutcome.claimed, true);
  assert.equal(agreeOutcome.actual, false);
  assert.match(agreeOutcome.reason, /claimed pass, tests really failed \(disagree\)/);

  const unclearOutcome = explainOutcome({ check: "agree" }, "I ran the tests.", 0);
  assert.equal(unclearOutcome.claimed, undefined);
  assert.match(unclearOutcome.reason, /did not make a clear pass\/fail claim/);

  const textOutcome = explainOutcome({ check: "text", patterns: [/add/i, /sub/i] }, "exports add only", undefined);
  assert.equal(textOutcome.success, false);
  assert.match(textOutcome.reason, /missing pattern\(s\)/);
});

test("prompt 2's file:line pattern requires math.ts and the line number to be adjacent", () => {
  const [pattern] = PROMPTS.find((p) => p.id === 2).patterns;
  assert.match("src/math.ts:5", pattern);
  assert.match("The function sub is defined in math.ts: 5", pattern);
  assert.doesNotMatch("math.ts has a function on line 5, mentioned elsewhere", pattern); // not adjacent
  assert.doesNotMatch("src/math.ts:6", pattern); // wrong line
});

test("summarizeResults groups by (agent, prompt) and reports success count plus median/min/max wall time", () => {
  const results = [
    { agent: "p", prompt: 1, success: true, wallSeconds: 10, totalTokens: 100 },
    { agent: "p", prompt: 1, success: false, wallSeconds: 20, totalTokens: 200 },
    { agent: "p", prompt: 1, success: true, wallSeconds: 30, totalTokens: 300 },
    { agent: "pi", prompt: 1, success: true, wallSeconds: 5, totalTokens: 50 },
  ];
  const [pRow, piRow] = summarizeResults(results);
  assert.deepEqual(pRow, { agent: "p", prompt: 1, reps: 3, successes: 2, medianWall: 20, minWall: 10, maxWall: 30, medianTokens: 200 });
  assert.deepEqual(piRow, { agent: "pi", prompt: 1, reps: 1, successes: 1, medianWall: 5, minWall: 5, maxWall: 5, medianTokens: 50 });
});
