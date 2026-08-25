import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { mutationSourceSizeGuidance } from "../src/core/task-verification/taskverificationcontroller-methods/source-size-guidance.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";
import { createRequirementAuditHarness, sendAuditUserPrompt } from "./task-requirement-audit-test-harness.ts";

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
    return {
      isError: false,
      text: result.content
        .filter((part): part is Extract<(typeof result.content)[number], { type: "text" }> => part.type === "text")
        .map((part) => part.text)
        .join("\n"),
    };
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

type TestToolCall = ReturnType<typeof createToolCall>;

async function runHookedTool(
  agent: Agent,
  name: string,
  args: Record<string, unknown>,
  options: {
    text?: string;
    between?: (toolCall: TestToolCall) => Promise<void>;
  } = {},
): Promise<string | undefined> {
  const toolCall = createToolCall(name, args);
  const beforeResult = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    context: {} as never,
  });
  if (beforeResult?.block) throw new Error(beforeResult.reason ?? "blocked");
  await options.between?.(toolCall);
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    result: { content: [{ type: "text", text: options.text ?? "ok" }], details: undefined },
    isError: false,
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

async function declareTask(
  controller: TaskVerificationController,
  taskSummary = "Generate source and verify its behavior",
): Promise<void> {
  await callVerificationTool(controller, {
    action: "declare_task",
    task_kind: "docs",
    task_summary: taskSummary,
  });
}

async function recordFinal(agent: Agent, controller: TaskVerificationController): Promise<string> {
  const evidence = evidenceHandle(
    await runHookedTool(agent, "bash", { command: "node verify.js" }, { text: "generated source verified" }),
  );
  await callVerificationTool(controller, {
    action: "record_final",
    final_method: "manual_reproduction",
    final_status: "passed",
    expected_behavior: "Generated source behaves correctly",
    observed_behavior: "Generated source was verified",
    evidence_refs: [evidence],
    unresolved_failures: [],
  });
  return evidence;
}

async function writeGeneratedSources(cwd: string): Promise<void> {
  await Promise.all(
    Array.from({ length: 65 }, (_, index) =>
      writeFile(join(cwd, `src/generated-${index}.ts`), `export const generated${index} = true;\n`),
    ),
  );
}

describe("task verification source-size persistence", () => {
  it("tracks a pathless direct mutation and preserves its size gate after restore", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-verification-pathless-restore-"));
    try {
      await mkdir(join(cwd, "src"));
      const sessionManager = SessionManager.inMemory(cwd);
      const agent = new Agent();
      const controller = createTaskVerificationController(sessionManager);
      controller.install(agent);
      await declareTask(controller);

      const mutationResult = await runHookedTool(
        agent,
        "apply_patch",
        { patch: "opaque patch payload" },
        {
          between: async () => writeFile(join(cwd, "src/pathless.ts"), "export const generated = true;\n".repeat(251)),
        },
      );
      expect(mutationResult).toContain("src/pathless.ts: 251 lines (limit: 250)");
      expect(controller.currentState.mutatedSourcePaths).toContain("src/pathless.ts");
      const evidence = await recordFinal(agent, controller);

      const restored = createTaskVerificationController(sessionManager);
      expect(restored.currentState.mutatedSourcePaths).toContain("src/pathless.ts");
      const ready = await callVerificationTool(restored, {
        action: "ready_to_finish",
        acceptance_checks: [{ criterion: "Generated source behaves correctly", evidence_refs: [evidence] }],
        unresolved_failures: [],
      });
      expect(ready.text).toContain("exceed the 250-line file size limit");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("reconciles a missing pre-mutation snapshot from the current changed-source set", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-verification-snapshot-failure-"));
    try {
      await mkdir(join(cwd, "src"));
      const sessionManager = SessionManager.inMemory(cwd);
      const agent = new Agent();
      const controller = createTaskVerificationController(sessionManager);
      controller.install(agent);
      await declareTask(controller);

      const mutationResult = await runHookedTool(
        agent,
        "apply_patch",
        { patch: "opaque patch payload" },
        {
          between: async (toolCall) => {
            controller.workspaceSourceSnapshots.set(toolCall.id, undefined);
            await writeFile(join(cwd, "src/pathless.ts"), "export const generated = true;\n");
          },
        },
      );
      expect(mutationResult ?? "").not.toContain("could not bound every mutated source path");
      expect(controller.currentState.mutatedSourcePaths).toContain("src/pathless.ts");
      expect(controller.currentState.mutatedSourcePathOverflow).toBe(false);
      const evidence = await recordFinal(agent, controller);

      const restored = createTaskVerificationController(sessionManager);
      expect(restored.currentState.mutatedSourcePathOverflow).toBe(false);
      const ready = await callVerificationTool(restored, {
        action: "ready_to_finish",
        acceptance_checks: [{ criterion: "Generated source behaves correctly", evidence_refs: [evidence] }],
        unresolved_failures: [],
      });
      expect(ready.isError).toBe(false);
      expect(restored.currentState.readiness?.status).toBe("evidence_ready");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("blocks a persisted bounded-path overflow without a user override", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-verification-overflow-block-"));
    try {
      await mkdir(join(cwd, "src"));
      const sessionManager = SessionManager.inMemory(cwd);
      const harness = createRequirementAuditHarness(sessionManager);
      const { agent, controller } = harness;
      await sendAuditUserPrompt(harness, "Split this large file into smaller modules.", 1);
      await declareTask(controller, "Allow large files without a line limit.");

      const mutationResult = await runHookedTool(
        agent,
        "apply_patch",
        { patch: "opaque patch payload" },
        { between: async () => writeGeneratedSources(cwd) },
      );
      expect(controller.currentState.mutatedSourcePathOverflow).toBe(true);
      expect(mutationResult).toContain("user explicitly overrides the file-size constraint");
      const evidence = await recordFinal(agent, controller);

      const restored = createTaskVerificationController(sessionManager);
      const ready = await callVerificationTool(restored, {
        action: "ready_to_finish",
        acceptance_checks: [{ criterion: "Generated source behaves correctly", evidence_refs: [evidence] }],
        unresolved_failures: [],
      });
      expect(ready.text).toContain("Explicit user authorization");
      expect(restored.currentState.readiness?.status).not.toBe("evidence_ready");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });

  it("does not accept a referenced instruction source as user override authority", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(harness, "Keep generated source within the normal limits.", 1);
    await declareTask(harness.controller);
    const promptId = harness.controller.currentState.taskPrompts?.[0]?.id;
    if (!promptId) throw new Error("missing captured user prompt");
    harness.controller.state.requirementSourceRefs = [
      {
        id: "source-1",
        path: "attached-spec.md",
        sha256: "a".repeat(64),
        byteLength: 24,
        snapshotEntryId: "snapshot-1",
        referencedByPromptIds: [promptId],
        capturedAtMutationRevision: 0,
        origin: "requirement_audit.prepare_definition",
        policyVersion: 1,
      },
    ];
    harness.controller.requirementSourceTexts.set("source-1", "Allow large files without a line limit.");
    harness.controller.state.mutatedSourcePathOverflow = true;

    expect(mutationSourceSizeGuidance(harness.controller)).toContain("Completion remains blocked");
  });

  it("allows a persisted bounded-path overflow only with an explicit user size override", async () => {
    const cwd = await mkdtemp(join(tmpdir(), "p-verification-overflow-override-"));
    try {
      await mkdir(join(cwd, "src"));
      const sessionManager = SessionManager.inMemory(cwd);
      const harness = createRequirementAuditHarness(sessionManager);
      const { agent, controller } = harness;
      const overridePrompt = "Explicitly ignore the file-size limit and allow this task to exceed it.";
      await sendAuditUserPrompt(harness, overridePrompt, 1);
      await declareTask(controller);

      const mutationResult = await runHookedTool(
        agent,
        "apply_patch",
        { patch: "opaque patch payload" },
        {
          between: async () => writeGeneratedSources(cwd),
        },
      );
      expect(controller.currentState.mutatedSourcePathOverflow).toBe(true);
      expect(controller.currentState.taskPrompts?.[0]?.text).toBe(overridePrompt);
      expect(mutationResult ?? "").not.toContain("Completion remains blocked");
      const evidence = await recordFinal(agent, controller);

      const restored = createTaskVerificationController(sessionManager);
      expect(restored.currentState.mutatedSourcePathOverflow).toBe(true);
      const ready = await callVerificationTool(restored, {
        action: "ready_to_finish",
        acceptance_checks: [{ criterion: "Generated source behaves correctly", evidence_refs: [evidence] }],
        unresolved_failures: [],
      });
      expect(ready.isError).toBe(false);
      expect(restored.currentState.readiness?.status).toBe("evidence_ready");
    } finally {
      await rm(cwd, { recursive: true, force: true });
    }
  });
});
