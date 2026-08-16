import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";

function createInstalledController(sessionManager = SessionManager.inMemory()) {
  let subscriber: Parameters<Agent["subscribe"]>[0] | undefined;
  const agent = new Agent();
  const orig = agent.subscribe.bind(agent);
  agent.subscribe = (l: Parameters<Agent["subscribe"]>[0]) => {
    subscriber = l;
    return orig(l);
  };
  const controller = createTaskVerificationController(sessionManager);
  controller.install(agent);
  return {
    agent,
    controller,
    sessionManager,
    sendUserMessage: (text: string) => {
      subscriber?.(
        { type: "message_start", message: { role: "user", content: text } } as never,
        new AbortController().signal,
      );
    },
  };
}

async function callVerificationTool(controller: TaskVerificationController, params: Record<string, unknown>) {
  try {
    const res = await controller.toolDefinition.execute("v-call", params as never, undefined, undefined, {} as never);
    const text = res.content
      .filter((p) => p.type === "text")
      .map((p) => (p as { text: string }).text)
      .join("\n");
    return { isError: false, text };
  } catch (error) {
    return { isError: true, text: error instanceof Error ? error.message : String(error) };
  }
}

async function executeTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  opts: { isError?: boolean; text?: string } = {},
) {
  const call = { type: "toolCall" as const, id: `${name}-call-${Math.random()}`, name, arguments: args };
  const before = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    context: {} as never,
  });
  if (before?.block) return { before, output: undefined };
  const res = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    result: { content: [{ type: "text", text: opts.text ?? "ok" }], details: undefined },
    isError: opts.isError ?? false,
    context: {} as never,
  });
  const output = res?.content
    ?.filter((p) => p.type === "text")
    .map((p) => (p as { text: string }).text)
    .join("\n");
  return { before, output };
}

function evidenceHandle(text: string | undefined): string {
  const match = text?.match(/Verification evidence handle: (verification-evidence-\d+)/u);
  if (!match?.[1]) throw new Error(`Missing evidence handle in: ${text}`);
  return match[1];
}

describe("Task Verification Lifecycle and Session Recovery", () => {
  it("automatically resets to conversational mode and restores cleanly across sessions", async () => {
    const sessionManager = SessionManager.inMemory();
    const { agent, controller, sendUserMessage } = createInstalledController(sessionManager);
    sendUserMessage("Добавь новую утилиту formatting.ts");

    await executeTool(agent, "write", { path: "src/formatting.ts" });
    expect(controller.executionMode).toBe("development");
    expect(controller.state.mutationRevision).toBe(1);

    const testRun = await executeTool(
      agent,
      "bash",
      { command: "node --test test/formatting.test.ts" },
      { isError: false },
    );
    const testHandle = evidenceHandle(testRun.output);

    await callVerificationTool(controller, {
      action: "record_final",
      final_method: "focused_test",
      final_status: "passed",
      evidence_refs: [testHandle],
    });

    const ready = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "formatting passes test", evidence_refs: [testHandle] }],
      unresolved_failures: [],
    });
    expect(ready.isError).toBe(false);

    await executeTool(agent, "finish_work", { status: "success", summary: "Утилита готова" });

    expect(controller.executionMode).toBe("conversational");
    expect(controller.currentState.mode).toBe("conversational");
    expect(controller.state.mutationRevision).toBe(0);
    expect(controller.evidence.size).toBe(0);

    const restoredController = createTaskVerificationController(sessionManager);
    expect(restoredController.executionMode).toBe("conversational");
    expect(restoredController.currentState.mode).toBe("conversational");
    expect(restoredController.state.mutationRevision).toBe(0);
    expect(restoredController.evidence.size).toBe(0);
  });

  it("handles complete mutation recovery loop under revision 2", async () => {
    const { agent, controller, sendUserMessage } = createInstalledController();
    sendUserMessage("Добавь модуль кэширования");

    await executeTool(agent, "write", { path: "src/cache.ts" });
    expect(controller.state.mutationRevision).toBe(1);

    const test1 = await executeTool(agent, "bash", { command: "npm test test/cache.test.ts" }, { isError: false });
    const handle1 = evidenceHandle(test1.output);

    await callVerificationTool(controller, {
      action: "record_final",
      final_method: "focused_test",
      final_status: "passed",
      evidence_refs: [handle1],
    });

    const ready1 = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "Cache tests pass", evidence_refs: [handle1] }],
      unresolved_failures: [],
    });
    expect(ready1.isError).toBe(false);
    expect(controller.state.readiness?.status).toBe("ready");

    await executeTool(agent, "edit", { path: "src/cache.ts" });
    expect(controller.state.mutationRevision).toBe(2);
    expect(controller.state.readiness?.status).toBe("pending");

    const staleFinish = await executeTool(agent, "finish_work", {
      status: "success",
      summary: "Attempt with stale state",
    });
    expect(staleFinish.before?.block).toBe(true);
    expect(staleFinish.before?.reason).toContain("semantic verification has not passed after mutation revision 2");

    const staleReady = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "Stale test handle", evidence_refs: [handle1] }],
      unresolved_failures: [],
    });
    expect(staleReady.isError).toBe(false);
    expect(staleReady.text).toContain("semantic verification has not passed after mutation revision 2");

    const test2 = await executeTool(agent, "bash", { command: "npm test test/cache.test.ts" }, { isError: false });
    const handle2 = evidenceHandle(test2.output);

    await callVerificationTool(controller, {
      action: "record_final",
      final_method: "focused_test",
      final_status: "passed",
      evidence_refs: [handle2],
    });

    const ready2 = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "Cache tests pass on revision 2", evidence_refs: [handle2] }],
      unresolved_failures: [],
    });
    expect(ready2.isError).toBe(false);
    expect(controller.state.readiness?.status).toBe("ready");

    const finish2 = await executeTool(agent, "finish_work", { status: "success", summary: "Final revision 2 done" });
    expect(finish2.before?.block).toBeUndefined();
  });

  it("resets state on finish_work with failed or partial status", async () => {
    const { agent, controller, sendUserMessage } = createInstalledController();
    sendUserMessage("Экспериментальная функция");

    await executeTool(agent, "write", { path: "src/exp.ts" });
    expect(controller.state.mutationRevision).toBe(1);
    expect(controller.executionMode).toBe("development");

    await executeTool(agent, "finish_work", {
      status: "partial",
      summary: "Blocked on external dependency",
      remaining_work: ["external API"],
    });
    expect(controller.executionMode).toBe("conversational");
    expect(controller.state.mutationRevision).toBe(0);
  });
});
