#!/usr/bin/env node
// Small micro-benchmark: p vs upstream pi on everyday tasks against the same local model.
// Measures wall time, model/tool call counts, "ceremony" tool overhead, and token usage, across
// --reps repetitions with alternating agent order. Pure logic lives in micro-bench-metrics.js
// (kept separate so both files stay under the repo's 300-line cap); see micro-bench.test.js.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  collectAnswerText,
  computeMetrics,
  evaluateSuccess,
  extractRuntimeInfo,
  MATH_TS,
  parseSessionEvents,
  PROMPTS,
  isTurnComplete,
  summarizeResults,
} from "./micro-bench-metrics.js";

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const quote = (s) => `'${s.replaceAll("'", "'\\''")}'`;
const tmux = (...args) => sh("tmux", args);
const capturePane = (session) => tmux("capture-pane", "-t", session, "-p").stdout ?? "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Secondary guard only: the TUI unexpectedly exited back to a bare shell (footer/model gone).
const looksCrashed = (pane, modelId) => !pane.includes(modelId) && /\$\s*$/.test(pane.trimEnd());

function writeFixture(repoDir, buggy) {
  fs.mkdirSync(path.join(repoDir, "src"), { recursive: true });
  fs.mkdirSync(path.join(repoDir, "test"), { recursive: true });
  fs.writeFileSync(path.join(repoDir, "src/math.ts"), MATH_TS(buggy ? "+" : "-"));
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
  fs.writeFileSync(path.join(dir, "models.json"), JSON.stringify(models), { mode: 0o600 });
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

// First-run prompts (budget choice, code-indexing question) precede any session file, so they
// can only be handled by watching the pane; that is the one place pane text is load-bearing.
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

// Primary completion gate is structural (isTurnComplete + idle-ms since the last JSONL write),
// which stays correct while a tool is still executing regardless of what the pane shows. The
// pane is only a secondary guard, used solely to shortcut a hung/crashed session's failure.
async function waitCompletion(session, sessionsDir, modelId, timeoutMs, idleMs = 5000) {
  const start = Date.now();
  let sessionFile;
  while (Date.now() - start < timeoutMs) {
    sessionFile ??= findNewestJsonl(sessionsDir);
    if (sessionFile) {
      const events = parseSessionEvents(fs.readFileSync(sessionFile, "utf8"));
      const idleFor = Date.now() - fs.statSync(sessionFile).mtimeMs;
      if (isTurnComplete(events) && idleFor >= idleMs) return { sessionFile, timedOut: false };
    }
    if (looksCrashed(capturePane(session), modelId)) return { sessionFile, timedOut: true, crashed: true };
    await sleep(1000);
  }
  return { sessionFile, timedOut: true };
}

async function runOnce(agent, prompt, provider, modelId, rep, outDir) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), `micro-bench-${agent.label}-${prompt.id}-`));
  const session = `microbench-${agent.label}-${prompt.id}-r${rep}-${process.pid}`;
  try {
    const repoDir = path.join(root, "repo");
    const agentDir = path.join(root, "agentdir");
    fs.mkdirSync(repoDir, { recursive: true });
    writeFixture(repoDir, !!prompt.buggy);
    buildAgentDir(agentDir, agent.modelsSource, agent.binSource, provider, modelId);

    tmux("new-session", "-d", "-s", session, "-x", "220", "-y", "50", "/bin/bash", "--noprofile", "--norc");
    tmux("send-keys", "-t", session, "-l", `cd ${quote(repoDir)} && ${agent.envVar}=${quote(agentDir)} ${agent.command}`);
    tmux("send-keys", "-t", session, "Enter");

    const ready = await waitReady(session, modelId, 60000);
    let sessionFile;
    let timedOut = !ready;
    let harnessError = !ready;
    let paneSnapshot = ready ? undefined : capturePane(session);
    if (ready) {
      tmux("send-keys", "-t", session, "-l", prompt.text);
      await sleep(200);
      tmux("send-keys", "-t", session, "Enter");
      const completion = await waitCompletion(session, path.join(agentDir, "sessions"), modelId, 300000);
      ({ sessionFile, timedOut } = completion);
      if (completion.crashed) {
        harnessError = true;
        paneSnapshot = capturePane(session);
      }
    }

    const events = sessionFile ? parseSessionEvents(fs.readFileSync(sessionFile, "utf8")) : [];
    const needsExit = prompt.check === "exit" || prompt.check === "agree";
    const testExitCode = ready && needsExit ? sh("node", ["--test"], { cwd: repoDir }).status : undefined;
    const success = ready && evaluateSuccess(prompt, collectAnswerText(events), testExitCode);
    if (paneSnapshot !== undefined) {
      fs.writeFileSync(path.join(outDir, `harness-error-${agent.label}-${prompt.id}-rep${rep}.txt`), paneSnapshot);
    }
    return {
      agent: agent.label,
      prompt: prompt.id,
      rep,
      success,
      timedOut,
      harnessError,
      ...computeMetrics(events),
      ...extractRuntimeInfo(events),
    };
  } finally {
    tmux("kill-session", "-t", session);
    fs.rmSync(root, { recursive: true, force: true });
  }
}

const statusLabel = (r) => (r.harnessError ? "harness-error" : r.success ? "yes" : r.timedOut ? "timeout" : "no");

function toMarkdownTable(cols, rows) {
  return [cols, cols.map(() => "---"), ...rows].map((r) => `| ${r.join(" | ")} |`).join("\n");
}

function toDetailTable(results) {
  const cols = ["Agent", "Prompt", "Rep", "Status", "Wall(s)", "Model calls", "Tool calls", "Ceremony", "1st req in-tok", "Total tok"];
  const rows = results.map((r) => [
    r.agent, r.prompt, r.rep + 1, statusLabel(r), r.wallSeconds.toFixed(1), r.modelCalls, r.toolCalls, r.ceremonyCalls, r.firstRequestInputTokens, r.totalTokens,
  ]);
  return toMarkdownTable(cols, rows);
}

function toSummaryTable(results) {
  const cols = ["Agent", "Prompt", "Reps", "Successes", "Median wall(s)", "Min wall(s)", "Max wall(s)", "Median tok"];
  const rows = summarizeResults(results).map((s) => [
    s.agent, s.prompt, s.reps, s.successes, s.medianWall.toFixed(1), s.minWall.toFixed(1), s.maxWall.toFixed(1), s.medianTokens,
  ]);
  return toMarkdownTable(cols, rows);
}

function parseReps(argv) {
  const i = argv.indexOf("--reps");
  const n = i === -1 ? Number.NaN : Number.parseInt(argv[i + 1], 10);
  return Number.isFinite(n) && n > 0 ? n : 3;
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
    {
      label: "p",
      envVar: "P_CODING_AGENT_DIR",
      command: `${quote(path.join(repoRoot, "p-test.sh"))} --thinking medium`,
      modelsSource: path.join(os.homedir(), ".p/agent/models.json"),
      binSource: path.join(os.homedir(), ".p/agent/bin"),
    },
    {
      // pi's isolated-dir env var name: dist/config.js derives ENV_AGENT_DIR as
      // `${APP_NAME.toUpperCase()}_CODING_AGENT_DIR`, and APP_NAME is `pkg.piConfig?.name || "pi"`
      // (/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent/dist/config.js:401,406).
      // The installed pi package.json's piConfig only sets configDir (no `name`), so APP_NAME is
      // "pi" and ENV_AGENT_DIR is "PI_CODING_AGENT_DIR".
      label: "pi",
      envVar: "PI_CODING_AGENT_DIR",
      command: "pi --thinking medium",
      modelsSource: path.join(os.homedir(), ".pi/agent/models.json"),
      binSource: path.join(os.homedir(), ".pi/agent/bin"),
    },
  ];
  const reps = parseReps(process.argv.slice(2));
  const outDir = fs.mkdtempSync(path.join(os.tmpdir(), "p-micro-bench-"));

  const results = [];
  for (const prompt of PROMPTS) {
    for (let rep = 0; rep < reps; rep++) {
      const order = rep % 2 === 0 ? agents : [...agents].reverse();
      for (const agent of order) {
        console.error(`Running ${agent.label} / prompt ${prompt.id} / rep ${rep + 1}...`);
        try {
          const result = await runOnce(agent, prompt, provider, modelId, rep, outDir);
          console.error(`  resolved ${result.provider ?? "?"}/${result.model ?? "?"} @ ${result.thinking ?? "?"}`);
          results.push(result);
        } catch (error) {
          console.error(`  failed: ${error instanceof Error ? error.message : String(error)}`);
          results.push({ agent: agent.label, prompt: prompt.id, rep, success: false, timedOut: false, harnessError: true, modelCalls: 0, toolCalls: 0, ceremonyCalls: 0, firstRequestInputTokens: 0, totalTokens: 0, wallSeconds: 0, error: String(error) });
        }
      }
    }
  }

  fs.writeFileSync(path.join(outDir, "results.json"), JSON.stringify(results, undefined, 2));
  console.log(toDetailTable(results));
  console.log(`\n${toSummaryTable(results)}`);
  console.log(`\nResults dir: ${outDir}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
