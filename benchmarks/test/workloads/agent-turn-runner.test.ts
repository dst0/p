import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, test } from "node:test";
import { createAgentTaskCompletionGuard } from "../../src/workloads/agent-task-completion.ts";
import { runAgentTask } from "../../src/workloads/agent-turn-runner.ts";
import type { RunnerOptions } from "../../src/workloads/runner-options.ts";
import type { BenchmarkTask } from "../../src/workloads/task-definition.ts";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

test("P continues past finish_notes until finish_work accepts the verification certificate", async () => {
  const root = temporaryRoot();
  const workspace = join(root, "workspace");
  const config = join(root, "config");
  const recording = join(root, "recordings", "p.jsonl.br");
  mkdirSync(workspace);
  mkdirSync(config);
  mkdirSync(join(root, "recordings"));
  const fakeCli = join(root, "fake-p.js");
  writeFileSync(fakeCli, fakePSource());

  const result = await runAgentTask(
    "p",
    runnerOptions(fakeCli),
    task,
    config,
    workspace,
    recording,
    60,
    performance.now() + 90_000,
  );

  const invocations = readFileSync(join(workspace, "invocations.jsonl"), "utf8")
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line) as { continued: boolean; prompt: string });
  assert.equal(result.nudges, 1);
  assert.equal(result.code, 0);
  assert.equal(result.timedOut, false);
  assert.equal(invocations.length, 2);
  assert.equal(invocations[0]?.continued, false);
  assert.equal(invocations[1]?.continued, true);
  assert.equal(
    invocations[1]?.prompt,
    "finish_notes.md exists, but P has not completed its terminal verification. Complete fresh verification, then call finish_work with the current verification_token.",
  );
});

test("P fails closed when the terminal handshake is still absent after all nudges", async () => {
  const root = temporaryRoot();
  const workspace = join(root, "workspace");
  const config = join(root, "config");
  mkdirSync(workspace);
  mkdirSync(config);
  mkdirSync(join(root, "recordings"));
  const fakeCli = join(root, "always-pending-p.js");
  writeFileSync(fakeCli, alwaysPendingPSource());

  const result = await runAgentTask(
    "p",
    runnerOptions(fakeCli),
    task,
    config,
    workspace,
    join(root, "recordings", "pending.jsonl.br"),
    60,
    performance.now() + 90_000,
  );

  assert.equal(result.nudges, 5);
  assert.equal(result.code, undefined);
  assert.match(result.error ?? "", /terminal completion protocol/u);
  assert.equal(Number(readFileSync(join(workspace, "invocations.txt"), "utf8")), 6);
});

test("finish_notes remains terminal when explicit P task verification is not active", () => {
  assert.equal(createAgentTaskCompletionGuard("p", "off").shouldStop(false, true), true);
  assert.equal(createAgentTaskCompletionGuard("codex", undefined).shouldStop(false, true), true);
  assert.equal(createAgentTaskCompletionGuard("p", undefined).shouldStop(false, true), false);
});

test("P requires a fresh accepted finish after the last marker-free turn", () => {
  const guard = createAgentTaskCompletionGuard("p", "audit");
  guard.observe(finishEvents("stale", true, false));
  assert.equal(guard.shouldStop(false, false), false);
  assert.equal(guard.shouldStop(false, true), false);

  guard.observe(finishEvents("rejected", true, true));
  assert.equal(guard.shouldStop(false, true), false);
  guard.observe(finishEvents("missing-token", false, false));
  assert.equal(guard.shouldStop(false, true), false);

  guard.observe(finishEvents("fresh", true, false));
  assert.equal(guard.shouldStop(false, true), true);
});

test("P does not pair a dangling finish start with an end from a later subprocess turn", () => {
  const guard = createAgentTaskCompletionGuard("p", "evidence");
  guard.observe(
    JSON.stringify({
      type: "tool_execution_start",
      toolCallId: "reused",
      toolName: "finish_work",
      args: { status: "success", verification_token: "token" },
    }),
  );
  assert.equal(guard.shouldStop(false, false), false);
  guard.observe(
    JSON.stringify({
      type: "tool_execution_end",
      toolCallId: "reused",
      toolName: "finish_work",
      isError: false,
      result: { content: [{ type: "text", text: "done" }] },
    }),
  );
  assert.equal(guard.shouldStop(false, true), false);
});

test("P does not pair a dangling finish start across internal turns in one subprocess", () => {
  const guard = createAgentTaskCompletionGuard("p", "evidence");
  guard.observe(
    [
      {
        type: "tool_execution_start",
        toolCallId: "reused",
        toolName: "finish_work",
        args: { status: "success", verification_token: "token" },
      },
      { type: "turn_end" },
      {
        type: "tool_execution_end",
        toolCallId: "reused",
        toolName: "finish_work",
        isError: false,
        result: { content: [{ type: "text", text: "done" }] },
      },
    ]
      .map((event) => JSON.stringify(event))
      .join("\n"),
  );
  assert.equal(guard.shouldStop(false, true), false);
});

function temporaryRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "p-benchmark-finish-contract-"));
  roots.push(root);
  return root;
}

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
    timeoutSeconds: 10,
    maxRuntimeSeconds: 10,
  };
}

const task: BenchmarkTask = {
  id: "finish-contract",
  timeoutSeconds: 10,
  maxScore: 1,
  description: "Exercise benchmark completion semantics",
  files: {},
  prompt: "Complete the fixture and create finish_notes.md.",
  verify: () => ({ passed: true, score: 1, maxScore: 1, checks: [] }),
};

function fakePSource(): string {
  return `
const { appendFileSync, writeFileSync } = require("node:fs");
const continued = process.argv.includes("--continue");
const prompt = process.argv.at(-1);
appendFileSync("invocations.jsonl", JSON.stringify({ continued, prompt }) + "\\n");
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
if (!continued) {
  writeFileSync("finish_notes.md", "Implementation complete; terminal verification is pending.\\n");
  emit({ type: "tool_execution_start", toolCallId: "ready", toolName: "record_task_verification", args: { action: "ready_to_finish" } });
  emit({ type: "tool_execution_end", toolCallId: "ready", toolName: "record_task_verification", isError: false, result: { content: [{ type: "text", text: "verification_token: token" }] } });
} else {
  emit({ type: "tool_execution_start", toolCallId: "finish", toolName: "finish_work", args: { status: "success" } });
  emit({ type: "tool_execution_end", toolCallId: "finish", toolName: "finish_work", isError: false, result: { content: [{ type: "text", text: "done" }] } });
}
`;
}

function alwaysPendingPSource(): string {
  return `
const { existsSync, readFileSync, writeFileSync } = require("node:fs");
const count = existsSync("invocations.txt") ? Number(readFileSync("invocations.txt", "utf8")) : 0;
writeFileSync("invocations.txt", String(count + 1));
writeFileSync("finish_notes.md", "Implementation complete; terminal verification is pending.\\n");
`;
}

function finishEvents(id: string, includeToken: boolean, isError: boolean): string {
  const args = { status: "success", ...(includeToken ? { verification_token: `token-${id}` } : {}) };
  return [
    { type: "tool_execution_start", toolCallId: id, toolName: "finish_work", args },
    {
      type: "tool_execution_end",
      toolCallId: id,
      toolName: "finish_work",
      isError,
      result: { content: [{ type: "text", text: "done" }] },
    },
  ]
    .map((event) => JSON.stringify(event))
    .join("\n");
}
