import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import test from "node:test";
import { runAgentTask } from "../../src/workloads/agent-turn-runner.ts";
import type { RunnerOptions } from "../../src/workloads/runner-options.ts";
import type { BenchmarkTask } from "../../src/workloads/task-definition.ts";

test("active work may outlive the nominal budget when it finishes in the same turn", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-task-inactivity-"));
  const workspace = join(root, "workspace");
  const config = join(root, "config");
  const recording = join(root, "recordings", "p.jsonl.br");
  const fakeCli = join(root, "fake-p.js");
  mkdirSync(workspace);
  mkdirSync(config);
  mkdirSync(join(root, "recordings"));
  writeFileSync(fakeCli, fakePSource());
  try {
    const result = await runAgentTask(
      "p",
      runnerOptions(fakeCli),
      task,
      config,
      workspace,
      recording,
      1,
      performance.now() + 10_000,
    );

    assert.equal(result.code, 0);
    assert.equal(result.timedOut, false);
    assert.equal(result.nudges, 0);
    assert.equal(Number(readFileSync(join(workspace, "invocations.txt"), "utf8")), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an over-budget completed turn does not start another nudge", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-task-over-budget-"));
  const workspace = join(root, "workspace");
  const config = join(root, "config");
  const recording = join(root, "recordings", "p.jsonl.br");
  const fakeCli = join(root, "fake-p.js");
  mkdirSync(workspace);
  mkdirSync(config);
  mkdirSync(join(root, "recordings"));
  writeFileSync(fakeCli, pendingPSource());
  try {
    const result = await runAgentTask(
      "p",
      runnerOptions(fakeCli),
      task,
      config,
      workspace,
      recording,
      1,
      performance.now() + 10_000,
    );

    assert.equal(result.code, undefined);
    assert.equal(result.timedOut, false);
    assert.equal(result.nudges, 0);
    assert.match(result.error ?? "", /nominal task budget/u);
    assert.equal(Number(readFileSync(join(workspace, "invocations.txt"), "utf8")), 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

const task: BenchmarkTask = {
  id: "activity-timeout",
  timeoutSeconds: 1,
  maxScore: 1,
  description: "Exercise inactivity timeout semantics",
  files: {},
  prompt: "Complete the fixture.",
  verify: () => ({ passed: true, score: 1, maxScore: 1, checks: [] }),
};

function runnerOptions(pCli: string): RunnerOptions {
  return {
    model: "provider/model",
    pCli,
    projectInstructionProbe: "/unused/probe.js",
    projectInstructionsFile: "/unused/AGENTS.md",
    taskVerificationMode: "evidence",
    agents: ["p"],
    modelsFile: "/unused/models.json",
    piVersion: "unused",
    kiloVersion: "unused",
    kiloConfig: "/unused/kilo.jsonc",
    kiloStartupTimeoutSeconds: 1,
    codexConfig: "/unused/codex.toml",
    runs: 1,
    timeoutSeconds: 1,
    maxRuntimeSeconds: 10,
  };
}

function fakePSource(): string {
  return `
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const count = existsSync("invocations.txt") ? Number(readFileSync("invocations.txt", "utf8")) : 0;
writeFileSync("invocations.txt", String(count + 1));
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
let progress = 0;
const timer = setInterval(() => {
  emit({ type: "message_update", assistantMessageEvent: { type: "gen_progress", tokens: progress } });
  progress += 1;
  if (progress === 12) {
    clearInterval(timer);
    writeFileSync("finish_notes.md", "Implementation and terminal verification complete.\\n");
    emit({ type: "tool_execution_start", toolCallId: "finish", toolName: "finish_work", args: { status: "success", verification_token: "token" } });
    emit({ type: "tool_execution_end", toolCallId: "finish", toolName: "finish_work", isError: false, result: { content: [{ type: "text", text: "done" }] } });
  }
}, 100);
`;
}

function pendingPSource(): string {
  return `
const { writeFileSync } = require("node:fs");
writeFileSync("invocations.txt", "1");
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
let progress = 0;
const timer = setInterval(() => {
  emit({ type: "message_update", assistantMessageEvent: { type: "gen_progress", tokens: progress } });
  progress += 1;
  if (progress === 12) {
    clearInterval(timer);
    writeFileSync("finish_notes.md", "Implementation complete; terminal verification is pending.\\n");
  }
}, 100);
`;
}
