import { execFileSync } from "node:child_process";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";
import { createRequirementAuditHarness } from "./task-requirement-audit-test-harness.ts";

function call(id: string, name: string, args: Record<string, unknown>) {
  return { args, toolCall: { type: "toolCall" as const, id, name, arguments: args } };
}

async function invokeBefore(agent: Agent, id: string, name: string, args: Record<string, unknown>) {
  const invocation = call(id, name, args);
  return agent.beforeToolCall?.({ assistantMessage: {} as never, ...invocation, context: {} as never });
}

async function invokeAfter(
  agent: Agent,
  id: string,
  name: string,
  args: Record<string, unknown>,
  text = "ok",
): Promise<void> {
  const invocation = call(id, name, args);
  await agent.afterToolCall?.({
    assistantMessage: {} as never,
    ...invocation,
    result: { content: [{ type: "text", text }], details: undefined },
    isError: false,
    context: {} as never,
  });
}

async function writeTest(agent: Agent, id: string, path: string): Promise<void> {
  const args = { path, content: "test('behavior', () => {});\n" };
  expect((await invokeBefore(agent, id, "write", args))?.block).not.toBe(true);
  await invokeAfter(agent, id, "write", args, "wrote test");
}

async function pass(agent: Agent, id: string, command: string, output = "tests 3 passed"): Promise<void> {
  const args = { command };
  expect((await invokeBefore(agent, id, "bash", args))?.block).not.toBe(true);
  await invokeAfter(agent, id, "bash", args, output);
}

function pending(controller: TaskVerificationController): string[] {
  return controller.currentState.unverifiedTestPaths ?? [];
}

function declareTestOnlyTask(controller: TaskVerificationController): void {
  controller.declareTask({ action: "declare_task", task_kind: "docs", task_summary: "Add test coverage" });
}

describe("task verification test-authoring bypass resistance", () => {
  it("does not clear unrelated paths from a positional glob", async () => {
    const harness = createRequirementAuditHarness();
    await writeTest(harness.agent, "write-unit", "test/unit/a.test.ts");
    await writeTest(harness.agent, "write-integration", "test/integration/b.test.ts");

    await pass(harness.agent, "glob", "node --test 'test/unit/*.test.ts'", "tests 1 passed");

    expect(pending(harness.controller)).toEqual(["test/unit/a.test.ts", "test/integration/b.test.ts"]);
  });

  it("does not clear a pending path from a same-basename selector elsewhere", async () => {
    const harness = createRequirementAuditHarness();
    await writeTest(harness.agent, "write-unit-a", "test/unit/a.test.ts");

    await pass(harness.agent, "other-a", "node --test fixtures/a.test.ts", "tests 1 passed");

    expect(pending(harness.controller)).toEqual(["test/unit/a.test.ts"]);
  });

  it("does not treat an excluded path as a broad test run", async () => {
    const harness = createRequirementAuditHarness();
    await writeTest(harness.agent, "write-excluded-a", "test/a.test.ts");

    await pass(harness.agent, "excluded-a", "vitest --exclude test/other.test.ts test/a.test.ts", "tests 1 passed");

    expect(pending(harness.controller)).toEqual(["test/a.test.ts"]);
  });

  it("does not treat a test-name option value as a file selector", async () => {
    const harness = createRequirementAuditHarness();
    await writeTest(harness.agent, "write-a", "test/a.test.ts");

    await pass(harness.agent, "name-filter", "vitest -t test/a.test.ts", "tests 1 passed");

    expect(pending(harness.controller)).toEqual(["test/a.test.ts"]);
  });

  it("does not let a test result clear a same-path rewrite still in flight", async () => {
    const harness = createRequirementAuditHarness();
    await writeTest(harness.agent, "write-a", "test/a.test.ts");
    const testArgs = { command: "node --test test/a.test.ts" };
    await invokeBefore(harness.agent, "running-test", "bash", testArgs);
    const rewriteArgs = { path: "test/a.test.ts", content: "test('changed', () => {});\n" };
    await invokeBefore(harness.agent, "rewrite-a", "write", rewriteArgs);

    await invokeAfter(harness.agent, "running-test", "bash", testArgs, "tests 1 passed");

    expect(pending(harness.controller)).toEqual(["test/a.test.ts"]);
    await invokeAfter(harness.agent, "rewrite-a", "write", rewriteArgs, "wrote test");
  });

  it("blocks a compound mutation and publish command", async () => {
    const harness = createRequirementAuditHarness();
    declareTestOnlyTask(harness.controller);

    const result = await invokeBefore(harness.agent, "mutate-push", "bash", {
      command: "touch test/new.test.ts && git push",
    });

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("combine");
  });

  it("blocks an unclassified executable combined with publish", async () => {
    const harness = createRequirementAuditHarness();
    declareTestOnlyTask(harness.controller);

    const result = await invokeBefore(harness.agent, "generate-push", "bash", {
      command: "node generator.js && git push",
    });

    expect(result?.block).toBe(true);
    expect(result?.reason).toContain("combine");
  });

  it("blocks publish and successful finish while a test mutation is in flight", async () => {
    const harness = createRequirementAuditHarness();
    declareTestOnlyTask(harness.controller);
    const writeArgs = { path: "test/a.test.ts", content: "test('behavior', () => {});\n" };
    expect((await invokeBefore(harness.agent, "in-flight-write", "write", writeArgs))?.block).not.toBe(true);

    const publish = await invokeBefore(harness.agent, "racing-push", "bash", { command: "git push" });
    const finish = await invokeBefore(harness.agent, "racing-finish", "finish_work", { status: "success" });

    expect(publish?.block).toBe(true);
    expect(publish?.reason).toContain("in flight");
    expect(finish?.block).toBe(true);
    expect(finish?.reason).toContain("in flight");
    await invokeAfter(harness.agent, "in-flight-write", "write", writeArgs, "wrote test");
  });

  it("reserves explicit shell test paths before a batch executes", async () => {
    const harness = createRequirementAuditHarness();
    declareTestOnlyTask(harness.controller);

    const result = await invokeBefore(harness.agent, "shell-batch", "bash", {
      command: "touch test/a.test.ts test/b.test.ts test/c.test.ts test/d.test.ts",
    });

    expect(result?.block).toBe(true);
  });

  it("detects an already-dirty test rewritten by a shell command", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-test-authoring-dirty-"));
    try {
      await mkdir(join(cwd, "test"));
      await writeFile(join(cwd, "test/existing.test.js"), "export const value = 1;\n");
      await writeFile(join(cwd, "template.js"), "export const value = 2;\n");
      execFileSync("git", ["init", "-q"], { cwd });
      execFileSync("git", ["add", "."], { cwd });
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base"], {
        cwd,
      });
      const harness = createRequirementAuditHarness(SessionManager.inMemory(cwd));
      declareTestOnlyTask(harness.controller);
      const directArgs = { path: "test/existing.test.js", content: "export const value = 3;\n" };
      await invokeBefore(harness.agent, "direct-write", "write", directArgs);
      await writeFile(join(cwd, "test/existing.test.js"), directArgs.content);
      await invokeAfter(harness.agent, "direct-write", "write", directArgs, "wrote test");
      await pass(harness.agent, "first-pass", "node --test test/existing.test.js", "tests 1 passed");
      expect(pending(harness.controller)).toEqual([]);

      const shellArgs = { command: "cp template.js test/existing.test.js" };
      await invokeBefore(harness.agent, "shell-rewrite", "bash", shellArgs);
      await writeFile(join(cwd, "test/existing.test.js"), "export const value = 2;\n");
      await invokeAfter(harness.agent, "shell-rewrite", "bash", shellArgs, "copied");

      expect(pending(harness.controller)).toEqual(["test/existing.test.js"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fails closed on an overflowing pathless mutation outside Git", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-test-authoring-nongit-"));
    try {
      await mkdir(join(cwd, "test"));
      const harness = createRequirementAuditHarness(SessionManager.inMemory(cwd));
      declareTestOnlyTask(harness.controller);
      const args = { command: "node generator.js" };
      await invokeBefore(harness.agent, "generator", "bash", args);
      for (const name of ["a", "b", "c", "d"]) {
        await writeFile(join(cwd, `test/${name}.test.js`), `export const ${name} = true;\n`);
      }
      await invokeAfter(harness.agent, "generator", "bash", args, "generated tests");

      expect(pending(harness.controller)).toHaveLength(3);
      expect(harness.controller.currentState.unverifiedTestPathOverflow).toBe(true);
      expect((await invokeBefore(harness.agent, "finish", "finish_work", { status: "success" }))?.reason).toContain(
        "broad test run",
      );

      await pass(harness.agent, "broad", "node --test", "tests 4 passed");
      expect(pending(harness.controller)).toEqual([]);
      expect(harness.controller.currentState.unverifiedTestPathOverflow).toBe(false);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("detects a pathless mutation that rewrites a Git-ignored test", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-test-authoring-ignored-"));
    try {
      await mkdir(join(cwd, "test"));
      await writeFile(join(cwd, ".gitignore"), "test/\n");
      await writeFile(join(cwd, "test/ignored.test.js"), "export const ignored = false;\n");
      execFileSync("git", ["init", "-q"], { cwd });
      execFileSync("git", ["add", ".gitignore"], { cwd });
      execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.invalid", "commit", "-qm", "base"], {
        cwd,
      });
      const harness = createRequirementAuditHarness(SessionManager.inMemory(cwd));
      declareTestOnlyTask(harness.controller);
      const args = { command: "node generator.js" };
      await invokeBefore(harness.agent, "ignored-generator", "bash", args);
      await writeFile(join(cwd, "test/ignored.test.js"), "export const ignored = true;\n");
      await invokeAfter(harness.agent, "ignored-generator", "bash", args, "generated ignored test");

      expect(pending(harness.controller)).toEqual(["test/ignored.test.js"]);
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("fails closed when a pathless mutation attempt cannot be snapshotted", async () => {
    const cwd = join(tmpdir(), `p-test-authoring-missing-${Date.now()}`);
    const harness = createRequirementAuditHarness(SessionManager.inMemory(cwd));
    declareTestOnlyTask(harness.controller);
    const args = { command: "node generator.js" };

    await invokeBefore(harness.agent, "missing-generator", "bash", args);
    await invokeAfter(harness.agent, "missing-generator", "bash", args, "generator completed");

    expect(harness.controller.currentState.unverifiedTestPathOverflow).toBe(true);
  });

  it("settles mutation debt when an earlier after hook throws", async () => {
    const agent = new Agent();
    agent.afterToolCall = async () => {
      throw new Error("earlier hook failed");
    };
    const controller = createTaskVerificationController(SessionManager.inMemory());
    controller.install(agent);
    declareTestOnlyTask(controller);

    for (const [index, path] of ["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"].entries()) {
      const id = `throw-${index}`;
      const args = { path, content: "test('behavior', () => {});\n" };
      await invokeBefore(agent, id, "write", args);
      await expect(invokeAfter(agent, id, "write", args)).rejects.toThrow("earlier hook failed");
    }

    expect(pending(controller)).toEqual(["test/a.test.ts", "test/b.test.ts", "test/c.test.ts"]);
    const fourth = await invokeBefore(agent, "write-d", "write", {
      path: "test/d.test.ts",
      content: "test('d', () => {});\n",
    });
    expect(fourth?.block).toBe(true);
  });
});
