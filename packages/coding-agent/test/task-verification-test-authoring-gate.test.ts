import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Agent } from "@dst0/p-agent-core";
import { afterEach, describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import type { TaskVerificationController } from "../src/core/task-verification.ts";
import {
  createRequirementAuditHarness,
  defineDirectPromptRequirements,
  defineSingleDirectPromptRequirement,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

interface TestDebtState {
  unverifiedTestPaths?: string[];
}
const workspaces: string[] = [];

afterEach(async () => {
  await Promise.all(workspaces.splice(0).map((workspace) => rm(workspace, { recursive: true, force: true })));
});
async function createIsolatedHarness() {
  const cwd = await mkdtemp(join(tmpdir(), "p-test-authoring-gate-"));
  workspaces.push(cwd);
  return createRequirementAuditHarness(SessionManager.inMemory(cwd));
}
function writeCall(id: string, path: string) {
  const args = { path, content: "test('behavior', () => {});\n" };
  return { args, toolCall: { type: "toolCall" as const, id, name: "write", arguments: args } };
}
async function beforeWrite(agent: Agent, id: string, path: string) {
  const { args, toolCall } = writeCall(id, path);
  return agent.beforeToolCall?.({ assistantMessage: {} as never, toolCall, args, context: {} as never });
}
async function beforeTool(agent: Agent, id: string, name: string, args: Record<string, unknown>) {
  const toolCall = { type: "toolCall" as const, id, name, arguments: args };
  return agent.beforeToolCall?.({ assistantMessage: {} as never, toolCall, args, context: {} as never });
}
async function finishTool(
  agent: Agent,
  id: string,
  name: string,
  args: Record<string, unknown>,
  text: string,
  isError = false,
): Promise<void> {
  const toolCall = { type: "toolCall" as const, id, name, arguments: args };
  await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    result: { content: [{ type: "text", text }], details: undefined },
    isError,
    context: {} as never,
  });
}
async function runTool(
  agent: Agent,
  id: string,
  name: string,
  args: Record<string, unknown>,
  text: string,
  isError = false,
): Promise<void> {
  const before = await beforeTool(agent, id, name, args);
  if (before?.block) throw new Error(before.reason ?? `${name} was blocked`);
  await finishTool(agent, id, name, args, text, isError);
}
async function finishWrite(agent: Agent, id: string, path: string, isError = false): Promise<string> {
  const { args, toolCall } = writeCall(id, path);
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    result: { content: [{ type: "text", text: isError ? "write failed" : "wrote test" }], details: undefined },
    isError,
    context: {} as never,
  });
  return (
    result?.content
      ?.filter((part): part is Extract<NonNullable<typeof result.content>[number], { type: "text" }> => {
        return part.type === "text";
      })
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}
async function writeTest(agent: Agent, id: string, path: string): Promise<{ block?: boolean; output: string }> {
  const before = await beforeWrite(agent, id, path);
  if (before?.block) return { block: true, output: before.reason ?? "" };
  return { block: false, output: await finishWrite(agent, id, path) };
}
function pendingPaths(controller: TaskVerificationController): string[] {
  return (controller.currentState as TestDebtState).unverifiedTestPaths ?? [];
}
describe("task verification test-authoring cadence", () => {
  it("blocks a fourth distinct test path until the three-file batch passes", async () => {
    const harness = await createIsolatedHarness();
    const first = await writeTest(harness.agent, "write-a", "test/a.test.ts");
    await writeTest(harness.agent, "write-b", "test/b.test.ts");
    await writeTest(harness.agent, "write-c", "test/c.test.ts");

    expect(first.output).toContain("Run a direct test command");
    expect(pendingPaths(harness.controller)).toEqual(["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"]);
    expect((await beforeWrite(harness.agent, "write-d", "test/d.test.ts"))?.block).toBe(true);

    await runTool(harness.agent, "broad-pass", "bash", { command: "npm test" }, "82 tests passed");
    expect(pendingPaths(harness.controller)).toEqual([]);
    expect((await beforeWrite(harness.agent, "write-d-after-pass", "test/d.test.ts"))?.block).not.toBe(true);
  });

  it("settles a full batch from the Node spec reporter summary", async () => {
    const harness = await createIsolatedHarness();
    await writeTest(harness.agent, "write-a", "test/a.test.ts");
    await writeTest(harness.agent, "write-b", "test/b.test.ts");
    await writeTest(harness.agent, "write-c", "test/c.test.ts");

    await runTool(harness.agent, "node-pass", "bash", { command: "npm test" }, "ℹ tests 5\nℹ pass 5\nℹ fail 0");

    expect(pendingPaths(harness.controller)).toEqual([]);
    expect((await beforeWrite(harness.agent, "write-d-after-node-pass", "test/d.test.ts"))?.block).not.toBe(true);
  });

  it("allows same-path repairs while the batch is full", async () => {
    const harness = await createIsolatedHarness();
    await writeTest(harness.agent, "write-a", "test/a.test.ts");
    await writeTest(harness.agent, "write-b", "test/b.test.ts");
    await writeTest(harness.agent, "write-c", "test/c.test.ts");

    expect((await beforeWrite(harness.agent, "rewrite-a", "test/a.test.ts"))?.block).not.toBe(true);
  });

  it("does not clear debt after failed or exit-masked test commands", async () => {
    const harness = await createIsolatedHarness();
    await writeTest(harness.agent, "write-a", "test/a.test.ts");
    await writeTest(harness.agent, "write-b", "test/b.test.ts");
    await writeTest(harness.agent, "write-c", "test/c.test.ts");

    await runTool(harness.agent, "failed-suite", "bash", { command: "npm test" }, "1 test failed", true);
    await runTool(harness.agent, "masked-suite", "bash", { command: "npm test | head" }, "tests passed");
    await runTool(harness.agent, "node-mixed-suite", "bash", { command: "npm test" }, "ℹ tests 5\nℹ pass 4\nℹ fail 1");

    expect(pendingPaths(harness.controller)).toHaveLength(3);
    expect((await beforeWrite(harness.agent, "write-d", "test/d.test.ts"))?.block).toBe(true);
  });

  it("does not clear debt with vacuous, unrelated, or substring-matched selectors", async () => {
    const harness = await createIsolatedHarness();
    await writeTest(harness.agent, "write-a", "test/a.test.ts");
    await writeTest(harness.agent, "write-b", "test/unit/shared.test.ts");
    await writeTest(harness.agent, "write-c", "test/integration/shared.test.ts");

    await runTool(
      harness.agent,
      "vacuous-suite",
      "bash",
      { command: "vitest unrelated-a.test.ts unrelated-b.test.ts --passWithNoTests" },
      "no tests found, exiting successfully",
    );
    await runTool(
      harness.agent,
      "substring-suite",
      "bash",
      { command: "node --test test/not-a.test.ts" },
      "1 test passed",
    );

    expect(pendingPaths(harness.controller)).toEqual([
      "test/a.test.ts",
      "test/unit/shared.test.ts",
      "test/integration/shared.test.ts",
    ]);
  });

  it("clears only the path covered by a focused successful run", async () => {
    const harness = await createIsolatedHarness();
    await writeTest(harness.agent, "write-a", "test/a.test.ts");
    await writeTest(harness.agent, "write-b", "test/b.test.ts");
    await writeTest(harness.agent, "write-c", "test/c.test.ts");

    await runTool(harness.agent, "focused-pass", "bash", { command: "node --test test/a.test.ts" }, "1 test passed");

    expect(pendingPaths(harness.controller)).toEqual(["test/b.test.ts", "test/c.test.ts"]);
    expect((await beforeWrite(harness.agent, "write-d", "test/d.test.ts"))?.block).not.toBe(true);
  });

  it("does not let an older concurrent test result clear newer test mutations", async () => {
    const harness = await createIsolatedHarness();
    await writeTest(harness.agent, "write-a", "test/a.test.ts");
    await writeTest(harness.agent, "write-b", "test/b.test.ts");
    await writeTest(harness.agent, "write-c", "test/c.test.ts");
    const args = { command: "npm test" };
    await beforeTool(harness.agent, "running-tests", "bash", args);

    await writeTest(harness.agent, "rewrite-a", "test/a.test.ts");
    await finishTool(harness.agent, "running-tests", "bash", args, "82 tests passed");

    expect(pendingPaths(harness.controller)).toEqual(["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"]);
  });

  it("counts in-flight parallel writes before their results arrive", async () => {
    const harness = await createIsolatedHarness();
    expect((await beforeWrite(harness.agent, "write-a", "test/a.test.ts"))?.block).not.toBe(true);
    expect((await beforeWrite(harness.agent, "write-b", "test/b.test.ts"))?.block).not.toBe(true);
    expect((await beforeWrite(harness.agent, "write-c", "test/c.test.ts"))?.block).not.toBe(true);
    expect((await beforeWrite(harness.agent, "write-d", "test/d.test.ts"))?.block).toBe(true);

    await finishWrite(harness.agent, "write-a", "test/a.test.ts", true);
    expect((await beforeWrite(harness.agent, "write-d-retry", "test/d.test.ts"))?.block).not.toBe(true);
  });

  it("detects test paths created by a shell mutation", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-test-authoring-shell-"));
    try {
      await writeFile(join(cwd, "template.js"), "export const value = true;\n");
      execFileSync("git", ["init", "-q"], { cwd });
      execFileSync("git", ["add", "template.js"], { cwd });
      execFileSync(
        "git",
        ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "baseline"],
        { cwd },
      );
      const harness = createRequirementAuditHarness(SessionManager.inMemory(cwd));
      const args = { command: "cp template.js test/generated.test.js" };
      await beforeTool(harness.agent, "shell-write", "bash", args);
      await mkdir(join(cwd, "test"));
      await copyFile(join(cwd, "template.js"), join(cwd, "test/generated.test.js"));
      await finishTool(harness.agent, "shell-write", "bash", args, "copied");

      expect(pendingPaths(harness.controller)).toEqual(["test/generated.test.js"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("blocks successful completion and publishing while test paths remain unverified", async () => {
    const harness = await createIsolatedHarness();
    await writeTest(harness.agent, "write-a", "test/a.test.ts");

    const finish = await beforeTool(harness.agent, "finish", "finish_work", { status: "success" });
    const publish = await beforeTool(harness.agent, "push", "bash", { command: "git push" });

    expect(finish?.block).toBe(true);
    expect(finish?.reason).toContain("test/a.test.ts");
    expect(publish?.block).toBe(true);
    expect(publish?.reason).toContain("test/a.test.ts");
  });

  it("honors an explicit user request not to run tests", async () => {
    const harness = await createIsolatedHarness();
    await sendAuditUserPrompt(harness, "Create four test files but do not run tests.", 100);
    await defineSingleDirectPromptRequirement(
      harness,
      "Create four test files but do not run tests",
      "Four test files are created without running tests",
    );

    for (const [index, path] of ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts", "test/d.test.ts"].entries()) {
      expect((await writeTest(harness.agent, `write-${index}`, path)).block).toBe(false);
    }
    expect(pendingPaths(harness.controller)).toEqual([]);
  });

  it("does not mistake mandatory-test wording for an opt-out", async () => {
    const harness = await createIsolatedHarness();
    await sendAuditUserPrompt(harness, "Do not finish without tests; never skip tests.", 100);
    await defineDirectPromptRequirements(harness, [
      { text: "Do not finish without tests", acceptanceCriterion: "Completion includes tests", sourcePromptIndex: 1 },
      { text: "Never skip tests", acceptanceCriterion: "Tests run before completion", sourcePromptIndex: 1 },
    ]);

    await writeTest(harness.agent, "write-a", "test/a.test.ts");
    await writeTest(harness.agent, "write-b", "test/b.test.ts");
    await writeTest(harness.agent, "write-c", "test/c.test.ts");

    expect((await beforeWrite(harness.agent, "write-d", "test/d.test.ts"))?.block).toBe(true);
  });

  it("uses the latest explicit test directive", async () => {
    const harness = await createIsolatedHarness();
    await sendAuditUserPrompt(harness, "Create test files but do not run tests.", 100);
    await sendAuditUserPrompt(harness, "Actually, run each new test before writing more.", 200);
    await defineDirectPromptRequirements(harness, [
      { text: "Create test files", acceptanceCriterion: "The requested test files exist", sourcePromptIndex: 1 },
      {
        text: "Run each new test before writing more",
        acceptanceCriterion: "Each new test passes",
        sourcePromptIndex: 2,
      },
    ]);

    await writeTest(harness.agent, "write-a", "test/a.test.ts");
    await writeTest(harness.agent, "write-b", "test/b.test.ts");
    await writeTest(harness.agent, "write-c", "test/c.test.ts");

    expect((await beforeWrite(harness.agent, "write-d", "test/d.test.ts"))?.block).toBe(true);
  });
});
