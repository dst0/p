#!/usr/bin/env node
// Small micro-benchmark: p vs upstream pi on everyday tasks against the same local model.
// Measures wall time, model/tool call counts, "ceremony" tool overhead, and token usage.
// See scripts/micro-bench.test.js for coverage of the pure parsing/metrics functions below.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export const CEREMONY_TOOLS = new Set([
  "update_session_state",
  "record_task_verification",
  "finish_work",
  "read_rules",
  "list_skills",
  "read_skills",
  "mark_session_progress",
]);

export const PROMPTS = [
  { id: 1, text: "What does src/math.ts export? Answer in one line.", check: "text", patterns: [/\badd\b/i, /\bsub\b/i] },
  { id: 2, text: "Find where the function sub is defined. Reply with file:line.", check: "text", patterns: [/math\.ts/i, /\b5\b/] },
  { id: 3, text: "Run the tests and tell me if they pass.", check: "text", patterns: [/\bpass/i] },
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

const assistantMessages = (events) =>
  events.filter((e) => e.type === "message" && e.message?.role === "assistant").map((e) => e.message);

/** Compute per-run metrics (calls, ceremony overhead, tokens, wall time) from parsed events. */
export function computeMetrics(events, ceremonyTools = CEREMONY_TOOLS) {
  const assistants = assistantMessages(events);
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
  for (const m of assistantMessages(events)) {
    for (const c of m.content ?? []) {
      if (c.type === "text" && c.text) parts.push(c.text);
      if (c.type === "toolCall" && c.name === "finish_work" && c.arguments) parts.push(JSON.stringify(c.arguments));
    }
  }
  return parts.join("\n");
}

/** Task success: exit-code check for edit prompts, keyword patterns for answer-only prompts. */
export function evaluateSuccess(prompt, answerText, testExitCode) {
  return prompt.check === "exit" ? testExitCode === 0 : prompt.patterns.every((p) => p.test(answerText));
}

// ---- Orchestration (drives a real tmux session; not unit-tested, see test file for the above) ----

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const tmux = (...args) => sh("tmux", args);
const capturePane = (session) => tmux("capture-pane", "-t", session, "-p").stdout ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function writeFixture(repoDir, buggy) {
  fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(repoDir, "test"), { recursive: true });
  const op = buggy ? "+" : "-";
  fs.writeFileSync(
    path.join(repoDir, "src/math.ts"),
    `export function add(a: number, b: number): number {\n  return a + b;\n}\n\nexport function sub(a: number, b: number): number {\n  return a ${op} b;\n}\n`,
  );
  fs.writeFileSync(
    path.join(repoDir, "test/math.test.ts"),
    `import { test } from "node:test";\nimport assert from "node:assert/strict";\nimport { add, sub } from "../src/math.ts";\n\ntest("add", () => {\n  assert.equal(add(2, 3), 5);\n});\n\ntest("sub", () => {\n  assert.equal(sub(5, 3), 2);\n});\n`,
  );
  fs.writeFileSync(path.join(repoDir, "package.json"), JSON.stringify({ name: "fixture", type: "module", scripts: { test: "node --test" } }));
}

// Reuse the user's already-downloaded helper binaries (e.g. fd/rg under <agentDir>/bin) so a
// fresh isolated agent dir doesn't redundantly re-download them on every single run.
function buildAgentDir(dir, modelsSource, binSource, provider, modelId) {
  fs.mkdirSync(dir, { recursive: true });
  const models = JSON.parse(fs.readFileSync(modelsSource, "utf8"));
  const list = models.providers?.[provider]?.models ?? [];
  if (!list.some((m) => m.id === modelId) && list.length > 0) list.push({ ...list.at(-1), id: modelId, name: modelId });
  fs.writeFileSync(path.join(dir, "models.json"), JSON.stringify(models));
  fs.writeFileSync(path.join(dir, "settings.json"), JSON.stringify({ defaultProvider: provider, defaultModel: modelId }));
  if (binSource && fs.existsSync(binSource)) fs.cpSync(binSource, path.join(dir, "bin"), { recursive: true });
}

function findNewestJsonl(sessionsDir) {
  let best;
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(p);
      else if (entry.name.endsWith(".jsonl")) {
        const mtimeMs = fs.statSync(p).mtimeMs;
        if (!best || mtimeMs > best.mtimeMs) best = { path: p, mtimeMs };
      }
    }
  };
  if (fs.existsSync(sessionsDir)) walk(sessionsDir);
  return best?.path;
}

// First-run prompts (budget choice, code-indexing question) are handled here by watching the
// pane; once the footer shows the model id and no spinner/download is active, we're ready.
async function waitReady(session, modelId, timeoutMs) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const pane = capturePane(session);
    if (/Choose your task budget/.test(pane)) {
      tmux("send-keys", "-t", session, "Enter");
    } else if (/Code indexing/.test(pane)) {
      tmux("send-keys", "-t", session, "Down");
      await sleep(300);
      tmux("send-keys", "-t", session, "Enter");
    } else if (pane.includes(modelId) && !/Working|Downloading/.test(pane)) {
      return true;
    }
    await sleep(700);
  }
  return false;
}

// Completion = session file idle >=5s with no busy spinner in the pane (confirmed for 2s), since
// the file only grows once a full message is written and a single generation can itself be slow.
async function waitCompletion(session, sessionsDir, timeoutMs) {
  const start = Date.now();
  let stableSince;
  let sessionFile;
  while (Date.now() - start < timeoutMs) {
    sessionFile ??= findNewestJsonl(sessionsDir);
    const busy = /Working|Downloading/.test(capturePane(session));
    const idleMs = sessionFile ? Date.now() - fs.statSync(sessionFile).mtimeMs : 0;
    if (sessionFile && !busy && idleMs >= 5000) {
      stableSince ??= Date.now();
      if (Date.now() - stableSince >= 2000) return { sessionFile, timedOut: false };
    } else {
      stableSince = undefined;
    }
    await sleep(1000);
  }
  return { sessionFile, timedOut: true };
}

async function runOnce(agent, prompt, provider, modelId) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `micro-bench-${agent.label}-${prompt.id}-`));
  const repoDir = path.join(root, "repo");
  const agentDir = path.join(root, "agentdir");
  fs.mkdirSync(repoDir, { recursive: true });
  writeFixture(repoDir, !!prompt.buggy);
  buildAgentDir(agentDir, agent.modelsSource, agent.binSource, provider, modelId);

  const session = `microbench-${agent.label}-${prompt.id}-${process.pid}`;
  tmux("kill-session", "-t", session);
  tmux("new-session", "-d", "-s", session, "-x", "220", "-y", "50", "/bin/bash", "--noprofile", "--norc");
  tmux("send-keys", "-t", session, "-l", `cd ${quote(repoDir)} && ${agent.envVar}=${quote(agentDir)} ${agent.command}`);
  tmux("send-keys", "-t", session, "Enter");

  const ready = await waitReady(session, modelId, 60000);
  let sessionFile;
  let timedOut = !ready;
  if (ready) {
    tmux("send-keys", "-t", session, "-l", prompt.text);
    await sleep(200);
    tmux("send-keys", "-t", session, "Enter");
    ({ sessionFile, timedOut } = await waitCompletion(session, path.join(agentDir, "sessions"), 300000));
  }
  tmux("kill-session", "-t", session);

  const events = sessionFile ? parseSessionEvents(fs.readFileSync(sessionFile, "utf8")) : [];
  const testExitCode = ready && prompt.check === "exit" ? sh("node", ["--test"], { cwd: repoDir }).status : undefined;
  const success = ready && evaluateSuccess(prompt, collectAnswerText(events), testExitCode);
  const result = { agent: agent.label, prompt: prompt.id, success, timedOut, ...computeMetrics(events) };
  fs.rmSync(root, { recursive: true, force: true });
  return result;
}

function toTable(results) {
  const cols = ["Agent", "Prompt", "Success", "Wall(s)", "Model calls", "Tool calls", "Ceremony", "1st req in-tok", "Total tok"];
  const rows = results.map((r) => [
    r.agent, r.prompt, r.success ? "yes" : r.timedOut ? "timeout" : "no", r.wallSeconds.toFixed(1),
    r.modelCalls, r.toolCalls, r.ceremonyCalls, r.firstRequestInputTokens, r.totalTokens,
  ]);
  return [cols, cols.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

async function main() {
  const repoRoot = path.resolve(import.meta.dirname, "..");
  const globalSettingsPath = path.join(os.homedir(), ".p/agent/settings.json");
  if (!fs.existsSync(globalSettingsPath)) {
    console.error(`Cannot read ${globalSettingsPath}; is the model endpoint configured?`);
    process.exitCode = 1;
    return;
  }
  const { defaultProvider: provider, defaultModel: modelId } = JSON.parse(fs.readFileSync(globalSettingsPath, "utf8"));
  const agents = [
    { label: "p", envVar: "P_CODING_AGENT_DIR", command: quote(path.join(repoRoot, "p-test.sh")), modelsSource: path.join(os.homedir(), ".p/agent/models.json"), binSource: path.join(os.homedir(), ".p/agent/bin") },
    { label: "pi", envVar: "PI_CODING_AGENT_DIR", command: "pi", modelsSource: path.join(os.homedir(), ".pi/agent/models.json"), binSource: path.join(os.homedir(), ".pi/agent/bin") },
  ];

  const results = [];
  for (const agent of agents) {
    for (const prompt of PROMPTS) {
      console.error(`Running ${agent.label} / prompt ${prompt.id}...`);
      try {
        results.push(await runOnce(agent, prompt, provider, modelId));
      } catch (error) {
        console.error(`  failed: ${error instanceof Error ? error.message : String(error)}`);
        results.push({ agent: agent.label, prompt: prompt.id, success: false, timedOut: false, modelCalls: 0, toolCalls: 0, ceremonyCalls: 0, firstRequestInputTokens: 0, totalTokens: 0, wallSeconds: 0, error: String(error) });
      }
    }
  }

  const outFile = path.join(os.tmpdir(), `p-micro-bench-${Date.now()}.json`);
  fs.writeFileSync(outFile, JSON.stringify(results, undefined, 2));
  console.log(toTable(results));
  console.log(`\nJSON results: ${outFile}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
