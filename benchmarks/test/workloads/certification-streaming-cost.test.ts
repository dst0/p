import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { performance } from "node:perf_hooks";
import { test } from "node:test";
import { runAgentTask } from "../../src/workloads/agent-turn-runner.ts";
import type { RunnerOptions } from "../../src/workloads/runner-options.ts";
import type { BenchmarkTask } from "../../src/workloads/task-definition.ts";

test("runAgentTask preserves accumulated monetary cost from streamed P events", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-streamed-cost-"));
  const workspace = join(root, "workspace");
  const config = join(root, "config");
  const recordings = join(root, "recordings");
  mkdirSync(workspace);
  mkdirSync(config);
  mkdirSync(recordings);
  const cli = join(root, "fake-p.js");
  writeFileSync(
    cli,
    `const { writeFileSync } = require("node:fs");
writeFileSync("finish_notes.md", "done\\n");
const emit = (event) => process.stdout.write(JSON.stringify(event) + "\\n");
for (const [tokens, cost] of [[3, 0.0125], [5, 0.0275]]) {
  emit({ type: "message_end", message: { role: "assistant", responseModel: "resolved/model", content: [], stopReason: "stop", usage: { input: tokens, output: tokens, cacheRead: 0, cacheWrite: 0, totalTokens: tokens * 2, cost: { total: cost } } } });
}
`,
  );
  const options: RunnerOptions = {
    model: "provider/model",
    pCli: cli,
    projectInstructionProbe: "/unused/probe.js",
    projectInstructionsFile: "/unused/AGENTS.md",
    taskVerificationMode: "off",
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
  const task: BenchmarkTask = {
    id: "streamed-cost",
    timeoutSeconds: 10,
    maxScore: 1,
    description: "Preserve streamed cost",
    files: {},
    prompt: "complete",
    verify: () => ({ passed: true, score: 1, maxScore: 1, checks: [] }),
  };
  try {
    const result = await runAgentTask(
      "p",
      options,
      task,
      config,
      workspace,
      join(recordings, "p.jsonl.br"),
      10,
      performance.now() + 20_000,
    );
    assert.deepEqual(result.metrics?.usage.cost, { total: 0.04 });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
