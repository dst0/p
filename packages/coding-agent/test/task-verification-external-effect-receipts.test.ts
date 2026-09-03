import { Agent, createFinishWorkTool, resolveToolEffect } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";
import {
  callRequirementAudit,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

type EffectKind = "external_write" | "unknown";

async function runEffect(
  agent: Agent,
  id: string,
  kind: EffectKind,
  isError = false,
  name = "send_email",
): Promise<string> {
  const args = { customerPayload: "must-not-persist" };
  const call = { type: "toolCall" as const, id, name, arguments: args };
  const effect = {
    kind,
    risk: "high" as const,
    domains: ["network_send" as const],
    source: kind === "unknown" ? ("default_unknown" as const) : ("declared" as const),
  };
  const before = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect,
    context: {} as never,
  } as never);
  if (before?.block) throw new Error(before.reason ?? "blocked");
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect,
    result: { content: [{ type: "text", text: "sensitive provider response" }], details: undefined },
    isError,
    context: {} as never,
  } as never);
  return (result?.content ?? [])
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

async function callVerification(controller: TaskVerificationController, params: Record<string, unknown>) {
  const result = await controller.toolDefinition.execute(
    "verification-call",
    params as never,
    undefined,
    undefined,
    {} as never,
  );
  return result.content
    .filter((part): part is { type: "text"; text: string } => part.type === "text")
    .map((part) => part.text)
    .join("\n");
}

function evidenceHandle(text: string): string {
  const handle = text.match(/Verification evidence handle: (verification-evidence-\d+)/u)?.[1];
  if (!handle) throw new Error(`missing evidence handle: ${text}`);
  return handle;
}

async function createEvidenceHarness(
  sessionManager = SessionManager.inMemory(),
  taskText = "Complete the requested external effect.",
  checklist = ["The requested external effect completes successfully"],
) {
  const agent = new Agent();
  const controller = createTaskVerificationController(sessionManager, "evidence");
  controller.install(agent);
  controller.state.taskPrompts = [{ id: "user-1", text: taskText }];
  await callVerification(controller, {
    action: "record_completion_checklist",
    completion_checklist: checklist,
  });
  return { agent, controller };
}

async function beforeFinish(agent: Agent, token: string | undefined) {
  const args = { status: "success", verification_token: token };
  const toolCall = { type: "toolCall" as const, id: "finish", name: "finish_work", arguments: args };
  return agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: resolveToolEffect(createFinishWorkTool().effect),
    context: {} as never,
  } as never);
}

describe("evidence-mode external effect receipts", () => {
  it("blocks a declared external write named like a test command until the checklist exists", async () => {
    const agent = new Agent();
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    controller.install(agent);
    controller.state.taskPrompts = [{ id: "user-1", text: "Send the requested notification." }];
    const args = { command: "npm test" };
    const call = { type: "toolCall" as const, id: "declared-test-write", name: "bash", arguments: args };
    const before = await agent.beforeToolCall?.({
      assistantMessage: {} as never,
      toolCall: call,
      args,
      effect: {
        kind: "external_write",
        risk: "high",
        domains: ["network_send"],
        source: "declared",
      },
      context: {} as never,
    } as never);

    expect(before?.block).toBe(true);
    expect(before?.reason).toContain("record one completion checklist");
  });

  it("persists external-only readiness without payloads and invalidates it after a later effect", async () => {
    const sessionManager = SessionManager.inMemory();
    const { agent, controller } = await createEvidenceHarness(sessionManager, "Schedule the meeting.", [
      "External effect via tool schedule_meeting completes successfully",
    ]);
    const evidenceRef = evidenceHandle(
      await runEffect(agent, "meeting-1", "external_write", false, "schedule_meeting"),
    );
    const ready = await callVerification(controller, {
      action: "ready_to_finish",
      evidence_refs_by_check: [[evidenceRef]],
      unresolved_failures: [],
    });
    expect(ready).toContain("verification_token:");
    expect(controller.currentState.taskOwnedPaths).toEqual([]);
    expect(controller.currentState.externalEffectReceipts).toHaveLength(1);
    expect(JSON.stringify(controller.currentState)).not.toContain("must-not-persist");
    expect(JSON.stringify(controller.currentState)).not.toContain("sensitive provider response");

    const restoredAgent = new Agent();
    const restored = createTaskVerificationController(sessionManager, "evidence");
    restored.install(restoredAgent);
    expect(restored.restoreError).toBeUndefined();
    expect((await beforeFinish(restoredAgent, restored.currentState.readiness?.token))?.block).not.toBe(true);
    await runEffect(restoredAgent, "email-2", "external_write");
    expect(restored.currentState.mutationRevision).toBe(2);
    expect(restored.currentState.readiness?.status).toBe("pending");
    const status = await callVerification(restored, { action: "status" });
    expect(status).toContain(evidenceRef);
  });
  it("allows an unknown successful effect through a high-risk metadata-only receipt", async () => {
    const { agent, controller } = await createEvidenceHarness();
    const evidenceRef = evidenceHandle(await runEffect(agent, "unknown-1", "unknown"));
    const ready = await callVerification(controller, {
      action: "ready_to_finish",
      evidence_refs_by_check: [[evidenceRef]],
      unresolved_failures: [],
    });
    expect(controller.currentState.effectTrackingFailed).toBe(false);
    expect(controller.currentState.externalEffectReceipts?.[0]?.effect).toMatchObject({
      kind: "unknown",
      risk: "high",
      source: "default_unknown",
    });
    expect(ready).toContain("verification_token:");
  });

  it("keeps distinct earlier receipts eligible without reusing one receipt across effects", async () => {
    const { agent, controller } = await createEvidenceHarness(SessionManager.inMemory(), "Send the two emails.", [
      "External effect 1 via tool send_email completes successfully",
      "External effect 2 via tool send_email completes successfully",
    ]);
    const email = evidenceHandle(await runEffect(agent, "email-distinct", "external_write", false, "send_email"));
    const secondEmail = evidenceHandle(await runEffect(agent, "email-second", "external_write", false, "send_email"));
    const ready = await callVerification(controller, {
      action: "ready_to_finish",
      evidence_refs_by_check: [[email], [secondEmail]],
      unresolved_failures: [],
    });
    expect(ready).toContain("verification_token:");
    const reused = await callVerification(controller, {
      action: "ready_to_finish",
      evidence_refs_by_check: [[email], [email]],
      unresolved_failures: [],
    });
    expect(reused).toContain("one external-effect receipt may prove only one checklist item");
  });

  it("blocks an unknown effect after completion evidence without invalidating readiness", async () => {
    const { agent, controller } = await createEvidenceHarness();
    const evidenceRef = evidenceHandle(await runEffect(agent, "known-1", "external_write"));
    await callVerification(controller, {
      action: "ready_to_finish",
      evidence_refs_by_check: [[evidenceRef]],
      unresolved_failures: [],
    });

    const args = {};
    const toolCall = { type: "toolCall" as const, id: "unknown-after-ready", name: "opaque_reader", arguments: args };
    const before = await agent.beforeToolCall?.({
      assistantMessage: {} as never,
      toolCall,
      args,
      effect: { kind: "unknown", risk: "high", domains: [], source: "default_unknown" },
      context: {} as never,
    } as never);

    expect(before?.block).toBe(true);
    expect(before?.reason).toContain("has no declared effect");
    expect(controller.currentState.mutationRevision).toBe(1);
    expect(controller.currentState.readiness?.status).toBe("completion_ready");
  });

  it("allows unknown effects before audit evidence and blocks them after the evidence boundary", async () => {
    const preEvidence = createRequirementAuditHarness();
    await sendAuditUserPrompt(preEvidence, "Add a completion gate backed by focused verification.", 100);
    await callTaskVerification(preEvidence.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Add a completion gate backed by focused verification",
    });
    await nextModelTurn(preEvidence);
    await callRequirementAudit(preEvidence.controller, {
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
    expect(preEvidence.controller.currentState).toMatchObject({
      mutationRevision: 0,
      readiness: { status: "pending" },
      requirementAudit: { status: "verifying" },
    });
    await expect(
      runEffect(preEvidence.agent, "unknown-pre-evidence", "unknown", false, "opaque_reader"),
    ).resolves.toContain("Verification evidence handle:");

    const postEvidence = createRequirementAuditHarness();
    await reachAuditEvidenceReady(postEvidence);
    await nextModelTurn(postEvidence);
    await callRequirementAudit(postEvidence.controller, {
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
    expect(postEvidence.controller.currentState).toMatchObject({
      readiness: { status: "evidence_ready" },
      requirementAudit: { status: "verifying" },
    });
    await expect(
      runEffect(postEvidence.agent, "unknown-post-evidence", "unknown", false, "opaque_reader"),
    ).rejects.toThrow("after completion evidence");
  });

  it("does not record failed external effects", async () => {
    const { agent, controller } = await createEvidenceHarness();
    await runEffect(agent, "email-failed", "external_write", true);
    expect(controller.currentState.externalEffectReceipts).toEqual([]);
    expect(controller.currentState.mutationRevision).toBe(0);
  });

  it.each(["bash", "write"])("honors declared external effects for a custom tool named %s", async (name) => {
    const { agent, controller } = await createEvidenceHarness();

    await runEffect(agent, `custom-${name}`, "external_write", false, name);

    expect(controller.currentState.externalEffectReceipts).toHaveLength(1);
    expect(controller.currentState.externalEffectReceipts?.[0]?.effect).toMatchObject({
      kind: "external_write",
      source: "declared",
    });
  });
});
