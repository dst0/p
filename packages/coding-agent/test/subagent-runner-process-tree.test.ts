import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../examples/extensions/subagent/agents.ts";
import type { SingleResult, SubagentDetails } from "../examples/extensions/subagent/formatters.ts";
import { runSingleAgent } from "../examples/extensions/subagent/runner.ts";

const originalScript = process.argv[1];
const agent: AgentConfig = {
  name: "reviewer",
  description: "Review code",
  systemPrompt: "",
  source: "user",
  filePath: "/tmp/reviewer.md",
};

afterEach(() => {
  process.argv[1] = originalScript;
});

function makeDetails(results: SingleResult[]): SubagentDetails {
  return { mode: "single", agentScope: "user", projectAgentsDir: null, results };
}

function processIsAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function waitForPidFile(path: string, timeoutMs: number): Promise<{ parent: number; descendant: number }> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (existsSync(path)) {
      try {
        const text = readFileSync(path, "utf8").trim();
        if (text) {
          return JSON.parse(text) as { parent: number; descendant: number };
        }
      } catch {
        // Retry on partial write
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for ${path}`);
}

async function waitForProcessExit(pid: number, timeoutMs: number): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (processIsAlive(pid)) {
    if (Date.now() >= deadline) throw new Error(`Process ${pid} did not exit`);
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}

async function exerciseProcessTreeFixture(fixture: string): Promise<void> {
  process.argv[1] = join(import.meta.dirname, "fixtures", fixture);
  const childCwd = mkdtempSync(join(tmpdir(), "p-subagent-process-tree-"));
  const pidFile = join(childCwd, "pids.json");
  const controller = new AbortController();
  let descendantPid: number | undefined;
  const started = Date.now();
  const run = runSingleAgent(
    childCwd,
    [agent],
    agent.name,
    "Inspect",
    undefined,
    undefined,
    controller.signal,
    undefined,
    makeDetails,
    "provider/model",
    "high",
    "unlimited",
  );

  try {
    const pids = await waitForPidFile(pidFile, 5_000);
    descendantPid = pids.descendant;
    controller.abort();
    await expect(run).rejects.toThrow(/aborted/iu);
    expect(Date.now() - started).toBeLessThan(12_000);
    await Promise.all([waitForProcessExit(pids.parent, 2_000), waitForProcessExit(pids.descendant, 2_000)]);
  } finally {
    controller.abort();
    await run.catch(() => undefined);
    if (descendantPid !== undefined && processIsAlive(descendantPid)) process.kill(descendantPid, "SIGKILL");
    rmSync(childCwd, { recursive: true, force: true });
  }
}

describe("subagent process-tree cancellation", () => {
  it("joins a descendant that inherits stdio", async () => {
    await exerciseProcessTreeFixture("subagent-process-tree.js");
  }, 15_000);

  it("joins an ignored-TERM descendant after the direct child closes early", async () => {
    await exerciseProcessTreeFixture("subagent-process-tree-early-close.js");
  }, 15_000);
});
