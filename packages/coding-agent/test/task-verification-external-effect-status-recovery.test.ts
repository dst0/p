import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import { formatEvidenceStatus } from "../src/core/task-verification/taskverificationcontroller-methods/evidence-status.ts";
import type { TaskVerificationEvidence } from "../src/core/task-verification/types.ts";
import { createTaskVerificationController } from "../src/core/task-verification.ts";

function evidence(ref: string, revision: number): TaskVerificationEvidence {
  return {
    version: 2,
    taskId: "status-recovery",
    ref,
    toolCallId: `call-${ref}`,
    toolName: "read",
    descriptor: `evidence ${ref}`,
    outputSummary: "successful read",
    isError: false,
    mutationRevision: revision,
    timestamp: "2026-09-02T00:00:00.000Z",
  };
}

describe("external-effect status recovery", () => {
  it("shows every retained external receipt before the bounded current evidence tail", () => {
    const controller = createTaskVerificationController(SessionManager.inMemory(), "evidence");
    controller.state.taskId = "status-recovery";
    controller.state.mutationRevision = 14;
    controller.state.externalEffectReceipts = [
      {
        id: "external-effect-1-1",
        toolCallId: "call-external",
        toolName: "create_ticket",
        effect: {
          kind: "external_write",
          risk: "high",
          domains: ["persistent_state"],
          source: "declared",
        },
        effectRevision: 1,
      },
    ];
    controller.evidence.set("verification-evidence-external", {
      ...evidence("verification-evidence-external", 1),
      toolCallId: "call-external",
      toolName: "create_ticket",
      externalEffectReceiptId: "external-effect-1-1",
    });
    controller.evidence.set("verification-evidence-readback", {
      ...evidence("verification-evidence-readback", 14),
      toolCallId: "call-readback",
      toolName: "get_ticket",
      toolEffect: {
        kind: "read",
        risk: "normal",
        domains: ["persistent_state"],
        source: "declared",
      },
      externalReadbackReceiptId: "external-effect-1-1",
      externalReadbackCriterionSha256: "a".repeat(64),
      externalReadbackOutcome: "confirmed",
    });
    for (let index = 1; index <= 13; index += 1) {
      const item = evidence(`verification-evidence-${index}`, 14);
      controller.evidence.set(item.ref, item);
    }

    const status = formatEvidenceStatus(controller);
    expect(status).toContain("verification-evidence-external [external-effect-1-1 via create_ticket]");
    expect(status).toContain("verification-evidence-readback [readback via get_ticket]");
    expect(status).toContain("verification-evidence-13");
  });
});
