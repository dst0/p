import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";

const CRITERION = "The meeting is scheduled";
const WRITE_EFFECT = {
  kind: "external_write" as const,
  risk: "high" as const,
  domains: ["persistent_state" as const],
  source: "declared" as const,
};
const READ_EFFECT = {
  kind: "read" as const,
  risk: "normal" as const,
  domains: ["persistent_state" as const],
  source: "declared" as const,
};

describe("external-operation completion scope", () => {
  it("avoids runtime proof debt while retaining receipt-bound semantic verification", async () => {
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    const agent = new Agent();
    controller.install(agent);
    controller.state.taskPrompts = [{ id: "user-1", text: "Schedule the meeting." }];
    expect(
      await callVerification(controller, {
        action: "record_completion_checklist",
        completion_checklist: [CRITERION],
        verification_scope: "external_operation",
      }),
    ).toContain("Completion checklist recorded");
    expect(controller.currentState.completionChecklist?.verificationScope).toBe("external_operation");
    expect(controller.currentState.criticalProofObligations).toEqual([]);

    const receiptRef = await recordWrite(agent);
    expect(await ready(controller, [receiptRef])).toContain("proves only successful tool execution");

    const readbackRef = await recordReadback(agent);
    expect(await ready(controller, [receiptRef, readbackRef])).toContain("verification_token:");
  });
});

async function recordWrite(agent: Agent): Promise<string> {
  const args = { target: "redacted" };
  const toolCall = { type: "toolCall" as const, id: "write-1", name: "create_event", arguments: args };
  const before = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: WRITE_EFFECT,
    context: {} as never,
  } as never);
  if (before?.block) throw new Error(before.reason ?? "external effect blocked");
  const after = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: WRITE_EFFECT,
    result: { content: [{ type: "text", text: "provider accepted" }] },
    isError: false,
    context: {} as never,
  } as never);
  return evidenceRef(after?.content);
}

async function recordReadback(agent: Agent): Promise<string> {
  const args = { event_id: "redacted" };
  const toolCall = { type: "toolCall" as const, id: "read-1", name: "get_event", arguments: args };
  const before = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: READ_EFFECT,
    context: {} as never,
  } as never);
  if (before?.block) throw new Error(before.reason ?? "readback blocked");
  const after = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: READ_EFFECT,
    result: {
      content: [{ type: "text", text: "scheduled" }],
      details: {
        taskVerificationReadback: {
          version: 1,
          kind: "external_effect_readback",
          externalEffectToolCallId: "write-1",
          outcome: "confirmed",
          criterion: CRITERION,
        },
      },
    },
    isError: false,
    context: {} as never,
  } as never);
  return evidenceRef(after?.content);
}

function evidenceRef(content: Array<{ type: string; text?: string }> | undefined): string {
  const text = content?.map((part) => part.text ?? "").join("\n") ?? "";
  const ref = text.match(/Verification evidence handle: (verification-evidence-\d+)/u)?.[1];
  if (!ref) throw new Error(`missing evidence handle: ${text}`);
  return ref;
}

async function ready(
  controller: ReturnType<typeof createTaskVerificationController>,
  evidenceRefs: string[],
): Promise<string> {
  return callVerification(controller, {
    action: "ready_to_finish",
    evidence_refs_by_check: [evidenceRefs],
    unresolved_failures: [],
  });
}

async function callVerification(
  controller: ReturnType<typeof createTaskVerificationController>,
  params: Record<string, unknown>,
): Promise<string> {
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
