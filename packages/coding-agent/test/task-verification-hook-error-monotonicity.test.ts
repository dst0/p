import { type AfterToolCallResult, Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import { callTaskVerification } from "./task-requirement-audit-test-harness.ts";

describe("task verification hook error monotonicity", () => {
  it("does not let a hook demote a native failing command into passing evidence", async () => {
    const { agent, controller } = harness(async ({ result }) => ({
      content: result.content,
      isError: false,
    }));

    const result = await callTool(agent, "bash", { command: "node --test test/failure.test.ts" }, true);
    const evidence = [...controller.evidence.values()][0];

    expect(result?.isError).toBe(true);
    expect(evidence).toMatchObject({
      toolName: "bash",
      nativeIsError: true,
      isError: true,
      mutationRevision: 0,
    });
  });

  it("tracks a successful direct mutation when a hook promotes only its presentation error", async () => {
    const { agent, controller } = harness(async ({ result }) => ({
      content: result.content,
      isError: true,
    }));

    const result = await callTool(
      agent,
      "write",
      { path: "src/example.ts", content: "export const value = 1;\n" },
      false,
    );

    expect(result?.isError).toBe(true);
    expect(controller.currentState.mutationRevision).toBe(1);
    expect(controller.evidence.size).toBe(0);
  });

  it("preserves a hook-promoted failure for native successful command evidence", async () => {
    const { agent, controller } = harness(async ({ result }) => ({
      content: result.content,
      isError: true,
    }));

    const result = await callTool(agent, "bash", { command: "node --test test/success.test.ts" }, false);
    const evidence = [...controller.evidence.values()][0];

    expect(result?.isError).toBe(true);
    expect(evidence).toMatchObject({ nativeIsError: false, isError: true, mutationRevision: 0 });
  });

  it("does not demote a native failure returned through a non-evidence tool path", async () => {
    const { agent, controller } = harness(async ({ result }) => ({
      content: result.content,
      isError: false,
    }));

    const result = await callTool(agent, "write", { path: "src/example.ts", content: "invalid" }, true);

    expect(result?.isError).toBe(true);
    expect(controller.currentState.mutationRevision).toBe(0);
    expect(controller.evidence.size).toBe(0);
  });

  it("records native successful evidence as failed when an earlier hook throws", async () => {
    const hookError = new Error("presentation hook failed");
    let throwFromHook = false;
    const { agent, controller } = harness(async () => {
      if (throwFromHook) throw hookError;
      return undefined;
    });
    const command = "node --test test/success.test.ts";
    await callTaskVerification(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Keep thrown result hooks from accepting verification evidence",
    });
    await callTool(agent, "bash", { command }, true);
    const baselineEvidence = [...controller.evidence.values()][0];
    expect(baselineEvidence).toBeDefined();
    await callTaskVerification(controller, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "The result hook failure can accept passing replay evidence",
      conclusion: "The focused regression reproduces the evidence boundary defect",
      evidence_refs: [baselineEvidence?.ref],
      unresolved_assumptions: [],
    });
    await callTool(agent, "write", { path: "src/example.ts", content: "export const value = 2;\n" }, false);
    throwFromHook = true;

    await expect(callTool(agent, "bash", { command }, false)).rejects.toBe(hookError);
    const evidence = [...controller.evidence.values()].at(-1);

    expect(evidence).toMatchObject({ nativeIsError: false, isError: true, mutationRevision: 1 });
    expect(controller.currentState.final.status).toBe("pending");
  });

  it("still settles a native successful mutation when an earlier hook throws", async () => {
    const hookError = new Error("presentation hook failed");
    const { agent, controller } = harness(async () => {
      throw hookError;
    });

    await expect(
      callTool(agent, "write", { path: "src/example.ts", content: "export const value = 2;\n" }, false),
    ).rejects.toBe(hookError);

    expect(controller.currentState.mutationRevision).toBe(1);
    expect(controller.evidence.size).toBe(0);
  });
});

function harness(priorHook: NonNullable<Agent["afterToolCall"]>): {
  agent: Agent;
  controller: TaskVerificationController;
} {
  const agent = new Agent();
  agent.afterToolCall = priorHook;
  const controller = createTaskVerificationController(SessionManager.inMemory());
  controller.install(agent);
  return { agent, controller };
}

async function callTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  isError: boolean,
): Promise<AfterToolCallResult | undefined> {
  return agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall: { type: "toolCall", id: `${name}-error-boundary`, name, arguments: args },
    args,
    result: { content: [{ type: "text", text: isError ? "native failure" : "ok" }], details: undefined },
    isError,
    context: {} as never,
  });
}
