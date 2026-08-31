import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController, type TaskVerificationController } from "../src/core/task-verification.ts";

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

async function beforeFinish(agent: Agent, token: string | undefined) {
  const args = { status: "success", verification_token: token };
  const toolCall = { type: "toolCall" as const, id: "finish", name: "finish_work", arguments: args };
  return agent.beforeToolCall?.({ assistantMessage: {} as never, toolCall, args, context: {} as never } as never);
}

describe("evidence-mode external effect receipts", () => {
  it("persists external-only readiness without payloads and invalidates it after a later effect", async () => {
    const sessionManager = SessionManager.inMemory();
    const agent = new Agent();
    const controller = createTaskVerificationController(sessionManager, "evidence");
    controller.install(agent);
    const evidenceRef = evidenceHandle(await runEffect(agent, "email-1", "external_write"));
    const ready = await callVerification(controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "The requested email was sent", evidence_refs: [evidenceRef] }],
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
  });

  it("allows an unknown successful effect through a high-risk metadata-only receipt", async () => {
    const agent = new Agent();
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    controller.install(agent);
    const evidenceRef = evidenceHandle(await runEffect(agent, "unknown-1", "unknown"));
    const ready = await callVerification(controller, {
      action: "ready_to_finish",
      acceptance_checks: [{ criterion: "The effect completed", evidence_refs: [evidenceRef] }],
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

  it("does not record failed external effects", async () => {
    const agent = new Agent();
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    controller.install(agent);
    await runEffect(agent, "email-failed", "external_write", true);
    expect(controller.currentState.externalEffectReceipts).toEqual([]);
    expect(controller.currentState.mutationRevision).toBe(0);
  });

  it.each(["bash", "write"])("honors declared external effects for a custom tool named %s", async (name) => {
    const agent = new Agent();
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    controller.install(agent);

    await runEffect(agent, `custom-${name}`, "external_write", false, name);

    expect(controller.currentState.externalEffectReceipts).toHaveLength(1);
    expect(controller.currentState.externalEffectReceipts?.[0]?.effect).toMatchObject({
      kind: "external_write",
      source: "declared",
    });
  });
});
