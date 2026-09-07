import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";

const PROVIDER_SECRET = "provider-secret-must-not-escape";
const PROVIDER_PAYLOAD = "raw-provider-payload-must-not-escape";
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
const READBACK_PROOF = {
  version: 1 as const,
  kind: "external_effect_readback" as const,
  externalEffectToolCallId: "create-event-1",
  outcome: "confirmed" as const,
  criterion: CRITERION,
};

describe("composed-hook readback sanitization", () => {
  it("does not return or persist raw details introduced by a prior afterToolCall hook", async () => {
    const sessionManager = SessionManager.inMemory();
    const controller = createTaskVerificationController(sessionManager, "evidence");
    const agent = new Agent();
    agent.afterToolCall = async (context) =>
      context.toolCall.name === "get_event"
        ? {
            content: [{ type: "text", text: "prior hook normalized the provider response" }],
            details: {
              providerSecret: PROVIDER_SECRET,
              payload: PROVIDER_PAYLOAD,
              taskVerificationReadback: { ...READBACK_PROOF, providerPayload: PROVIDER_PAYLOAD },
            },
          }
        : undefined;
    controller.install(agent);
    controller.state.taskPrompts = [{ id: "user-1", text: "Schedule the requested meeting." }];
    await callVerification(controller, {
      action: "record_completion_checklist",
      completion_checklist: [CRITERION],
    });

    await recordExternalEffect(agent);
    const result = await recordDeclaredReadback(agent);
    const returned = JSON.stringify(result);
    const persisted = JSON.stringify(sessionManager.getBranch());
    const readbackEvidence = [...controller.evidence.values()].find(
      (evidence) => evidence.toolCallId === "get-event-1",
    );

    expect(result?.content).toContainEqual({ type: "text", text: "prior hook normalized the provider response" });
    expect.soft(returned).not.toContain(PROVIDER_SECRET);
    expect.soft(returned).not.toContain(PROVIDER_PAYLOAD);
    expect.soft(result?.details).toEqual({ taskVerificationReadback: READBACK_PROOF });
    expect.soft(persisted).not.toContain(PROVIDER_SECRET);
    expect.soft(persisted).not.toContain(PROVIDER_PAYLOAD);
    expect(readbackEvidence).toMatchObject({
      outputSummary: "successful metadata-only declared external readback",
      externalReadbackReceiptId: "external-effect-1-1",
      externalReadbackCriterionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(readbackEvidence)).not.toContain(PROVIDER_SECRET);
    expect(JSON.stringify(readbackEvidence)).not.toContain(PROVIDER_PAYLOAD);
  });
});

async function recordExternalEffect(agent: Agent): Promise<void> {
  const args = { target: "redacted" };
  const toolCall = {
    type: "toolCall" as const,
    id: READBACK_PROOF.externalEffectToolCallId,
    name: "create_event",
    arguments: args,
  };
  const before = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: WRITE_EFFECT,
    context: {} as never,
  } as never);
  if (before?.block) throw new Error(before.reason ?? "external effect blocked");
  await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: WRITE_EFFECT,
    result: { content: [{ type: "text", text: "provider accepted" }], details: undefined },
    isError: false,
    context: {} as never,
  } as never);
}

async function recordDeclaredReadback(agent: Agent) {
  const args = { eventId: "redacted" };
  const toolCall = { type: "toolCall" as const, id: "get-event-1", name: "get_event", arguments: args };
  const rawDetails = {
    providerSecret: PROVIDER_SECRET,
    payload: PROVIDER_PAYLOAD,
    taskVerificationReadback: { ...READBACK_PROOF, providerPayload: PROVIDER_PAYLOAD },
  };
  const before = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: READ_EFFECT,
    context: {} as never,
  } as never);
  if (before?.block) throw new Error(before.reason ?? "readback blocked");
  return agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: READ_EFFECT,
    result: {
      content: [{ type: "text", text: "scheduled" }],
      details: rawDetails,
    },
    isError: false,
    context: {} as never,
  } as never);
}

async function callVerification(
  controller: ReturnType<typeof createTaskVerificationController>,
  params: Record<string, unknown>,
): Promise<void> {
  await controller.toolDefinition.execute("verification-call", params as never, undefined, undefined, {} as never);
}
