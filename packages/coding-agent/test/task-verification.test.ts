import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  createTaskVerificationController,
  TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE,
  TASK_VERIFICATION_STATE_CUSTOM_TYPE,
  TASK_VERIFICATION_TOOL_NAME,
  type TaskVerificationController,
} from "../src/core/task-verification.ts";

function createInstalledController(): {
  agent: Agent;
  controller: TaskVerificationController;
  sessionManager: SessionManager;
} {
  const agent = new Agent();
  const sessionManager = SessionManager.inMemory();
  const controller = createTaskVerificationController(sessionManager);
  controller.install(agent);
  return { agent, controller, sessionManager };
}

async function callVerificationTool(
  controller: TaskVerificationController,
  params: Record<string, unknown>,
): Promise<{ isError: boolean; text: string }> {
  try {
    const result = await controller.toolDefinition.execute(
      "verification-call",
      params as never,
      undefined,
      undefined,
      {} as never,
    );
    const text = result.content
      .filter((part): part is Extract<(typeof result.content)[number], { type: "text" }> => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    return { isError: false, text };
  } catch (error) {
    return { isError: true, text: error instanceof Error ? error.message : String(error) };
  }
}

function createToolCall(name: string, args: Record<string, unknown>) {
  return {
    type: "toolCall" as const,
    id: `${name}-${Math.random()}`,
    name,
    arguments: args,
  };
}

async function beforeTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
): Promise<{ block?: boolean; reason?: string } | undefined> {
  const toolCall = createToolCall(name, args);
  return agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    context: {} as never,
  });
}

async function afterTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  options: { isError?: boolean; text?: string } = {},
): Promise<string | undefined> {
  const toolCall = createToolCall(name, args);
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    result: {
      content: [{ type: "text", text: options.text ?? "ok" }],
      details: undefined,
    },
    isError: options.isError ?? false,
    context: {} as never,
  });
  return result?.content
    ?.filter(
      (part): part is Extract<NonNullable<typeof result.content>[number], { type: "text" }> => part.type === "text",
    )
    .map((part) => part.text)
    .join("\n");
}

function evidenceHandle(text: string | undefined): string {
  const match = text?.match(/Verification evidence handle: (verification-evidence-\d+)/u);
  if (!match) throw new Error(`Missing evidence handle in: ${text ?? "<empty>"}`);
  return match[1];
}

describe("task verification controller", () => {
  it("blocks mutation until the task and required baseline are verified", async () => {
    const { agent, controller } = createInstalledController();

    const undeclared = await beforeTool(agent, "edit", { path: "a.ts", edits: [] });
    expect(undeclared?.block).toBe(true);
    expect(undeclared?.reason).toContain(TASK_VERIFICATION_TOOL_NAME);

    const declared = await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix refresh state loss after daemon restart",
    });
    expect(declared.isError).toBe(false);

    const withoutBaseline = await beforeTool(agent, "edit", { path: "a.ts", edits: [] });
    expect(withoutBaseline?.block).toBe(true);
    expect(withoutBaseline?.reason).toContain("baseline");

    const reproduction = evidenceHandle(
      await afterTool(agent, "bash", { command: "node test/reproduce-restart.js" }, { text: "reproduced" }),
    );
    const baseline = await callVerificationTool(controller, {
      action: "record_baseline",
      baseline_method: "runtime_reproduction",
      hypothesis: "SIGTERM interrupts the active refresh before durable state is committed",
      conclusion: "The restart begins from the prior manifest and repeats the interrupted refresh",
      evidence_refs: [reproduction],
      unresolved_assumptions: [],
    });
    expect(baseline.isError).toBe(false);
    expect((await beforeTool(agent, "edit", { path: "a.ts", edits: [] }))?.block).not.toBe(true);
  });

  it("allows only explicitly authorized regression-test edits before baseline", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix completion without semantic verification",
    });

    expect((await beforeTool(agent, "edit", { path: "src/completion.ts", edits: [] }))?.block).toBe(true);
    const authorized = await callVerificationTool(controller, {
      action: "authorize_baseline_test",
      test_paths: ["test/completion-regression.test.ts"],
    });
    expect(authorized.isError).toBe(false);
    expect(
      (await beforeTool(agent, "edit", { path: "test/completion-regression.test.ts", edits: [] }))?.block,
    ).not.toBe(true);
    expect((await beforeTool(agent, "write", { path: "src/not-a-test.ts", content: "" }))?.block).toBe(true);

    await afterTool(agent, "edit", {
      path: "test/completion-regression.test.ts",
      edits: [{ oldText: "old", newText: "failing regression" }],
    });
    expect(controller.currentState.mutationRevision).toBe(0);
    expect(controller.currentState.baseline.testSetupChanged).toBe(true);

    const failingTest = evidenceHandle(
      await afterTool(
        agent,
        "bash",
        { command: "vitest --run test/completion-regression.test.ts" },
        { isError: true, text: "expected failure" },
      ),
    );
    const baseline = await callVerificationTool(controller, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "Successful completion accepts generic checks without behavioral evidence",
      conclusion: "The focused regression fails against the current implementation",
      evidence_refs: [failingTest],
      unresolved_assumptions: [],
    });
    expect(baseline.isError).toBe(false);
    expect((await beforeTool(agent, "edit", { path: "src/completion.ts", edits: [] }))?.block).not.toBe(true);
  });

  it("rejects static baseline evidence for lifecycle and persistence work", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix SIGTERM restart recovery for persisted indexing manifests",
    });
    const firstRead = evidenceHandle(await afterTool(agent, "read", { path: "daemon.ts" }));
    const secondRead = evidenceHandle(await afterTool(agent, "read", { path: "manifest.ts" }));

    const staticBaseline = await callVerificationTool(controller, {
      action: "record_baseline",
      baseline_method: "static_trace",
      hypothesis: "The signal bypasses the normal completion path",
      conclusion: "The manifest write occurs only after refresh completion",
      evidence_refs: [firstRead, secondRead],
      unresolved_assumptions: [],
    });
    expect(staticBaseline.isError).toBe(true);
    expect(staticBaseline.text).toContain("Static trace is insufficient");
  });

  it("requires fresh semantic evidence after the final mutation", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Add a deterministic verification gate",
    });

    await afterTool(agent, "edit", { path: "gate.ts", edits: [{ oldText: "a", newText: "b" }] });
    const unfinished = await beforeTool(agent, "finish_work", { status: "success" });
    expect(unfinished?.block).toBe(true);
    expect(unfinished?.reason).toContain("semantic verification");

    const reproduction = evidenceHandle(
      await afterTool(agent, "bash", { command: "node test/manual-gate-check.js" }, { text: "gate passed" }),
    );
    const final = await callVerificationTool(controller, {
      action: "record_final",
      final_method: "manual_reproduction",
      final_status: "passed",
      expected_behavior: "Mutations remain blocked until the required verification state is satisfied",
      observed_behavior: "The manual gate check passed for the current implementation",
      evidence_refs: [reproduction],
      unresolved_failures: [],
    });
    expect(final.isError).toBe(false);
    expect((await beforeTool(agent, "finish_work", { status: "success" }))?.block).not.toBe(true);
    expect((await beforeTool(agent, "bash", { command: "git commit -m test" }))?.block).not.toBe(true);

    await afterTool(agent, "edit", { path: "gate.ts", edits: [{ oldText: "b", newText: "c" }] });
    expect((await beforeTool(agent, "finish_work", { status: "success" }))?.block).toBe(true);

    const staleFinal = await callVerificationTool(controller, {
      action: "record_final",
      final_method: "manual_reproduction",
      final_status: "passed",
      expected_behavior: "The gate remains correct",
      observed_behavior: "Only evidence from the previous mutation revision is available",
      evidence_refs: [reproduction],
      unresolved_failures: [],
    });
    expect(staleFinal.isError).toBe(true);
    expect(staleFinal.text).toContain("stale");
  });

  it("does not accept generic checks as behavioral verification", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix an incorrect completion gate",
    });
    const baseline = evidenceHandle(
      await afterTool(agent, "bash", { command: "node test/reproduce-completion.js" }, { text: "reproduced" }),
    );
    await callVerificationTool(controller, {
      action: "record_baseline",
      baseline_method: "runtime_reproduction",
      hypothesis: "The current gate accepts incomplete verification",
      conclusion: "The reproduction completed without a semantic check",
      evidence_refs: [baseline],
      unresolved_assumptions: [],
    });
    await afterTool(agent, "edit", { path: "completion.ts", edits: [{ oldText: "old", newText: "new" }] });
    const genericCheck = evidenceHandle(await afterTool(agent, "bash", { command: "npm run check" }, { text: "ok" }));

    const final = await callVerificationTool(controller, {
      action: "record_final",
      final_method: "manual_reproduction",
      final_status: "passed",
      expected_behavior: "Incomplete semantic verification is rejected",
      observed_behavior: "Only the generic repository check was executed",
      evidence_refs: [genericCheck],
      unresolved_failures: [],
    });
    expect(final.isError).toBe(true);
    expect(final.text).toContain("non-generic bash evidence");
  });

  it("restores verification state and evidence from durable session entries", async () => {
    const sessionManager = SessionManager.inMemory();
    const firstAgent = new Agent();
    const first = createTaskVerificationController(sessionManager);
    first.install(firstAgent);
    await callVerificationTool(first, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Persist verification state",
    });
    const handle = evidenceHandle(await afterTool(firstAgent, "read", { path: "state.ts" }));
    expect(handle).toBe("verification-evidence-1");

    const restored = createTaskVerificationController(sessionManager);
    const status = await callVerificationTool(restored, { action: "status" });
    expect(status.text).toContain("Persist verification state");
    expect(status.text).toContain(handle);
    expect(
      sessionManager
        .getBranch()
        .some((entry) => entry.type === "custom" && entry.customType === TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE),
    ).toBe(true);
  });
  it("explains the exact next regression step proactively and in blocked gate errors", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix completion regression after compaction",
    });
    await callVerificationTool(controller, {
      action: "authorize_baseline_test",
      test_paths: ["test/completion-compaction.test.ts"],
    });

    const proactive = await callVerificationTool(controller, { action: "status" });
    expect(proactive.text).toContain("NEXT REQUIRED ACTION");
    expect(proactive.text).toContain("test/completion-compaction.test.ts");
    expect(proactive.text).toContain("Only these paths are currently writable");

    const blocked = await beforeTool(agent, "edit", { path: "src/completion.ts", edits: [] });
    expect(blocked?.block).toBe(true);
    expect(blocked?.reason).toContain("NEXT REQUIRED ACTION");
    expect(blocked?.reason).toContain("test/completion-compaction.test.ts");
    expect(blocked?.reason).toContain('{"action":"status"}');
  });

  it("restores exact regression commands and repair payloads after session reconstruction", async () => {
    const sessionManager = SessionManager.inMemory();
    const firstAgent = new Agent();
    const first = createTaskVerificationController(sessionManager);
    first.install(firstAgent);
    await callVerificationTool(first, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix restored regression guidance",
    });
    await callVerificationTool(first, {
      action: "authorize_baseline_test",
      test_paths: ["test/restored-regression.test.ts"],
    });
    await afterTool(firstAgent, "edit", {
      path: "test/restored-regression.test.ts",
      edits: [{ oldText: "old", newText: "failing regression" }],
    });
    const command = "vitest --run test/restored-regression.test.ts";
    const failedHandle = evidenceHandle(
      await afterTool(firstAgent, "bash", { command }, { isError: true, text: "expected failure" }),
    );

    const restoredBaseline = createTaskVerificationController(sessionManager);
    const baselineStatus = await callVerificationTool(restoredBaseline, { action: "status" });
    expect(baselineStatus.text).toContain(command);
    expect(baselineStatus.text).toContain(failedHandle);
    expect(baselineStatus.text).toContain('"baseline_method":"failing_regression_test"');

    await callVerificationTool(restoredBaseline, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "The old behavior violates the completion contract",
      conclusion: "The focused test reproduces the regression",
      evidence_refs: [failedHandle],
      unresolved_assumptions: [],
    });
    const secondAgent = new Agent();
    restoredBaseline.install(secondAgent);
    await afterTool(secondAgent, "edit", {
      path: "src/completion.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });

    const restoredFinal = createTaskVerificationController(sessionManager);
    const finalStatus = await callVerificationTool(restoredFinal, { action: "status" });
    expect(finalStatus.text).toContain(`Required exact replay command: ${command}`);
    expect(finalStatus.text).toContain("mutation revision 1");

    const finalAgent = new Agent();
    restoredFinal.install(finalAgent);
    const blockedFinish = await beforeTool(finalAgent, "finish_work", { status: "success" });
    expect(blockedFinish?.reason).toContain(command);
    expect(blockedFinish?.reason).toContain('{"action":"status"}');
  });

  it("does not suggest unrelated passing evidence when an exact baseline replay is required", async () => {
    const sessionManager = SessionManager.inMemory();
    const baselineAgent = new Agent();
    const baselineController = createTaskVerificationController(sessionManager);
    baselineController.install(baselineAgent);
    await callVerificationTool(baselineController, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix exact replay recovery after compaction",
    });
    await callVerificationTool(baselineController, {
      action: "authorize_baseline_test",
      test_paths: ["test/exact-replay.test.ts"],
    });
    await afterTool(baselineAgent, "edit", {
      path: "test/exact-replay.test.ts",
      edits: [{ oldText: "old", newText: "failing" }],
    });
    const replayCommand = "vitest --run test/exact-replay.test.ts";
    const baselineHandle = evidenceHandle(
      await afterTool(baselineAgent, "bash", { command: replayCommand }, { isError: true, text: "expected failure" }),
    );
    await callVerificationTool(baselineController, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "The existing implementation violates the required behavior",
      conclusion: "The focused regression reproduces the defect",
      evidence_refs: [baselineHandle],
      unresolved_assumptions: [],
    });
    await afterTool(baselineAgent, "edit", {
      path: "src/exact-replay.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    const unrelatedHandle = evidenceHandle(
      await afterTool(baselineAgent, "bash", { command: "vitest --run test/unrelated.test.ts" }, { text: "passed" }),
    );

    const restored = createTaskVerificationController(sessionManager);
    const beforeReplay = await callVerificationTool(restored, { action: "status" });
    expect(beforeReplay.text).toContain(`Required exact replay command: ${replayCommand}`);
    expect(beforeReplay.text).toContain("Do not substitute another focused test");
    expect(beforeReplay.text).not.toContain(`Use evidence_refs: ["${unrelatedHandle}"]`);
    expect(beforeReplay.text).not.toContain('"action":"record_final"');

    const restoredAgent = new Agent();
    restored.install(restoredAgent);
    const replayHandle = evidenceHandle(
      await afterTool(restoredAgent, "bash", { command: replayCommand }, { text: "passed" }),
    );
    const afterReplay = await callVerificationTool(restored, { action: "status" });
    expect(afterReplay.text).toContain(`Use evidence_refs: ["${replayHandle}"]`);
    expect(afterReplay.text).toContain('"final_method":"focused_test"');
    expect(afterReplay.text).toContain('"action":"record_final"');
  });

  it("offers a valid two-handle static-review payload for non-behavioral work", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "docs",
      task_summary: "Clarify verification documentation",
    });
    await afterTool(agent, "edit", {
      path: "docs/verification.md",
      edits: [{ oldText: "old", newText: "new" }],
    });
    const first = evidenceHandle(await afterTool(agent, "read", { path: "docs/verification.md" }));
    const second = evidenceHandle(await afterTool(agent, "read", { path: "README.md" }));

    const status = await callVerificationTool(controller, { action: "status" });
    expect(status.text).toContain('"final_method":"static_review"');
    expect(status.text).toContain(`"evidence_refs":["${first}","${second}"]`);

    const final = await callVerificationTool(controller, {
      action: "record_final",
      final_method: "static_review",
      final_status: "passed",
      expected_behavior: "The documentation accurately describes verification recovery",
      observed_behavior: "Both relevant documents were inspected after the edit",
      evidence_refs: [first, second],
      unresolved_failures: [],
    });
    expect(final.isError).toBe(false);
  });

  it("uses persisted task context to preserve high-risk baseline guidance after restoration", async () => {
    const sessionManager = SessionManager.inMemory();
    sessionManager.appendCustomEntry(TASK_VERIFICATION_STATE_CUSTOM_TYPE, {
      version: 1,
      taskKind: "bug_fix",
      taskSummary: "Fix the reported issue",
      taskContext: "The daemon restart loses persisted indexing state and recovery repeats work",
      mutationRevision: 0,
      baseline: {
        required: true,
        status: "pending",
        evidenceRefs: [],
        authorizedTestPaths: [],
        testSetupChanged: false,
      },
      final: { status: "pending", evidenceRefs: [], unresolvedFailures: [] },
      updatedAt: new Date().toISOString(),
    });
    const agent = new Agent();
    const controller = createTaskVerificationController(sessionManager);
    controller.install(agent);
    await afterTool(agent, "read", { path: "src/daemon.ts" });
    await afterTool(agent, "read", { path: "src/manifest.ts" });

    const status = await callVerificationTool(controller, { action: "status" });
    expect(status.text).toContain("lifecycle/durability task");
    expect(status.text).not.toContain('"baseline_method":"static_trace"');
  });

  it("recognizes tool aliases (ctx_shell, ctx_read, replace_file_content) and generates evidence handles", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix tool alias evidence handling",
    });

    const ctxReadOutput = await afterTool(agent, "ctx_read", { path: "src/daemon.ts" });
    expect(ctxReadOutput).toContain("Verification evidence handle: verification-evidence-1");

    const ctxShellOutput = await afterTool(
      agent,
      "ctx_shell",
      { command: "npx vitest run test/suite/agent-session.test.ts" },
      { isError: true, text: "1 failed test" },
    );
    expect(ctxShellOutput).toContain("Verification evidence handle: verification-evidence-2");

    const baseline = await callVerificationTool(controller, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "The tool wrapper did not register evidence",
      conclusion: "Evidence handles are created for tool aliases",
      evidence_refs: ["verification-evidence-2"],
      unresolved_assumptions: [],
    });
    expect(baseline.isError).toBe(false);
  });

  it("supports toolCallId and @toolCallId references in resolveEvidence", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix toolCallId resolution",
    });

    const toolCall = createToolCall("ctx_shell", { command: "npx vitest run test/suite/foo.test.ts" });
    await agent.afterToolCall?.({
      assistantMessage: {} as never,
      toolCall,
      args: toolCall.arguments,
      result: { content: [{ type: "text", text: "1 failed" }], details: undefined },
      isError: true,
      context: {} as never,
    });

    const baselineWithAt = await callVerificationTool(controller, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "Using @toolCallId should resolve to the evidence entry",
      conclusion: "Evidence resolution handles @toolCallId",
      evidence_refs: [`@${toolCall.id}`],
      unresolved_assumptions: [],
    });
    expect(baselineWithAt.isError).toBe(false);
  });

  it("rejects pipelined test commands for test verification evidence", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Disallow pipelined test commands",
    });

    const pipedTest = evidenceHandle(
      await afterTool(
        agent,
        "ctx_shell",
        { command: "npx vitest run test/suite/foo.test.ts 2>&1 | tail -10" },
        { isError: true, text: "failed" },
      ),
    );

    const baseline = await callVerificationTool(controller, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "Pipelined command masks exit code",
      conclusion: "Pipelined command should be rejected",
      evidence_refs: [pipedTest],
      unresolved_assumptions: [],
    });
    expect(baseline.isError).toBe(true);
    expect(baseline.text).toContain("Pipelined test commands (containing '|') mask exit codes");
  });

  it("allows read-only shell commands after declare_task without blocking", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix read-only shell passthrough",
    });

    const readOnlyCommands = [
      { command: "ls /tmp" },
      { command: "git log --oneline -5" },
      { command: "git status" },
      { command: "git diff" },
      { command: "git show HEAD" },
      { command: "find . -name '*.ts' | head" },
      { command: "grep 'foo' src/foo.ts" },
      { command: "cat README.md" },
      { command: "head -50 src/main.ts" },
      { command: "tail -20 src/main.ts" },
      { command: "curl -s https://example.com/api/status" },
      { command: "echo hello" },
      { command: "pwd" },
    ];

    for (const args of readOnlyCommands) {
      const result = await beforeTool(agent, "bash", args);
      expect(result?.block).not.toBe(true);
    }
    for (const args of readOnlyCommands) {
      const result = await beforeTool(agent, "ctx_shell", args);
      expect(result?.block).not.toBe(true);
    }

    // Shell commands (even mutations) are allowed before baseline;
    // mutations are detected via workspace fingerprints in afterToolCall.
    // Direct mutation tools (edit, write) ARE blocked before baseline.
    expect((await beforeTool(agent, "edit", { path: "src/main.ts", edits: [] }))?.block).toBe(true);
    expect((await beforeTool(agent, "write", { path: "config.json", content: "" }))?.block).toBe(true);
  });
});
