// Pure parsing/metrics/success-evaluation logic for scripts/micro-bench.js, split out to keep
// each file under the repo's 300-line cap. Covered directly by scripts/micro-bench.test.js.

export const CEREMONY_TOOLS = new Set([
  "update_session_state",
  "record_task_verification",
  "finish_work",
  "read_rules",
  "list_skills",
  "read_skills",
  "mark_session_progress",
]);

// finish_work is p's explicit task-terminator tool: its own description is "explicitly
// terminate the task with the final status and user-visible summary" (see
// packages/coding-agent/src/core/agent-session/agentsession-methods/tool-activation.ts:142
// and packages/coding-agent/src/core/tools/finish-work.ts). A p turn that ends in a
// finish_work toolResult (no further assistant message) is genuinely over; pi has no such tool.
export const TERMINAL_TOOLS = new Set(["finish_work"]);
const TERMINAL_STOP_REASONS = new Set(["stop", "length", "error", "aborted"]); // not "toolUse"

export const MATH_TS = (op) =>
  `export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function sub(a: number, b: number): number {\n  return a ${op} b;\n}\n`;
export const SUB_LINE = MATH_TS("-")
  .split("\n")
  .findIndex((l) => l.includes("export function sub")) + 1;

export const PROMPTS = [
  { id: 1, text: "What does src/math.ts export? Answer in one line.", check: "text", patterns: [/\badd\b/i, /\bsub\b/i] },
  {
    id: 2,
    text: "Find where the function sub is defined. Reply with file:line.",
    check: "text",
    patterns: [new RegExp(`math\\.ts:?\\s*${SUB_LINE}\\b`, "i")],
  },
  { id: 3, text: "Run the tests and tell me if they pass.", check: "agree" },
  { id: 4, text: "Fix the bug in sub (it adds instead of subtracting).", check: "exit", buggy: true },
  { id: 5, text: "Add a mul(a,b) function to src/math.ts with a test, and run the tests.", check: "exit" },
];

/** Parse a session JSONL file's text into events, skipping unparseable (e.g. partial) lines. */
export function parseSessionEvents(text) {
  const events = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed));
    } catch {}
  }
  return events;
}

const messagesOf = (events) => events.filter((e) => e.type === "message").map((e) => e.message);
const assistantMessages = (messages) => messages.filter((m) => m.role === "assistant");

/**
 * Sessions are a tree (each event carries id/parentId; see session-recording): a retried or
 * regenerated turn can leave an earlier sibling event with a toolCall that will never receive
 * its toolResult, permanently on a branch nobody continues. Walking back from the last-written
 * event via parentId reconstructs only the actually-active path, so an abandoned sibling's
 * dangling toolCall doesn't block completion detection forever. Falls back to the flat event
 * list when events don't carry id/parentId (e.g. synthetic fixtures without branching).
 */
function activeEventPath(events) {
  const byId = new Map();
  for (const e of events) if (typeof e?.id === "string") byId.set(e.id, e);
  const path = [];
  const seen = new Set();
  let current = events.at(-1);
  while (current && typeof current.id === "string" && !seen.has(current.id)) {
    path.push(current);
    seen.add(current.id);
    current = current.parentId != null ? byId.get(current.parentId) : undefined;
  }
  return path.length > 0 ? path.reverse() : events;
}

/**
 * Structural end-of-turn signal (no pane/idle heuristics): true once every toolCall issued on
 * the active path has a matching toolResult AND the path's last message is either an assistant
 * message with a terminal stopReason (stop/length/error/aborted), or a toolResult from a
 * designated terminal tool.
 */
export function isTurnComplete(events, terminalTools = TERMINAL_TOOLS) {
  const messages = messagesOf(activeEventPath(events));
  const pending = new Set();
  for (const m of messages) {
    if (m.role === "assistant") {
      for (const c of m.content ?? []) if (c.type === "toolCall") pending.add(c.id);
    } else if (m.role === "toolResult") {
      pending.delete(m.toolCallId);
    }
  }
  if (pending.size > 0) return false; // a tool call is still executing / awaiting its result
  const last = messages.at(-1);
  if (!last) return false;
  if (last.role === "assistant") return TERMINAL_STOP_REASONS.has(last.stopReason);
  if (last.role === "toolResult") return terminalTools.has(last.toolName);
  return false;
}

/**
 * Classify a poll of waitCompletion's state (pure, so the 90s-stall/5s-idle thresholds and the
 * boundary conditions are unit-testable without real files or tmux):
 * - "complete": the turn is structurally over and the file has been idle long enough to trust it.
 * - "stalled": the turn is NOT over, but nothing has been written for a long time regardless —
 *   almost certainly stuck (a hung tool, an orphaned branch, a dead process), not "still working".
 * - "pending": still legitimately in progress; keep waiting (up to the caller's own timeout).
 */
export function classifyWaitState(isComplete, idleForMs, idleMs, stallMs) {
  if (isComplete && idleForMs >= idleMs) return "complete";
  if (!isComplete && idleForMs >= stallMs) return "stalled";
  return "pending";
}

/** Compute per-run metrics (calls, ceremony overhead, tokens, wall time) from parsed events. */
export function computeMetrics(events, ceremonyTools = CEREMONY_TOOLS) {
  const assistants = assistantMessages(messagesOf(events));
  let toolCalls = 0;
  let ceremonyCalls = 0;
  let totalTokens = 0;
  for (const m of assistants) {
    for (const c of m.content ?? []) {
      if (c.type !== "toolCall") continue;
      toolCalls++;
      if (ceremonyTools.has(c.name)) ceremonyCalls++;
    }
    const u = m.usage;
    if (u) totalTokens += u.totalTokens ?? (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
  }
  const first = Date.parse(events[0]?.timestamp);
  const last = Date.parse(events.at(-1)?.timestamp);
  const wallSeconds = Number.isFinite(first) && Number.isFinite(last) ? Math.max(0, (last - first) / 1000) : 0;
  return { modelCalls: assistants.length, toolCalls, ceremonyCalls, firstRequestInputTokens: assistants[0]?.usage?.input ?? 0, totalTokens, wallSeconds };
}

/** All assistant text plus finish_work summaries across the session (agent-shape agnostic). */
export function collectAnswerText(events) {
  const parts = [];
  for (const m of assistantMessages(messagesOf(events))) {
    for (const c of m.content ?? []) {
      if (c.type === "text" && c.text) parts.push(c.text);
      if (c.type === "toolCall" && c.name === "finish_work" && c.arguments) parts.push(JSON.stringify(c.arguments));
    }
  }
  return parts.join("\n");
}

/** The resolved provider/model/thinking-level the session actually ran with. */
export function extractRuntimeInfo(events) {
  const modelChange = events.find((e) => e.type === "model_change");
  const thinkingChange = events.find((e) => e.type === "thinking_level_change");
  return { provider: modelChange?.provider, model: modelChange?.modelId, thinking: thinkingChange?.thinkingLevel };
}

/**
 * Whether the answer text claims the tests passed (true), failed (false), or is unclear
 * (undefined). Realistic answers routinely mention BOTH words at once ("2 passed, 0 failed",
 * the node:test runner's own "pass 2 / fail 0" summary lines) without being ambiguous, so a
 * naive "both words present => ambiguous" check is wrong far more often than not. Order of
 * precedence: an explicit negation of "pass"/"fail" wins; then a failure count neutralized to
 * zero ("0 failed", "no failing") doesn't count as a fail claim; then any remaining "fail"
 * mention wins over "pass" (a real test run's exit code is nonzero if ANY test failed); only
 * with no fail evidence at all do we fall back to whether "pass" was mentioned.
 */
export function parseClaimedPass(text) {
  const normalized = text.toLowerCase();
  if (/\b(?:does not|doesn't|did not|didn't|do not|don't)\s+pass\b/.test(normalized)) return false;
  if (/\b(?:does not|doesn't|did not|didn't|do not|don't)\s+fail\b/.test(normalized)) return true;
  const neutralized = normalized
    .replace(/\b(?:0|no|zero|none)\s+fail\w*/g, "")
    .replace(/\bfail\w*\s*:?\s*(?:0|none|zero)\b/g, "");
  if (/\bfail\w*\b/.test(neutralized)) return false;
  return /\bpass\w*\b/.test(normalized) ? true : undefined;
}

/** Task success: exit-code check, claim-vs-reality agreement, or keyword patterns. */
export function evaluateSuccess(prompt, answerText, testExitCode) {
  if (prompt.check === "exit") return testExitCode === 0;
  if (prompt.check === "agree") {
    const claimed = parseClaimedPass(answerText);
    return claimed !== undefined && claimed === (testExitCode === 0);
  }
  return prompt.patterns.every((p) => p.test(answerText));
}

/** Full diagnostic bundle behind evaluateSuccess's boolean, for evidence/results.json. */
export function explainOutcome(prompt, answerText, testExitCode) {
  const success = evaluateSuccess(prompt, answerText, testExitCode);
  const actual = testExitCode === undefined ? undefined : testExitCode === 0;
  if (prompt.check === "exit") {
    return { success, claimed: undefined, actual, reason: `node --test exited ${testExitCode}` };
  }
  if (prompt.check === "agree") {
    const claimed = parseClaimedPass(answerText);
    const reason =
      claimed === undefined
        ? "answer did not make a clear pass/fail claim"
        : `claimed ${claimed ? "pass" : "fail"}, tests really ${actual ? "passed" : "failed"} (${success ? "agree" : "disagree"})`;
    return { success, claimed, actual, reason };
  }
  const missing = prompt.patterns.filter((p) => !p.test(answerText)).map((p) => p.source);
  const reason = success ? "all expected patterns matched" : `missing pattern(s): ${missing.join(", ")}`;
  return { success, claimed: undefined, actual: undefined, reason };
}

function median(nums) {
  if (nums.length === 0) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Group per-rep results by (agent, prompt) and report success rate plus median/min/max. */
export function summarizeResults(results) {
  const groups = new Map();
  for (const r of results) {
    const key = `${r.agent}|${r.prompt}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(r);
  }
  const rows = [...groups.values()].map((group) => {
    const walls = group.map((r) => r.wallSeconds);
    return {
      agent: group[0].agent,
      prompt: group[0].prompt,
      reps: group.length,
      successes: group.filter((r) => r.success).length,
      medianWall: median(walls),
      minWall: Math.min(...walls),
      maxWall: Math.max(...walls),
      medianTokens: median(group.map((r) => r.totalTokens)),
    };
  });
  return rows.sort((a, b) => a.prompt - b.prompt || a.agent.localeCompare(b.agent));
}
