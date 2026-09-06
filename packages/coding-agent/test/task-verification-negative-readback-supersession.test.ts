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

describe("receipt-bound negative readback supersession", () => {
  it.each([
    { label: "successful negative readback", isError: false },
    { label: "errored negative readback", isError: true },
  ])("invalidates an earlier confirmation after a later $label", async ({ isError }) => {
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    const agent = new Agent();
    controller.install(agent);
    controller.state.taskPrompts = [{ id: "user-1", text: "Schedule the meeting." }];
    await callVerification(controller, {
      action: "record_completion_checklist",
      completion_checklist: [CRITERION],
    });

    const receiptRef = await recordWrite(agent);
    const confirmedRef = await recordReadback(agent, {
      id: "read-confirmed",
      name: "get_event",
      outcome: "confirmed",
      isError: false,
    });
    expect(await ready(controller)).toContain("verification_token:");
    expect(controller.currentState.readiness?.acceptanceChecks).toEqual([
      { criterion: CRITERION, evidenceRefs: [receiptRef, confirmedRef] },
    ]);

    const negativeRef = await recordReadback(agent, {
      id: "read-negative",
      name: "refresh_event",
      outcome: "not_confirmed",
      isError,
    });
    expect(controller.evidence.get(negativeRef)?.toolEffect?.domains).toEqual(["persistent_state", "network_send"]);
    expect(controller.currentState.readiness).toEqual({ status: "pending", acceptanceChecks: [] });

    const negativeAttempt = await ready(controller);
    expect(negativeAttempt).not.toContain("verification_token:");
    expect(negativeAttempt).toMatch(
      /(?:unconfirmed reads do not prove remote state|failed evidence cannot prove readiness)/u,
    );

    const retryAttempt = await ready(controller);
    expect(retryAttempt).not.toContain("verification_token:");
    expect(controller.currentState.readiness?.status).toBe("pending");
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
  return evidenceRef(after?.content, "external receipt");
}

async function recordReadback(
  agent: Agent,
  readback: {
    id: string;
    name: string;
    outcome: "confirmed" | "not_confirmed";
    isError: boolean;
  },
): Promise<string> {
  const args = { event_id: "redacted" };
  const toolCall = { type: "toolCall" as const, id: readback.id, name: readback.name, arguments: args };
  const effect =
    readback.outcome === "confirmed"
      ? READ_EFFECT
      : { ...READ_EFFECT, domains: ["persistent_state" as const, "network_send" as const] };
  const before = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect,
    context: {} as never,
  } as never);
  if (before?.block) throw new Error(before.reason ?? "readback blocked");
  const after = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect,
    result: {
      content: [
        {
          type: "text",
          text: readback.outcome === "confirmed" ? "scheduled" : "event is not confirmed",
        },
      ],
      details: {
        taskVerificationReadback: {
          version: 1,
          kind: "external_effect_readback",
          externalEffectToolCallId: "write-1",
          outcome: readback.outcome,
          criterion: CRITERION,
        },
      },
    },
    isError: readback.isError,
    context: {} as never,
  } as never);
  return evidenceRef(after?.content, "declared readback");
}

function evidenceRef(content: Array<{ type: string; text?: string }> | undefined, kind: string): string {
  const text = content?.map((part) => part.text ?? "").join("\n") ?? "";
  const ref = text.match(/Verification evidence handle: (verification-evidence-\d+)/u)?.[1];
  if (!ref) throw new Error(`missing ${kind} evidence: ${text}`);
  return ref;
}

async function ready(controller: ReturnType<typeof createTaskVerificationController>): Promise<string> {
  return callVerification(controller, {
    action: "ready_to_finish",
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
