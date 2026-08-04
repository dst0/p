import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  createTaskVerificationController,
  TASK_VERIFICATION_EVIDENCE_CUSTOM_TYPE,
  TASK_VERIFICATION_STATE_CUSTOM_TYPE,
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

function verificationToken(text: string): string {
  const match = text.match(/verification_token: ([0-9a-f-]+)/u);
  if (!match) throw new Error(`Missing verification token in: ${text}`);
  return match[1];
}

describe("task verification controller", () => {
  it("blocks mutation until the task and required baseline are verified", async () => {
    const { agent, controller } = createInstalledController();

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

  it("auto-declares a feature before its first mutation without a bookkeeping failure", async () => {
    const { agent, controller } = createInstalledController();

    const result = await beforeTool(agent, "write", { path: "src/new-feature.ts", content: "export {};\n" });

    expect(result?.block).not.toBe(true);
    expect(controller.currentState.taskKind).toBe("feature");
    expect(controller.currentState.taskSummary).toBe("Implement the requested workspace change.");
    expect(controller.currentState.baseline.status).toBe("not_required");
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
    expect(staticBaseline.isError).toBe(false);
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
    const beforeReadiness = await beforeTool(agent, "finish_work", { status: "success" });
    expect(beforeReadiness?.block).toBe(true);
    expect(beforeReadiness?.reason).toContain("ready_to_finish");

    const ready = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        {
          criterion: "Mutations remain blocked until semantic verification succeeds",
          evidence_refs: [reproduction],
        },
      ],
      unresolved_failures: [],
    });
    const token = verificationToken(ready.text);
    const wrongToken = await beforeTool(agent, "finish_work", {
      status: "success",
      verification_token: "wrong-token",
    });
    expect(wrongToken?.block).toBe(true);
    expect(wrongToken?.reason).toContain("exact verification_token");
    expect(
      (
        await beforeTool(agent, "finish_work", {
          status: "success",
          verification_token: token,
        })
      )?.block,
    ).not.toBe(true);
    expect((await beforeTool(agent, "bash", { command: "git commit -m test" }))?.block).not.toBe(true);

    await afterTool(agent, "edit", { path: "gate.ts", edits: [{ oldText: "b", newText: "c" }] });
    expect(
      (
        await beforeTool(agent, "finish_work", {
          status: "success",
          verification_token: token,
        })
      )?.block,
    ).toBe(true);

    const staleFinal = await callVerificationTool(controller, {
      action: "record_final",
      final_method: "manual_reproduction",
      final_status: "passed",
      expected_behavior: "The gate remains correct",
      observed_behavior: "Only evidence from the previous mutation revision is available",
      evidence_refs: [reproduction],
      unresolved_failures: [],
    });
    expect(staleFinal.isError).toBe(false);
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
    expect(final.isError).toBe(false);
    expect(final.text).toContain("non-generic bash evidence");
  });

  it("classifies npm run typecheck as a generic check rather than runtime reproduction", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix inventory replay validation",
    });
    const typecheck = evidenceHandle(
      await afterTool(agent, "bash", { command: "npm run typecheck" }, { text: "typecheck passed" }),
    );

    const baseline = await callVerificationTool(controller, {
      action: "record_baseline",
      baseline_method: "runtime_reproduction",
      hypothesis: "Replay accepts a truncated serialization",
      conclusion: "Type checking alone does not exercise replay behavior",
      evidence_refs: [typecheck],
      unresolved_assumptions: [],
    });

    expect(baseline.isError).toBe(false);
    expect(baseline.text).toContain("non-generic bash evidence");
    expect(controller.currentState.baseline.status).toBe("pending");
  });

  it("infers final metadata and current evidence for npm run test variants", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Add inventory serialization",
    });
    await afterTool(agent, "edit", {
      path: "src/inventory.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    const testEvidence = evidenceHandle(
      await afterTool(
        agent,
        "bash",
        { command: "npm run test -- test/inventory.test.ts" },
        { text: "focused test passed" },
      ),
    );

    const final = await callVerificationTool(controller, { action: "record_final" });

    expect(final.isError).toBe(false);
    expect(controller.currentState.final).toMatchObject({
      status: "passed",
      method: "focused_test",
      evidenceRefs: [testEvidence],
      verifiedMutationRevision: 1,
    });
  });

  it("prompts a high-risk acceptance audit after a broad suite and auto-finalizes a focused test", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Add transactional inventory persistence with a manifest",
    });
    await afterTool(agent, "edit", {
      path: "src/inventory.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });

    const broadOutput = await afterTool(agent, "bash", { command: "npm test" }, { text: "67 tests passed" });
    expect(broadOutput).toContain("HIGH-RISK ACCEPTANCE AUDIT REQUIRED");
    expect(broadOutput).toContain("remove exactly one final byte");
    expect(broadOutput).toContain("without invented wrappers");
    expect(controller.currentState.final.status).toBe("pending");

    const focusedOutput = await afterTool(
      agent,
      "bash",
      { command: "npm test -- test/inventory-boundaries.test.ts" },
      { text: "focused boundary tests passed" },
    );
    expect(focusedOutput).toContain("Focused semantic verification passed");
    expect(controller.currentState.final).toMatchObject({
      status: "passed",
      method: "focused_test",
      verifiedMutationRevision: 1,
    });
    const focusedEvidence = evidenceHandle(focusedOutput);
    const ready = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        {
          criterion: "Transactional manifest boundary behavior is covered adversarially",
          evidence_refs: [focusedEvidence],
        },
      ],
      unresolved_failures: [],
    });
    const token = verificationToken(ready.text);
    expect(
      (
        await beforeTool(agent, "finish_work", {
          status: "success",
          verification_token: token,
        })
      )?.block,
    ).not.toBe(true);
  });

  it("blocks readiness until requested tests and typecheck have successful current evidence", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement the parser exactly and run npm test plus npm run typecheck until both pass",
    });
    await afterTool(agent, "edit", {
      path: "src/parser.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    const testEvidence = evidenceHandle(
      await afterTool(
        agent,
        "bash",
        { command: "npm test -- test/parser.test.ts" },
        { text: "focused parser tests passed" },
      ),
    );
    await afterTool(
      agent,
      "bash",
      { command: "npm run typecheck" },
      { isError: true, text: "Type error in src/parser.ts" },
    );

    const blocked = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        {
          criterion: "Parser behavior matches the exact contract",
          evidence_refs: [testEvidence],
        },
      ],
      unresolved_failures: [],
    });
    expect(blocked.text).toContain("latest execution still failed");
    expect(blocked.text).toContain("npm run typecheck");

    const typecheckEvidence = evidenceHandle(
      await afterTool(agent, "bash", { command: "npm run typecheck" }, { text: "typecheck passed" }),
    );
    const ready = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        {
          criterion: "Parser behavior and requested validation pass",
          evidence_refs: [testEvidence, typecheckEvidence],
        },
      ],
      unresolved_failures: [],
    });
    expect(ready.text).toContain("Finish readiness passed");
    expect(verificationToken(ready.text)).toBeTruthy();
  });

  it("honors an explicit request to skip tests and typecheck", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Update generated configuration; do not run tests or typecheck",
    });
    await afterTool(agent, "edit", {
      path: "src/generated-config.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    const reproduction = evidenceHandle(
      await afterTool(
        agent,
        "bash",
        { command: "node scripts/validate-generated-config.js" },
        { text: "configuration valid" },
      ),
    );
    await callVerificationTool(controller, {
      action: "record_final",
      final_method: "manual_reproduction",
      final_status: "passed",
      evidence_refs: [reproduction],
      unresolved_failures: [],
    });

    const ready = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        {
          criterion: "Generated configuration remains valid",
          evidence_refs: [reproduction],
        },
      ],
      unresolved_failures: [],
    });
    expect(ready.text).toContain("Finish readiness passed");
  });

  it("requires multiple acceptance mappings for complex adversarial guarantees", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement exact atomic rollback that rejects truncated and tampered durable data",
    });
    await afterTool(agent, "edit", {
      path: "src/store.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    const evidence = evidenceHandle(
      await afterTool(
        agent,
        "bash",
        { command: "npm test -- test/store-adversarial.test.ts" },
        { text: "adversarial store tests passed" },
      ),
    );

    const incomplete = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "Atomic rollback", evidence_refs: [evidence] }],
      unresolved_failures: [],
    });
    expect(incomplete.text).toContain("at least 4 distinct acceptance_checks");

    const ready = await callVerificationTool(controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        { criterion: "Exact serialization contract", evidence_refs: [evidence] },
        { criterion: "Atomic rollback", evidence_refs: [evidence] },
        { criterion: "Truncation rejection", evidence_refs: [evidence] },
        { criterion: "Tamper rejection", evidence_refs: [evidence] },
      ],
      unresolved_failures: [],
    });
    expect(ready.text).toContain("Finish readiness passed");
  });

  it("does not treat checksum inspection as a manual behavioral reproduction", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Add transactional inventory persistence",
    });
    await afterTool(agent, "edit", {
      path: "src/inventory.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    await afterTool(agent, "bash", { command: "md5 README.md src/inventory.ts" }, { text: "checksums" });

    const final = await callVerificationTool(controller, { action: "record_final" });
    expect(final.text).toContain("No eligible semantic evidence");
    expect(controller.currentState.final.status).toBe("pending");
  });

  it("uses the tool exit status instead of failure-like output text", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Report test output without misclassifying evidence",
    });
    await afterTool(agent, "edit", {
      path: "src/reporter.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    await afterTool(
      agent,
      "bash",
      { command: "npm run test -- test/reporter.test.ts" },
      { text: "Regression fixture contains the literal text: 1 failed" },
    );

    const final = await callVerificationTool(controller, { action: "record_final" });

    expect(final.isError).toBe(false);
    expect(controller.currentState.final.status).toBe("passed");
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
    expect(replayHandle).toBeTruthy();
    expect(restored.currentState.final.status).toBe("passed");
    expect(restored.currentState.final.evidenceRefs).toEqual([replayHandle]);
    expect(afterReplay.text).toContain('action "ready_to_finish"');
    const ready = await callVerificationTool(restored, {
      action: "ready_to_finish",
      acceptance_checks: [
        {
          criterion: "The exact regression now passes",
          evidence_refs: [replayHandle],
        },
        {
          criterion: "Recovery behavior remains verified after reconstruction",
          evidence_refs: [replayHandle],
        },
      ],
      unresolved_failures: [],
    });
    const token = verificationToken(ready.text);
    const readinessRestored = createTaskVerificationController(sessionManager);
    const readinessAgent = new Agent();
    readinessRestored.install(readinessAgent);
    expect(
      (
        await beforeTool(readinessAgent, "finish_work", {
          status: "success",
          verification_token: token,
        })
      )?.block,
    ).not.toBe(true);
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
    expect((await beforeTool(agent, "finish_work", { status: "success" }))?.block).not.toBe(true);
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
    expect(baseline.isError).toBe(false);
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

  it("resolves implicit failed evidence when final_status is failed", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix a bug and verify it with a failing regression test",
    });
    await afterTool(agent, "edit", {
      path: "src/main.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    const command = "npm run test -- test/bug.test.ts";
    await afterTool(agent, "bash", { command }, { isError: true, text: "failed" });

    const final = await callVerificationTool(controller, {
      action: "record_final",
      final_status: "failed",
    });

    expect(final.isError).toBe(false);
    expect(controller.currentState.final.status).toBe("failed");
  });

  it("resolves a failed exact baseline replay when final_status is failed", async () => {
    const { agent, controller } = createInstalledController();
    await callVerificationTool(controller, {
      action: "declare_task",
      task_kind: "bug_fix",
      task_summary: "Fix an exact replay regression",
    });
    await callVerificationTool(controller, {
      action: "authorize_baseline_test",
      test_paths: ["test/exact-failure.test.ts"],
    });
    await afterTool(agent, "edit", {
      path: "test/exact-failure.test.ts",
      edits: [{ oldText: "old", newText: "failing regression" }],
    });
    const command = "npm run test -- test/exact-failure.test.ts";
    const baselineEvidence = evidenceHandle(
      await afterTool(agent, "bash", { command }, { isError: true, text: "baseline failure" }),
    );
    await callVerificationTool(controller, {
      action: "record_baseline",
      baseline_method: "failing_regression_test",
      hypothesis: "The exact focused regression exposes the defect",
      conclusion: "The baseline fails with the expected defect",
      evidence_refs: [baselineEvidence],
      unresolved_assumptions: [],
    });
    await afterTool(agent, "edit", {
      path: "src/main.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    await afterTool(agent, "bash", { command }, { isError: true, text: "current failure" });

    const final = await callVerificationTool(controller, {
      action: "record_final",
      final_status: "failed",
    });

    expect(final.isError).toBe(false);
    expect(controller.currentState.final.status).toBe("failed");
  });
});
