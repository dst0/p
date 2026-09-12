import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { AgentConfig } from "../examples/extensions/subagent/agents.ts";
import type { SingleResult, SubagentDetails } from "../examples/extensions/subagent/formatters.ts";
import { getFinalOutput } from "../examples/extensions/subagent/formatters.ts";
import { runSingleAgent } from "../examples/extensions/subagent/runner.ts";

const originalScript = process.argv[1];

afterEach(() => {
  process.argv[1] = originalScript;
});

function makeDetails(results: SingleResult[]): SubagentDetails {
  return { mode: "single", agentScope: "user", projectAgentsDir: null, results };
}

describe("subagent child process runtime", () => {
  it("fails before spawning when no trusted child budget was supplied", async () => {
    process.argv[1] = join(import.meta.dirname, "fixtures", "subagent-real-cli.js");
    const agent: AgentConfig = {
      name: "reviewer",
      description: "Review code",
      systemPrompt: "",
      source: "user",
      filePath: "/tmp/reviewer.md",
    };

    const result = await runSingleAgent(
      process.cwd(),
      [agent],
      agent.name,
      "Inspect the change",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDetails,
      "subagent-faux/inherited-model",
      "high",
    );

    expect(result.exitCode).toBe(1);
    expect(result.messages).toEqual([]);
    expect(result.stderr).toMatch(/limited parent budget/iu);
  });

  it("selects the inherited model and thinking level in the real p CLI with a faux provider", async () => {
    process.argv[1] = join(import.meta.dirname, "fixtures", "subagent-real-cli.js");
    const childCwd = mkdtempSync(join(tmpdir(), "p-subagent-real-cli-"));
    const controller = new AbortController();
    const deadline = setTimeout(() => controller.abort(), 60_000);
    deadline.unref();
    const agent: AgentConfig = {
      name: "reviewer",
      description: "Review code",
      systemPrompt: "",
      source: "user",
      filePath: "/tmp/reviewer.md",
    };

    try {
      const result = await runSingleAgent(
        childCwd,
        [agent],
        agent.name,
        "Inspect the change",
        undefined,
        undefined,
        controller.signal,
        undefined,
        makeDetails,
        "subagent-faux/inherited-model",
        "high",
        "unlimited",
      );

      expect(result.exitCode, result.stderr || result.errorMessage).toBe(0);
      expect(JSON.parse(getFinalOutput(result.messages))).toEqual({
        provider: "subagent-faux",
        model: "inherited-model",
        reasoning: "high",
      });
    } finally {
      clearTimeout(deadline);
      controller.abort();
      rmSync(childCwd, { recursive: true, force: true });
    }
  }, 90_000);

  it("passes inherited runtime settings through the real spawned CLI arguments", async () => {
    process.argv[1] = join(import.meta.dirname, "fixtures", "subagent-cli.js");
    const agent: AgentConfig = {
      name: "reviewer",
      description: "Review code",
      tools: ["read", "grep"],
      systemPrompt: "",
      source: "user",
      filePath: "/tmp/reviewer.md",
    };

    const result = await runSingleAgent(
      process.cwd(),
      [agent],
      agent.name,
      "Inspect the change",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDetails,
      "mini-pc/qwen3.6-27b",
      "high",
      "unlimited",
    );

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(getFinalOutput(result.messages))).toEqual([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--budget",
      "unlimited",
      "--model",
      "mini-pc/qwen3.6-27b",
      "--tools",
      "read,grep",
      "--thinking",
      "high",
      "Task: Inspect the change",
    ]);
  });

  it("keeps explicit agent runtime overrides in the spawned CLI arguments", async () => {
    process.argv[1] = join(import.meta.dirname, "fixtures", "subagent-cli.js");
    const agent: AgentConfig = {
      name: "reviewer",
      description: "Review code",
      model: "openai/gpt-5-mini",
      thinking: "off",
      systemPrompt: "",
      source: "user",
      filePath: "/tmp/reviewer.md",
    };

    const result = await runSingleAgent(
      process.cwd(),
      [agent],
      agent.name,
      "Inspect the change",
      undefined,
      undefined,
      undefined,
      undefined,
      makeDetails,
      "mini-pc/qwen3.6-27b",
      "high",
      "unlimited",
    );

    const args = JSON.parse(getFinalOutput(result.messages)) as string[];
    expect(args).toContain("openai/gpt-5-mini");
    expect(args).toContain("off");
    expect(args).not.toContain("mini-pc/qwen3.6-27b");
    expect(args).not.toContain("high");
  });
});
