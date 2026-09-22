import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent, resolveToolEffect } from "@dst0/p-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";

/**
 * Regression for inspection work in a directory whose test snapshot cannot be bounded (a home directory or
 * a workspace with more test files than the snapshot limit): a command that changes nothing must not create
 * changed-test debt, while a detected mutation still fails closed.
 */
const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function createController(cwd: string): { agent: Agent; controller: TaskVerificationController } {
  const agent = new Agent();
  const controller = createTaskVerificationController(SessionManager.inMemory(cwd), "audit");
  controller.install(agent);
  controller.declareTask({ action: "declare_task", task_kind: "docs", task_summary: "Inspect the hardware" });
  return { agent, controller };
}

/** More test files than the snapshot bound, outside Git, like a home directory full of checkouts. */
function oversizedTestDirectory(): string {
  const root = mkdtempSync(join(tmpdir(), "p-unbounded-snapshot-"));
  roots.push(root);
  mkdirSync(join(root, "test"));
  for (let index = 0; index <= 2_000; index++) {
    writeFileSync(join(root, "test", `case-${index}.test.js`), `export const value${index} = ${index};\n`);
  }
  return root;
}

async function runTool(
  agent: Agent,
  id: string,
  name: string,
  args: Record<string, unknown>,
  between: () => void = () => undefined,
): Promise<void> {
  const toolCall = { type: "toolCall" as const, id, name, arguments: args };
  const effect = name === "bash" ? resolveToolEffect({ kind: "unknown", risk: "high" }, "builtin") : undefined;
  const hookContext = { assistantMessage: {} as never, toolCall, args, effect, context: {} as never };
  expect((await agent.beforeToolCall?.(hookContext))?.block).not.toBe(true);
  between();
  await agent.afterToolCall?.({
    ...hookContext,
    result: { content: [{ type: "text", text: "ok" }], details: undefined },
    isError: false,
  });
}

async function finishBlockReason(agent: Agent): Promise<string> {
  const args = { status: "success", summary: "done" };
  const toolCall = { type: "toolCall" as const, id: "finish", name: "finish_work", arguments: args };
  const result = await agent.beforeToolCall?.({ assistantMessage: {} as never, toolCall, args, context: {} as never });
  return result?.reason ?? "";
}

describe("unbounded workspace snapshots", () => {
  it("creates no broad-test debt for an inspection command when the workspace cannot be snapshotted", async () => {
    const { agent, controller } = createController(join(tmpdir(), `p-unbounded-missing-${Date.now()}`));

    await runTool(agent, "inspect", "bash", { command: "node -e \"console.log(require('os').cpus().length)\"" });

    expect(controller.currentState.unverifiedTestPathOverflow ?? false).toBe(false);
    expect(controller.currentState.unverifiedTestPaths ?? []).toEqual([]);
    expect(controller.currentState.mutationRevision).toBe(0);
    expect(await finishBlockReason(agent)).not.toContain("broad test run");
  });

  it("separates unchanged inspection from a detected test write in an oversized workspace", async () => {
    const root = oversizedTestDirectory();
    const { agent, controller } = createController(root);

    await runTool(agent, "inspect", "bash", { command: "node -e \"console.log('inspecting')\"" });
    await runTool(agent, "tracker", "secure_hub_workspace_task_list", { project: "hardware" });

    expect(controller.currentState.unverifiedTestPathOverflow ?? false).toBe(false);
    expect(await finishBlockReason(agent)).not.toContain("broad test run");

    await runTool(agent, "copy", "bash", { command: "cp test/case-0.test.js test/copied.test.js" }, () =>
      writeFileSync(join(root, "test", "copied.test.js"), "export const copied = true;\n"),
    );

    expect(controller.currentState.unverifiedTestPathOverflow).toBe(true);
    expect(await finishBlockReason(agent)).toContain("broad test run");
  });
});
