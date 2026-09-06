import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Agent } from "@dst0/p-agent-core";
import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";
import {
  afterEvidenceTool,
  beforeEvidenceTool,
  callEvidenceVerification as callVerification,
  evidenceHandle,
  evidenceToolCall,
} from "./task-verification-evidence-test-harness.ts";

async function runEffect(agent: Agent, name: string): Promise<string> {
  const args = {};
  const call = evidenceToolCall(name, args);
  const effect = {
    kind: "external_write" as const,
    risk: "high" as const,
    domains: ["network_send" as const],
    source: "declared" as const,
  };
  const before = await beforeEvidenceTool(agent, name, args, call, effect);
  if (before?.block) throw new Error(before.reason ?? "external effect blocked");
  return evidenceHandle(await afterEvidenceTool(agent, name, args, "effect completed", call, false, effect));
}

async function createHarness(taskText: string, checklist: string[], cwd?: string) {
  const agent = new Agent();
  const controller = createTaskVerificationController(SessionManager.inMemory(cwd), "evidence");
  controller.install(agent);
  controller.state.taskPrompts = [{ id: "user-1", text: taskText }];
  expect(
    await callVerification(controller, {
      action: "record_completion_checklist",
      completion_checklist: checklist,
    }),
  ).toContain("Completion checklist recorded");
  expect(controller.currentState.completionChecklist?.criteria).toEqual(checklist);
  return { agent, controller };
}

async function confirmReadback(
  harness: Awaited<ReturnType<typeof createHarness>>,
  receiptRef: string,
  criterion: string,
): Promise<string> {
  const externalEffectToolCallId = harness.controller.evidence.get(receiptRef)?.toolCallId;
  if (!externalEffectToolCallId) throw new Error("missing recorded effect tool call");
  const args = {};
  const call = evidenceToolCall("read_publication", args);
  const effect = {
    kind: "read" as const,
    risk: "normal" as const,
    domains: ["network_send" as const],
    source: "declared" as const,
  };
  expect((await beforeEvidenceTool(harness.agent, call.name, args, call, effect))?.block).not.toBe(true);
  const result = await harness.agent.afterToolCall?.({
    assistantMessage: {} as never,
    toolCall: call,
    args,
    effect,
    result: {
      content: [{ type: "text", text: "publication confirmed" }],
      details: {
        taskVerificationReadback: {
          version: 1,
          kind: "external_effect_readback",
          externalEffectToolCallId,
          outcome: "confirmed",
          criterion,
        },
      },
    },
    isError: false,
    context: {} as never,
  });
  return evidenceHandle(
    (result?.content ?? []).flatMap((part) => (part.type === "text" ? [part.text] : [])).join("\n"),
  );
}

describe("external-effect controller-owned evidence selection", () => {
  it("rejects one receipt for two requested successful external effects", async () => {
    const { agent, controller } = await createHarness("Send two separate emails.", [
      "External effect 1 via tool send_email completes successfully",
      "External effect 2 via tool send_email completes successfully",
    ]);
    await runEffect(agent, "send_email");
    expect(controller.currentState.externalEffectReceipts).toHaveLength(1);

    const ready = await callVerification(controller, { action: "ready_to_finish", unresolved_failures: [] });

    expect(ready).not.toContain("verification_token:");
    expect(controller.currentState.readiness?.status).not.toBe("completion_ready");
  });

  it("matches generic and specific criteria independently of effect execution order", async () => {
    const { agent, controller } = await createHarness("Send an email and create the event.", [
      "The requested external effect completes successfully",
      "External effect via tool send_email completes successfully",
    ]);
    const email = await runEffect(agent, "send_email");
    const event = await runEffect(agent, "create_event");

    const ready = await callVerification(controller, { action: "ready_to_finish", unresolved_failures: [] });

    expect(ready).toContain("verification_token:");
    expect(controller.currentState.readiness?.status).toBe("completion_ready");
    expect(controller.currentState.readiness?.acceptanceChecks.map((check) => check.evidenceRefs)).toEqual([
      [event],
      [email],
    ]);
  });

  it("rejects an unconfirmed semantic outcome alongside a successful generic effect", async () => {
    const { agent, controller } = await createHarness("Schedule the meeting.", [
      "The requested external effect completes successfully",
      "The meeting is scheduled",
    ]);
    await runEffect(agent, "create_event");
    await runEffect(agent, "schedule_meeting");
    expect(controller.currentState.externalEffectReceipts).toHaveLength(2);

    const ready = await callVerification(controller, { action: "ready_to_finish", unresolved_failures: [] });

    expect(ready).not.toContain("verification_token:");
    expect(controller.currentState.readiness?.status).not.toBe("completion_ready");
  });

  it("reassigns previously matched receipts through confirmed semantic readback alternatives", async () => {
    const criteria = ["The announcement is published", "The update is published", "The report is published"];
    const harness = await createHarness("Publish the announcement, update, and report.", criteria);
    const first = await runEffect(harness.agent, "publish_bundle");
    const second = await runEffect(harness.agent, "publish_announcement");
    const third = await runEffect(harness.agent, "publish_update_and_report");
    await confirmReadback(harness, first, criteria[0]!);
    const announcementReadback = await confirmReadback(harness, second, criteria[0]!);
    await confirmReadback(harness, first, criteria[1]!);
    const updateReadback = await confirmReadback(harness, third, criteria[1]!);
    const reportReadback = await confirmReadback(harness, first, criteria[2]!);
    await confirmReadback(harness, third, criteria[2]!);
    expect(harness.controller.currentState.mutationRevision).toBe(3);
    expect(harness.controller.currentState.externalEffectReceipts).toHaveLength(3);

    const ready = await callVerification(harness.controller, { action: "ready_to_finish", unresolved_failures: [] });

    expect(ready).toContain("verification_token:");
    expect(harness.controller.currentState.readiness?.acceptanceChecks).toEqual([
      { criterion: criteria[0], evidenceRefs: [second, announcementReadback] },
      { criterion: criteria[1], evidenceRefs: [third, updateReadback] },
      { criterion: criteria[2], evidenceRefs: [first, reportReadback] },
    ]);
  });

  it("selects the final effect receipt without requiring intermediate workflow receipts in the checklist", async () => {
    const { agent, controller } = await createHarness("Prepare and send the email.", [
      "External effect via tool send_email completes successfully",
    ]);
    await runEffect(agent, "create_draft");
    await runEffect(agent, "update_draft");
    const email = await runEffect(agent, "send_email");
    expect(controller.currentState.externalEffectReceipts).toHaveLength(3);

    const ready = await callVerification(controller, { action: "ready_to_finish", unresolved_failures: [] });

    expect(ready).toContain("verification_token:");
    expect(controller.currentState.readiness?.status).toBe("completion_ready");
    expect(controller.currentState.readiness?.acceptanceChecks.map((check) => check.evidenceRefs)).toEqual([[email]]);
  });

  it("requires fresh workspace evidence after a mutation despite an eligible earlier external receipt", async () => {
    const cwd = mkdtempSync(join(tmpdir(), "p-external-selection-mutation-"));
    try {
      const { agent, controller } = await createHarness(
        "Send an email and implement the user name parser.",
        ["External effect via tool send_email completes successfully", "The parser accepts user names"],
        cwd,
      );
      const email = await runEffect(agent, "send_email");
      expect(controller.currentState.mutationRevision).toBe(1);
      const args = { path: "parser.ts", content: "export const parseName = (name: string) => name.trim();\n" };
      const call = evidenceToolCall("write", args);
      expect((await beforeEvidenceTool(agent, "write", args, call))?.block).not.toBe(true);
      writeFileSync(join(cwd, args.path), args.content);
      await afterEvidenceTool(agent, "write", args, "wrote parser.ts", call);
      expect(controller.currentState.mutationRevision).toBe(2);
      expect(controller.currentState.taskOwnedPaths).toEqual(["parser.ts"]);
      expect(controller.evidence.get(email)?.mutationRevision).toBe(1);

      const ready = await callVerification(controller, { action: "ready_to_finish", unresolved_failures: [] });

      expect(ready).not.toContain("verification_token:");
      expect(controller.currentState.readiness?.status).not.toBe("completion_ready");
    } finally {
      rmSync(cwd, { recursive: true, force: true });
    }
  });
});
