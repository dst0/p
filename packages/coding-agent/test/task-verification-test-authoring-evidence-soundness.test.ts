import { describe, expect, it } from "vitest";
import { hasPositivePassingTestResult } from "../src/core/task-verification/taskverificationcontroller-methods/test-invocation-selection.ts";
import type { TaskVerificationController } from "../src/core/task-verification.ts";
import { createRequirementAuditHarness } from "./task-requirement-audit-test-harness.ts";

function invocation(id: string, name: string, args: Record<string, unknown>) {
  return { args, toolCall: { type: "toolCall" as const, id, name, arguments: args } };
}

async function before(
  harness: ReturnType<typeof createRequirementAuditHarness>,
  id: string,
  name: string,
  args: Record<string, unknown>,
) {
  return harness.agent.beforeToolCall?.({
    assistantMessage: {} as never,
    ...invocation(id, name, args),
    context: {} as never,
  });
}

async function after(
  harness: ReturnType<typeof createRequirementAuditHarness>,
  id: string,
  name: string,
  args: Record<string, unknown>,
  output: string,
): Promise<void> {
  await harness.agent.afterToolCall?.({
    assistantMessage: {} as never,
    ...invocation(id, name, args),
    result: { content: [{ type: "text", text: output }], details: undefined },
    isError: false,
    context: {} as never,
  });
}

async function writeTest(
  harness: ReturnType<typeof createRequirementAuditHarness>,
  id: string,
  path: string,
): Promise<void> {
  const args = { path, content: "test('behavior', () => {});\n" };
  expect((await before(harness, id, "write", args))?.block).not.toBe(true);
  await after(harness, id, "write", args, "wrote test");
}

async function testRun(
  harness: ReturnType<typeof createRequirementAuditHarness>,
  id: string,
  command: string,
  output: string,
): Promise<void> {
  const args = { command };
  expect((await before(harness, id, "bash", args))?.block).not.toBe(true);
  await after(harness, id, "bash", args, output);
}

function pending(controller: TaskVerificationController): string[] {
  return controller.currentState.unverifiedTestPaths ?? [];
}

describe("task verification test-authoring evidence soundness", () => {
  it("does not clear whole-file debt from a vacuous test-name-filtered run", async () => {
    const harness = createRequirementAuditHarness();
    await writeTest(harness, "write-filtered", "test/a.test.ts");
    await testRun(harness, "filtered", "vitest test/a.test.ts -t '.*'", "tests 1 passed");
    expect(pending(harness.controller)).toEqual(["test/a.test.ts"]);
  });

  it("does not clear repository debt from a package-scoped run", async () => {
    const harness = createRequirementAuditHarness();
    await writeTest(harness, "write-scoped", "packages/a/test/a.test.ts");
    await testRun(harness, "scoped", "pnpm --filter package-a test", "tests 1 passed");
    expect(pending(harness.controller)).toEqual(["packages/a/test/a.test.ts"]);
  });

  it("does not hide a late failure behind the persisted output summary limit", async () => {
    const harness = createRequirementAuditHarness();
    await writeTest(harness, "write-late-failure", "test/a.test.ts");
    const output = `tests 1 passed\n${"x".repeat(600)}\ntests 1 failed`;
    await testRun(harness, "late-failure", "vitest test/a.test.ts", output);
    expect(pending(harness.controller)).toEqual(["test/a.test.ts"]);
  });

  it("does not accept generic compiler pass text as test evidence", async () => {
    const harness = createRequirementAuditHarness();
    await writeTest(harness, "write-generic", "test/a.test.ts");
    await testRun(harness, "generic", "vitest test/a.test.ts", "compiler pass 1 completed");
    expect(pending(harness.controller)).toEqual(["test/a.test.ts"]);
  });

  it("does not clear test debt when console.assert reports a failure with a zero exit", async () => {
    const harness = createRequirementAuditHarness();
    await writeTest(harness, "write-console-assert", "test/a.test.ts");
    await testRun(
      harness,
      "console-assert",
      "node --test test/a.test.ts",
      "Assertion failed: expected invariant\nℹ pass 1\nℹ fail 0",
    );
    expect(pending(harness.controller)).toEqual(["test/a.test.ts"]);
    expect(hasPositivePassingTestResult("Assertion failed: expected invariant\nℹ pass 1\nℹ fail 0")).toBe(false);
  });
});
