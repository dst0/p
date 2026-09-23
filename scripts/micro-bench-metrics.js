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
 * Structural end-of-turn signal (no pane/idle heuristics): true once every issued toolCall has
 * a matching toolResult AND the last message is either an assistant message with a terminal
 * stopReason (stop/length/error/aborted), or a toolResult from a designated terminal tool.
 */
export function isTurnComplete(events, terminalTools = TERMINAL_TOOLS) {
  const messages = messagesOf(events);
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

/** Whether the answer text claims the tests passed (true), failed (false), or is unclear (undefined). */
export function parseClaimedPass(text) {
  const hasFail = /\bfail\w*\b/i.test(text);
  const hasPass = /\bpass\w*\b/i.test(text);
  if (hasFail === hasPass) return undefined; // neither mentioned, or both (ambiguous)
  return hasPass;
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
