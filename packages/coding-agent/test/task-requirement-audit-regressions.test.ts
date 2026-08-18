import { describe, expect, it } from "vitest";
import {
  auditEvidenceHandle,
  beforeAuditTool,
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("requirement-audit completion regressions", () => {
  it("withholds the finish token after hard evidence while allowing finalization operations", async () => {
    const harness = createRequirementAuditHarness();
    const { text: readiness } = await reachAuditEvidenceReady(harness);

    expect(readiness).not.toContain("verification_token:");
    expect(harness.controller.currentState.readiness?.status).toBe("evidence_ready");
    const blockedFinish = await beforeAuditTool(harness.agent, "finish_work", { status: "success" });
    expect(blockedFinish?.block).toBe(true);
    expect(blockedFinish?.reason).toContain("record_requirement_audit");
    expect((await beforeAuditTool(harness.agent, "bash", { command: "git commit -m test" }))?.block).not.toBe(true);
  });

  it("gates git -C commit and push commands before evidence readiness", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Add a guarded completion workflow.", 100);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Add a guarded completion workflow",
    });
    await recordAuditToolResult(harness.agent, "edit", {
      path: "src/gate.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });

    const commit = await beforeAuditTool(harness.agent, "bash", {
      command: 'git -C "/tmp/review worktree" commit -m test',
    });
    const push = await beforeAuditTool(harness.agent, "bash", {
      command: "git -C /tmp/review-worktree push origin HEAD",
    });
    const configuredPush = await beforeAuditTool(harness.agent, "bash", {
      command: "command git --no-pager -c core.quotePath=false -C /tmp/review-worktree push origin HEAD",
    });
    const unpaginatedPush = await beforeAuditTool(harness.agent, "bash", {
      command: "git -P -C /tmp/review-worktree push origin HEAD",
    });
    const unlockedPush = await beforeAuditTool(harness.agent, "bash", {
      command: "git --no-optional-locks -C /tmp/review-worktree push origin HEAD",
    });
    const namespacedPush = await beforeAuditTool(harness.agent, "bash", {
      command: "git --namespace=review -C /tmp/review-worktree push origin HEAD",
    });
    const mixedQuotePush = await beforeAuditTool(harness.agent, "bash", {
      command: 'git -c core.sshCommand="ssh -i key" -C /tmp/review-worktree push origin HEAD',
    });
    const quotedPathPush = await beforeAuditTool(harness.agent, "bash", {
      command: 'git --git-dir="/tmp/review repo/.git" push origin HEAD',
    });
    const absoluteGitPush = await beforeAuditTool(harness.agent, "bash", {
      command: '"/usr/bin/git" -C /tmp/review-worktree push origin HEAD',
    });
    const commandPathPush = await beforeAuditTool(harness.agent, "bash", {
      command: "command -p git -C /tmp/review-worktree push origin HEAD",
    });
    const commandSeparatorPush = await beforeAuditTool(harness.agent, "bash", {
      command: "command -- git -C /tmp/review-worktree push origin HEAD",
    });
    const environmentPush = await beforeAuditTool(harness.agent, "bash", {
      command: "env GIT_OPTIONAL_LOCKS=0 git -C /tmp/review-worktree push origin HEAD",
    });
    const unsetEnvironmentPush = await beforeAuditTool(harness.agent, "bash", {
      command: "env -u GIT_DIR git -C /tmp/review-worktree push origin HEAD",
    });
    const splitEnvironmentPush = await beforeAuditTool(harness.agent, "bash", {
      command: "env -S 'git -C /tmp/review-worktree push origin HEAD'",
    });
    const longSplitEnvironmentPush = await beforeAuditTool(harness.agent, "bash", {
      command: "env --split-string='git -C /tmp/review-worktree push origin HEAD'",
    });
    const absoluteEnvironmentPush = await beforeAuditTool(harness.agent, "bash", {
      command: "/usr/bin/env git -C /tmp/review-worktree push origin HEAD",
    });
    const absoluteSplitEnvironmentPush = await beforeAuditTool(harness.agent, "bash", {
      command: "/usr/bin/env -S 'git -C /tmp/review-worktree push origin HEAD'",
    });
    const nestedSplitEnvironmentPush = await beforeAuditTool(harness.agent, "bash", {
      command: "env env -S 'git -C /tmp/review-worktree push origin HEAD'",
    });
    const status = await beforeAuditTool(harness.agent, "bash", {
      command: "git -C /tmp/review-worktree status --short",
    });
    expect(commit?.block).toBe(true);
    expect(push?.block).toBe(true);
    expect(configuredPush?.block).toBe(true);
    expect(unpaginatedPush?.block).toBe(true);
    expect(unlockedPush?.block).toBe(true);
    expect(namespacedPush?.block).toBe(true);
    expect(mixedQuotePush?.block).toBe(true);
    expect(quotedPathPush?.block).toBe(true);
    expect(absoluteGitPush?.block).toBe(true);
    expect(commandPathPush?.block).toBe(true);
    expect(commandSeparatorPush?.block).toBe(true);
    expect(environmentPush?.block).toBe(true);
    expect(unsetEnvironmentPush?.block).toBe(true);
    expect(splitEnvironmentPush?.block).toBe(true);
    expect(longSplitEnvironmentPush?.block).toBe(true);
    expect(absoluteEnvironmentPush?.block).toBe(true);
    expect(absoluteSplitEnvironmentPush?.block).toBe(true);
    expect(nestedSplitEnvironmentPush?.block).toBe(true);
    expect(status?.block).not.toBe(true);
    expect(commit?.reason).toContain("semantic verification has not passed");
  });

  it("preserves exact duplicate user prompts and excludes internal protocol messages", async () => {
    const harness = createRequirementAuditHarness();
    const exactPrompt = "  Preserve   spacing\nand duplicate entries.  ";
    await sendAuditUserPrompt(harness, exactPrompt, 100);
    await sendAuditUserPrompt(harness, exactPrompt, 200);
    await sendAuditUserPrompt(harness, "internal repair", 300, { pInternal: "completion_protocol_repair" });

    const texts = (harness.controller.currentState.taskPrompts ?? []).map((prompt: unknown) =>
      typeof prompt === "string" ? prompt : (prompt as { text: string }).text,
    );
    expect(texts).toEqual([exactPrompt, exactPrompt]);
    expect(harness.controller.latestUserPrompt).toBe(exactPrompt);
  });

  it("keeps the active task when the user clarifies after final evidence but before finish_work", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    const taskId = (harness.controller.currentState as unknown as { taskId?: string }).taskId;

    await sendAuditUserPrompt(harness, "Also reject a stale completion certificate.", 400);

    expect(harness.controller.currentState.taskKind).toBe("feature");
    expect(harness.controller.currentState.mutationRevision).toBe(1);
    expect((harness.controller.currentState as unknown as { taskId?: string }).taskId).toBe(taskId);
    expect(harness.controller.currentState.readiness?.status).toBe("pending");
  });

  it("returns every verbatim source prompt for authoritative decomposition without invented policy", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Build a calculator with 100% test coverage.", 100);
    await sendAuditUserPrompt(harness, "Also support exponentiation and handle division by zero.", 200);
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Build calculator with exponentiation and zero division handling",
    });
    await recordAuditToolResult(harness.agent, "edit", {
      path: "src/calc.ts",
      edits: [{ oldText: "old", newText: "new" }],
    });
    const evidenceRef = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "vitest --run test/calc.test.ts" },
        { text: "passed" },
      ),
    );
    const readiness = await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [
        {
          criterion: "Calculator with exponentiation and zero division handled",
          evidence_refs: [evidenceRef],
        },
      ],
      unresolved_failures: [],
    });

    expect(readiness).toContain("REQUIREMENT AUDIT — DEFINE AUTHORITATIVE USER REQUIREMENTS");
    expect(readiness).toContain("Build a calculator with 100% test coverage.");
    expect(readiness).toContain("Also support exponentiation and handle division by zero.");
    expect(readiness).toContain('record_requirement_audit with action "define"');
    expect(readiness).not.toContain("every modified file, feature, and branch");
  });

  it("restores the complete verbatim definition prompt after readiness persistence", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    const exactFollowUp = "  Keep this spacing intact.\n```text\nverbatim block\n```  ";
    await sendAuditUserPrompt(harness, exactFollowUp, 200);
    await callTaskVerification(harness.controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "The completion gate remains enforced", evidence_refs: [evidenceRef] }],
      unresolved_failures: [],
    });

    const restored = createRequirementAuditHarness(harness.sessionManager);
    const status = await callTaskVerification(restored.controller, { action: "status" });
    expect(status).toContain("REQUIREMENT AUDIT — DEFINE AUTHORITATIVE USER REQUIREMENTS");
    expect(status).toContain("Add a completion gate backed by focused verification.");
    expect(status).toContain(exactFollowUp);
    expect(status).toContain('action "define"');
  });

  it("retains the persisted session entry ID for each exact user prompt", async () => {
    const harness = createRequirementAuditHarness();
    const message = {
      role: "user" as const,
      content: "Persist my real session entry identifier.",
      timestamp: 1234,
    };
    const entryId = harness.sessionManager.appendMessage(message);
    await nextModelTurn(harness);
    await harness.emit({ type: "message_end", message });

    expect(harness.controller.currentState.taskPrompts).toEqual([
      { id: entryId, text: "Persist my real session entry identifier." },
    ]);
  });

  it("retains task state after partial and failed finish_work results", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    const taskId = harness.controller.currentState.taskId;

    await recordAuditToolResult(harness.agent, "finish_work", { status: "partial", summary: "Still working" });
    await recordAuditToolResult(harness.agent, "finish_work", { status: "failed", summary: "Cannot finish" });

    expect(harness.controller.currentState.taskId).toBe(taskId);
    expect(harness.controller.currentState.mutationRevision).toBe(1);
    expect(harness.controller.currentState.taskPrompts).toHaveLength(1);
  });

  it("bounds authoritative decomposition to 32 atomic requirements", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    const result = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: Array.from({ length: 33 }, (_unused, index) => ({
        type: "behavior",
        text: `Atomic behavior ${index + 1}`,
        acceptance_criterion: `Behavior ${index + 1} is independently verified`,
        source_prompt_indexes: [1],
      })),
      ignored_source_prompts: [],
    });

    expect(result).toContain("at most 32 atomic requirements");
    expect(harness.controller.currentState.requirementAudit.status).toBe("awaiting_definition");
  });

  it("allows finish_work without explicit verification_token after requirement audit passes", async () => {
    const harness = createRequirementAuditHarness();
    const { evidenceRef } = await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "behavior",
          text: "The completion gate enforces the requested behavior",
          acceptance_criterion: "Focused evidence passes and premature finish is blocked",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
    });
    await nextModelTurn(harness);
    await callRequirementAudit(harness.controller, {
      action: "verdict",
      requirement_id: "R1",
      passed: true,
      reason: "Current focused evidence proves the complete requirement.",
      evidence_refs: [evidenceRef],
    });

    const finishArgs: { status: "success"; summary: string; verification_token?: string } = {
      status: "success",
      summary: "all requirements verified",
    };
    const finishCall = await beforeAuditTool(harness.agent, "finish_work", finishArgs);
    expect(finishCall?.block).not.toBe(true);
    expect(finishArgs.verification_token).toBe(harness.controller.currentState.readiness?.token);

    const wrongTokenCall = await beforeAuditTool(harness.agent, "finish_work", {
      status: "success",
      summary: "all requirements verified",
      verification_token: "wrong-token",
    });
    expect(wrongTokenCall?.block).toBe(true);
    expect(wrongTokenCall?.reason).toContain("exact verification_token");
  });
});
