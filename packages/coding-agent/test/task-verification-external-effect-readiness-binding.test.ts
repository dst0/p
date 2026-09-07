import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";

const EFFECT = {
  kind: "external_write" as const,
  risk: "high" as const,
  domains: ["persistent_state" as const],
  source: "declared" as const,
};

describe("external-effect readiness binding", () => {
  it.each([
    "The meeting is scheduled",
    "The email is not sent",
    "External effect via tool create_event completes successfully after approval",
    "The requested external effect completes successfully and the email is sent",
  ])("rejects receipt laundering through criterion: %s", async (criterion) => {
    const result = await readinessFor(criterion);
    expect(result).toContain("proves only successful tool execution");
  });

  it("accepts the exact tool-bound successful-effect criterion", async () => {
    expect(await readinessFor("External effect via tool create_event completes successfully")).toContain(
      "verification_token:",
    );
  });

  it("accepts a semantic outcome only with a fresh declared connector readback", async () => {
    expect(await readinessFor("The meeting is scheduled", "declared_connector")).toContain("verification_token:");
  });

  it("does not let a shell read launder a semantic external outcome", async () => {
    expect(await readinessFor("The meeting is scheduled", "shell")).toContain("proves only successful tool execution");
  });

  it("rejects a declared readback from an unrelated effect domain", async () => {
    expect(await readinessFor("The meeting is scheduled", "unrelated_connector")).toContain(
      "unconfirmed reads do not prove remote state",
    );
  });

  it("rejects a same-domain readback bound to another remote resource", async () => {
    expect(await readinessFor("The meeting is scheduled", "wrong_resource_connector")).toContain(
      "explicit confirmed readback proof",
    );
  });

  it("rejects a successful tool call whose readback outcome is negative", async () => {
    expect(await readinessFor("The meeting is scheduled", "negative_connector")).toContain(
      "explicit confirmed readback proof",
    );
  });

  it("automatically pairs a semantic readback with its controller-owned receipt", async () => {
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    const agent = new Agent();
    controller.install(agent);
    await recordExternalEffect(controller, agent, "The meeting is scheduled");
    await recordReadback(controller, agent, "declared_connector");
    expect(
      await callVerification(controller, {
        action: "ready_to_finish",
        unresolved_failures: [],
      }),
    ).toContain("verification_token:");
  });

  it("restores metadata-only connector readback evidence without arguments or payloads", async () => {
    const sessionManager = SessionManager.inMemory();
    const initial = createTaskVerificationController(sessionManager, "evidence");
    const initialAgent = new Agent();
    initial.install(initialAgent);
    await recordExternalEffect(initial, initialAgent, "The meeting is scheduled");
    const readbackRef = await recordReadback(initial, initialAgent, "declared_connector");
    const persisted = JSON.stringify(sessionManager.getBranch());
    expect(persisted).not.toContain("sensitive remote payload");
    expect(persisted).not.toContain("event_id");
    expect(persisted).not.toContain("sensitive detail payload");

    const restored = createTaskVerificationController(sessionManager, "evidence");
    expect(restored.restoreError).toBeUndefined();
    expect(restored.evidence.get(readbackRef)).toMatchObject({
      outputSummary: "successful metadata-only declared external readback",
      toolEffect: { kind: "read", domains: ["persistent_state"], source: "declared" },
      externalReadbackReceiptId: "external-effect-1-1",
      externalReadbackCriterionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(
      await callVerification(restored, {
        action: "ready_to_finish",
        unresolved_failures: [],
      }),
    ).toContain("verification_token:");
  });

  it("invalidates readiness when a later readback in the same scope fails", async () => {
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    const agent = new Agent();
    controller.install(agent);
    await recordExternalEffect(controller, agent, "The meeting is scheduled");
    await recordReadback(controller, agent, "declared_connector");
    expect(
      await callVerification(controller, {
        action: "ready_to_finish",
        unresolved_failures: [],
      }),
    ).toContain("verification_token:");

    await recordReadback(controller, agent, "declared_connector", true);
    expect(controller.currentState.readiness?.status).toBe("pending");
    expect(
      await callVerification(controller, {
        action: "ready_to_finish",
        unresolved_failures: [],
      }),
    ).toContain("unconfirmed reads do not prove remote state");
  });
});

async function readinessFor(criterion: string, readback?: ReadbackKind): Promise<string> {
  const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
  const agent = new Agent();
  controller.install(agent);
  await recordExternalEffect(controller, agent, criterion);
  if (readback) await recordReadback(controller, agent, readback);
  return callVerification(controller, {
    action: "ready_to_finish",
    unresolved_failures: [],
  });
}

async function recordExternalEffect(
  controller: ReturnType<typeof createTaskVerificationController>,
  agent: Agent,
  criterion: string,
): Promise<string> {
  controller.state.taskPrompts = [{ id: "user-1", text: "Perform the requested external operation." }];
  await callVerification(controller, {
    action: "record_completion_checklist",
    completion_checklist: [criterion],
  });
  const args = { target: "redacted" };
  const toolCall = { type: "toolCall" as const, id: "send-1", name: "create_event", arguments: args };
  const before = await agent.beforeToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: EFFECT,
    context: {} as never,
  } as never);
  if (before?.block) throw new Error(before.reason ?? "external effect blocked");
  const after = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect: EFFECT,
    result: { content: [{ type: "text", text: "provider accepted" }], details: undefined },
    isError: false,
    context: {} as never,
  } as never);
  const text =
    after?.content
      ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? "";
  const evidenceRef = text.match(/Verification evidence handle: (verification-evidence-\d+)/u)?.[1];
  if (!evidenceRef) throw new Error(`missing external receipt evidence: ${text}`);
  return evidenceRef;
}

async function recordReadback(
  controller: ReturnType<typeof createTaskVerificationController>,
  agent: Agent,
  kind: ReadbackKind,
  isError = false,
): Promise<string> {
  const args = kind === "shell" ? { command: "printf scheduled" } : { event_id: "redacted" };
  const toolCall = {
    type: "toolCall" as const,
    id: `readback-${kind}`,
    name: kind === "shell" ? "bash" : kind === "unrelated_connector" ? "get_profile" : "get_event",
    arguments: args,
  };
  const effect =
    kind === "shell"
      ? ({ kind: "read", risk: "normal", domains: [], source: "builtin" } as const)
      : ({
          kind: "read",
          risk: "normal",
          domains: [kind === "unrelated_connector" ? "credentials" : "persistent_state"],
          source: "declared",
        } as const);
  const confirmed = kind === "declared_connector";
  const wrongResource = kind === "wrong_resource_connector";
  const result = await agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall,
    args,
    effect,
    result: {
      content: [
        {
          type: "text",
          text: kind === "negative_connector" ? "event not found" : "scheduled; sensitive remote payload",
        },
      ],
      details:
        confirmed || wrongResource
          ? {
              providerSecret: "sensitive detail payload",
              taskVerificationReadback: {
                version: 1,
                kind: "external_effect_readback",
                externalEffectToolCallId: wrongResource ? "different-write" : "send-1",
                outcome: "confirmed",
                criterion: "The meeting is scheduled",
              },
            }
          : undefined,
    },
    isError,
    context: {} as never,
  } as never);
  const text =
    result?.content
      ?.filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n") ?? "";
  const ref = text.match(/Verification evidence handle: (verification-evidence-\d+)/u)?.[1];
  if (!ref) throw new Error(`missing readback evidence: ${text}`);
  if (kind === "declared_connector" && !isError) {
    expect(controller.evidence.get(ref)).toMatchObject({
      outputSummary: "successful metadata-only declared external readback",
      toolEffect: { kind: "read", source: "declared" },
      externalReadbackReceiptId: "external-effect-1-1",
      externalReadbackCriterionSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(JSON.stringify(controller.evidence.get(ref))).not.toContain("sensitive remote payload");
    expect(JSON.stringify(controller.evidence.get(ref))).not.toContain("event_id");
  }
  return ref;
}

type ReadbackKind =
  | "declared_connector"
  | "unrelated_connector"
  | "wrong_resource_connector"
  | "negative_connector"
  | "shell";

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
