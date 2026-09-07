import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";

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

describe("independent external readback binding", () => {
  it("rejects a readback whose criterion differs while receipt, resource, and domain match", async () => {
    const criterion = "The meeting is scheduled";
    const { controller, agent } = await preparedController([criterion]);
    await recordWrite(agent, "write-1");
    await recordReadback(agent, {
      id: "read-1",
      writeId: "write-1",
      criterion: "The room is reserved",
    });

    const result = await ready(controller);
    expect(result).toContain("explicit confirmed readback proof");
    expect(result).not.toContain("verification_token:");
    expect(controller.currentState.readiness).toEqual({ status: "pending", acceptanceChecks: [] });
  });

  it("keeps two same-connector readbacks current when they bind different receipts", async () => {
    const firstCriterion = "Meeting A is scheduled";
    const secondCriterion = "Meeting B is scheduled";
    const { controller, agent } = await preparedController([firstCriterion, secondCriterion]);
    const firstReceipt = await recordWrite(agent, "write-1");
    const secondReceipt = await recordWrite(agent, "write-2");
    const firstReadback = await recordReadback(agent, {
      id: "read-1",
      writeId: "write-1",
      criterion: firstCriterion,
    });
    const secondReadback = await recordReadback(agent, {
      id: "read-2",
      writeId: "write-2",
      criterion: secondCriterion,
    });

    const status = await callVerification(controller, { action: "status" });
    expect(status).toContain(`${firstReadback} [readback via get_event]`);
    expect(status).toContain(`${secondReadback} [readback via get_event]`);
    expect(await ready(controller)).toContain("verification_token:");
    expect(controller.currentState.readiness?.acceptanceChecks).toEqual([
      { criterion: firstCriterion, evidenceRefs: [firstReceipt, firstReadback] },
      { criterion: secondCriterion, evidenceRefs: [secondReceipt, secondReadback] },
    ]);
  });
});

async function preparedController(criteria: string[]) {
  const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
  const agent = new Agent();
  controller.install(agent);
  controller.state.taskPrompts = [{ id: "user-1", text: "Perform both requested external operations." }];
  await callVerification(controller, {
    action: "record_completion_checklist",
    completion_checklist: criteria,
  });
  return { controller, agent };
}

async function recordWrite(agent: Agent, id: string): Promise<string> {
  const args = { target: id };
  const toolCall = { type: "toolCall" as const, id, name: "create_event", arguments: args };
  const before = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: WRITE_EFFECT,
    context: {} as never,
  } as never);
  if (before?.block) throw new Error(before.reason ?? "external effect blocked");
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: WRITE_EFFECT,
    result: { content: [{ type: "text", text: "provider accepted" }] },
    isError: false,
    context: {} as never,
  } as never);
  return evidenceRef(result?.content, "external receipt");
}

async function recordReadback(
  agent: Agent,
  binding: { id: string; writeId: string; criterion: string },
): Promise<string> {
  const args = { event_id: binding.id };
  const toolCall = { type: "toolCall" as const, id: binding.id, name: "get_event", arguments: args };
  const result = await agent.afterToolCall?.({
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
          externalEffectToolCallId: binding.writeId,
          outcome: "confirmed",
          criterion: binding.criterion,
        },
      },
    },
    isError: false,
    context: {} as never,
  } as never);
  return evidenceRef(result?.content, "readback");
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
