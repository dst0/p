import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const discoveryState = vi.hoisted(() => ({ projectAgentsDir: "/tmp/project/.p/agents" }));

const mocks = vi.hoisted(() => ({
  runSingleAgent: vi.fn(async (...args: unknown[]) => ({
    agent: String(args[2]),
    agentSource: "user" as const,
    task: String(args[3]),
    exitCode: 0,
    messages: [
      {
        role: "assistant" as const,
        content: [{ type: "text" as const, text: `done:${String(args[2])}` }],
        api: "test",
        provider: "test",
        model: "test",
        usage: {
          input: 1,
          output: 1,
          cacheRead: 0,
          cacheWrite: 0,
          totalTokens: 2,
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
        },
        stopReason: "stop" as const,
        timestamp: 1,
      },
    ],
    stderr: "",
    usage: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0, cost: 0, contextTokens: 2, turns: 1 },
    step: args[5] as number | undefined,
  })),
}));

vi.mock("../examples/extensions/subagent/agents.ts", () => ({
  discoverAgents: (_cwd: string, scope: string) => ({
    agents: [
      {
        name: "reviewer",
        description: "Review code",
        systemPrompt: "",
        source: scope === "project" ? "project" : "user",
        filePath: "/tmp/reviewer.md",
      },
    ],
    projectAgentsDir: scope === "project" ? discoveryState.projectAgentsDir : null,
  }),
}));

vi.mock("../examples/extensions/subagent/runner.ts", () => ({ runSingleAgent: mocks.runSingleAgent }));

import { createSubagentExecutor } from "../examples/extensions/subagent/executor.ts";

const parent = { getThinkingLevel: () => "high" };
const context = {
  cwd: "/tmp/project",
  model: { provider: "mini-pc", id: "qwen3.6-27b" },
  hasUI: false,
  runBudgetPolicy: { mode: "unlimited" },
  isProjectTrusted: () => false,
};
const temporaryPaths: string[] = [];

async function execute(params: Record<string, unknown>, contextOverrides: Record<string, unknown> = {}) {
  const executor = createSubagentExecutor(parent as never);
  return executor("call-1", params as never, undefined, undefined, { ...context, ...contextOverrides } as never);
}

function expectParentRuntimeOnEveryCall(expectedCount: number): void {
  expect(mocks.runSingleAgent).toHaveBeenCalledTimes(expectedCount);
  for (const call of mocks.runSingleAgent.mock.calls) {
    expect(call[9]).toBe("mini-pc/qwen3.6-27b");
    expect(call[10]).toBe("high");
    expect(call[11]).toBe("unlimited");
  }
}

describe("subagent executor runtime propagation", () => {
  beforeEach(() => {
    mocks.runSingleAgent.mockClear();
    discoveryState.projectAgentsDir = "/tmp/project/.p/agents";
  });

  afterEach(() => {
    for (const path of temporaryPaths.splice(0)) rmSync(path, { recursive: true, force: true });
  });

  it("propagates parent runtime settings in single mode", async () => {
    await execute({ agent: "reviewer", task: "single" });
    expectParentRuntimeOnEveryCall(1);
  });

  it("propagates parent runtime settings to every parallel task", async () => {
    await execute({
      tasks: [
        { agent: "reviewer", task: "parallel one" },
        { agent: "reviewer", task: "parallel two" },
      ],
    });
    expectParentRuntimeOnEveryCall(2);
  });

  it("propagates parent runtime settings to every chain step", async () => {
    await execute({
      chain: [
        { agent: "reviewer", task: "chain one" },
        { agent: "reviewer", task: "chain two after {previous}" },
      ],
    });
    expectParentRuntimeOnEveryCall(2);
  });

  it("rejects repo-controlled agents headlessly unless the caller explicitly authorizes them", async () => {
    await expect(execute({ agentScope: "project", agent: "reviewer", task: "inspect" })).rejects.toThrow(
      /explicit.*authorization|not approved/iu,
    );
    expect(mocks.runSingleAgent).not.toHaveBeenCalled();

    await expect(
      execute({ agentScope: "project", confirmProjectAgents: false, agent: "reviewer", task: "inspect" }),
    ).rejects.toThrow(/explicit.*authorization|not approved/iu);
    await execute({ agentScope: "project", agent: "reviewer", task: "inspect" }, { isProjectTrusted: () => true });
    expectParentRuntimeOnEveryCall(1);
  });

  it("requires an explicit UI approval before running a project agent interactively", async () => {
    const confirm = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const ui = { confirm };

    const denied = await execute({ agentScope: "project", agent: "reviewer", task: "inspect" }, { hasUI: true, ui });
    expect((denied.content[0] as { text: string }).text).toMatch(/not approved/iu);
    expect(mocks.runSingleAgent).not.toHaveBeenCalled();

    await execute({ agentScope: "project", agent: "reviewer", task: "inspect" }, { hasUI: true, ui });
    expect(confirm).toHaveBeenCalledTimes(2);
    expectParentRuntimeOnEveryCall(1);
  });

  it("prevents project agents from escaping their authorized project cwd", async () => {
    const root = mkdtempSync(join(tmpdir(), "p-subagent-cwd-trust-"));
    temporaryPaths.push(root);
    const projectRoot = join(root, "project");
    const projectAgentsDir = join(projectRoot, ".p", "agents");
    const outside = join(root, "outside");
    const escapePath = join(projectRoot, "escape");
    mkdirSync(projectAgentsDir, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(outside, escapePath);
    discoveryState.projectAgentsDir = projectAgentsDir;
    const trusted = { cwd: projectRoot, isProjectTrusted: () => true };

    await expect(
      execute({ agentScope: "project", agent: "reviewer", task: "inspect", cwd: outside }, trusted),
    ).rejects.toThrow(/working directory|project root/iu);
    await expect(
      execute({ agentScope: "project", agent: "reviewer", task: "inspect", cwd: escapePath }, trusted),
    ).rejects.toThrow(/working directory|project root/iu);
    expect(mocks.runSingleAgent).not.toHaveBeenCalled();
  });

  it("spawns in the validated canonical cwd if an approved symlink is retargeted", async () => {
    const root = mkdtempSync(join(tmpdir(), "p-subagent-cwd-swap-"));
    temporaryPaths.push(root);
    const projectRoot = join(root, "project");
    const projectAgentsDir = join(projectRoot, ".p", "agents");
    const inside = join(projectRoot, "inside");
    const outside = join(root, "outside");
    const workingLink = join(projectRoot, "working-link");
    mkdirSync(projectAgentsDir, { recursive: true });
    mkdirSync(inside, { recursive: true });
    mkdirSync(outside, { recursive: true });
    symlinkSync(inside, workingLink);
    discoveryState.projectAgentsDir = projectAgentsDir;
    const confirm = vi.fn(async () => {
      unlinkSync(workingLink);
      symlinkSync(outside, workingLink);
      return true;
    });

    await execute(
      { agentScope: "project", agent: "reviewer", task: "inspect", cwd: workingLink },
      { cwd: projectRoot, hasUI: true, ui: { confirm } },
    );

    expect(mocks.runSingleAgent.mock.calls[0][4]).toBe(realpathSync(inside));
  });

  it("fails closed instead of multiplying a limited parent budget across child processes", async () => {
    await expect(
      execute(
        { agent: "reviewer", task: "inspect" },
        { runBudgetPolicy: { mode: "limited", unit: "requests", limit: 2 } },
      ),
    ).rejects.toThrow(/limited parent budgets/iu);
    expect(mocks.runSingleAgent).not.toHaveBeenCalled();
  });
});
