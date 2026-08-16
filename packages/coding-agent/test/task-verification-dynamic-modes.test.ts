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

function verificationToken(text: string): string {
  const match = text.match(/verification_token:\s*([a-f0-9-]+)/iu);
  if (!match?.[1]) throw new Error(`Missing verification token in: ${text}`);
  return match[1];
}

describe("Dynamic Session Modes & Zero-Friction Verification", () => {
  it("starts in conversational mode and allows finish_work without verification token", async () => {
    const { agent, controller, sendUserMessage } = createInstalledController();
    sendUserMessage("Привет, как работает архитектура этого модуля?");
    expect(controller.executionMode).toBe("conversational");
    expect(controller.currentState.mode).toBe("conversational");
    expect(controller.state.mutationRevision).toBe(0);

    const finish = await executeTool(agent, "finish_work", { status: "success", summary: "Объяснил архитектуру" });
    expect(finish.before?.block).toBeUndefined();
  });

  it("transitions to research mode upon reading or searching without requiring tokens", async () => {
    const { agent, controller, sendUserMessage } = createInstalledController();
    sendUserMessage("Найди где объявляется класс AgentSession и посмотри логи");
    expect(controller.executionMode).toBe("conversational");

    const read = await executeTool(
      agent,
      "read",
      { path: "src/core/agentsession.ts" },
      { text: "class AgentSession {}" },
    );
    expect(evidenceHandle(read.output)).toBe("verification-evidence-1");
    expect(controller.executionMode).toBe("research");
    expect(controller.currentState.mode).toBe("research");
    expect(controller.state.mutationRevision).toBe(0);

    const search = await executeTool(agent, "rg", { query: "AgentSession" }, { text: "matches" });
    expect(evidenceHandle(search.output)).toBe("verification-evidence-2");
    expect(controller.executionMode).toBe("research");

    const finish = await executeTool(agent, "finish_work", { status: "success", summary: "Исследование завершено" });
    expect(finish.before?.block).toBeUndefined();
  });

  it("transitions to development mode upon direct mutation and enforces verification lifecycle", async () => {
    const { agent, controller, sendUserMessage } = createInstalledController();
    sendUserMessage("Исправь баг в парсере: добавь валидацию пустых строк");

    const repro = await executeTool(agent, "bash", { command: "node --test test/parser.test.ts" }, { isError: true });
    const baselineHandle = evidenceHandle(repro.output);

    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix parser bug",
    });
    const baseRes = await callVerificationTool(controller, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "empty string unhandled",
      conclusion: "parser throws AssertionError",
      evidence_refs: [baselineHandle],
    });
    expect(baseRes.isError).toBe(false);
    expect(controller.state.baseline.status).toBe("satisfied");
    expect(controller.executionMode).toBe("research");

    await executeTool(agent, "edit", { path: "src/parser.ts" });
    expect(controller.executionMode).toBe("development");
    expect(controller.currentState.mode).toBe("development");
    expect(controller.state.mutationRevision).toBe(1);

    const premature = await executeTool(agent, "finish_work", { status: "success", summary: "Premature" });
    expect(premature.before?.block).toBe(true);
    expect(premature.before?.reason).toContain("semantic verification has not passed");

    const finalRun = await executeTool(
      agent,
      "bash",
      { command: "node --test test/parser.test.ts" },
      { isError: false },
    );
    const finalHandle = evidenceHandle(finalRun.output);

    const uncertified = await executeTool(agent, "finish_work", { status: "success", summary: "Uncertified" });
    expect(uncertified.before?.block).toBe(true);
    expect(uncertified.before?.reason).toContain("ready_to_finish");

    const readyResult = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "Validation error on empty string", evidence_refs: [finalHandle] }],
      unresolved_failures: [],
    });
    expect(readyResult.isError).toBe(false);
    const token = verificationToken(readyResult.text);

    const wrongToken = await executeTool(agent, "finish_work", {
      status: "success",
      summary: "Wrong",
      verification_token: "invalid-uuid",
    });
    expect(wrongToken.before?.block).toBe(true);
    expect(wrongToken.before?.reason).toContain("exact verification_token");

    const omittedToken = await executeTool(agent, "finish_work", { status: "success", summary: "Done without token" });
    expect(omittedToken.before?.block).toBeUndefined();

    const explicitToken = await executeTool(agent, "finish_work", {
      status: "success",
      summary: "Done with token",
      verification_token: token,
    });
    expect(explicitToken.before?.block).toBeUndefined();
  });

  it("transitions to development mode upon shell-driven mutation", async () => {
    const { agent, controller, sendUserMessage } = createInstalledController();
    sendUserMessage("Сгенерируй код миграции через npm script");

    expect(controller.executionMode).toBe("conversational");
    await executeTool(agent, "bash", { command: "touch src/migration.ts" });

    expect(controller.executionMode).toBe("development");
    expect(controller.state.mutationRevision).toBe(1);
  });

  it("allows non-code tasks to complete without readiness certificates", async () => {
    const { agent, controller, sendUserMessage } = createInstalledController();
    sendUserMessage("Обнови документацию в README.md");

    await callVerificationTool(controller, { action: "declare_task", task_kind: "docs", task_summary: "Update docs" });
    await executeTool(agent, "write", { path: "README.md" });
    expect(controller.executionMode).toBe("development");

    const read1 = await executeTool(agent, "read", { path: "README.md" }, { text: "new docs" });
    const handle1 = evidenceHandle(read1.output);
    const read2 = await executeTool(agent, "rg", { query: "README" }, { text: "new docs" });
    const handle2 = evidenceHandle(read2.output);

    const recordRes = await callVerificationTool(controller, {
      action: "record_final",
      final_method: "static_review",
      final_status: "passed",
      evidence_refs: [handle1, handle2],
    });
    expect(recordRes.isError).toBe(false);

    const finish = await executeTool(agent, "finish_work", { status: "success", summary: "README updated" });
    expect(finish.before?.block).toBeUndefined();
  });
});
