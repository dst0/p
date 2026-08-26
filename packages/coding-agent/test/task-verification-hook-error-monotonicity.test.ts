import { type AfterToolCallResult, Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";

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
