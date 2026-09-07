import { describe, expect, it } from "vitest";
import type { TaskVerificationController } from "../src/core/task-verification/taskverificationcontroller.ts";
import { externalEffectReceiptSupportsCriterion } from "../src/core/task-verification/taskverificationcontroller-methods/external-effect-receipt.ts";
import type { TaskVerificationEvidence } from "../src/core/task-verification/types.ts";

function fixture(source: "declared" | "default_unknown", toolName: string) {
  const receiptId = "external-effect-1-1";
  const evidence: TaskVerificationEvidence = {
    version: 2,
    taskId: "task-1",
    ref: "verification-evidence-1",
    toolCallId: "call-1",
    toolName,
    descriptor: "external_write effect (network_send)",
    outputSummary: "successful metadata-only external-effect receipt",
    externalEffectReceiptId: receiptId,
    isError: false,
    mutationRevision: 1,
    timestamp: "2026-09-02T00:00:00.000Z",
  };
  const controller = {
    state: {
      externalEffectReceipts: [
        {
          id: receiptId,
          toolCallId: evidence.toolCallId,
          toolName,
          effect: {
            kind: source === "default_unknown" ? "unknown" : "external_write",
            risk: "high",
            domains: [],
            source,
          },
          effectRevision: 1,
        },
      ],
    },
  } as unknown as TaskVerificationController;
  return { controller, evidence };
}

describe("external-effect criterion binding", () => {
  it("accepts only the bounded tool-call outcome and rejects semantic overclaims", () => {
    const email = fixture("declared", "send_email");
    expect(
      externalEffectReceiptSupportsCriterion(
        email.controller,
        email.evidence,
        "External effect 1 via tool send_email completes successfully",
      ),
    ).toBe(true);
    expect(externalEffectReceiptSupportsCriterion(email.controller, email.evidence, "The email is sent")).toBe(false);
    expect(externalEffectReceiptSupportsCriterion(email.controller, email.evidence, "The meeting is scheduled")).toBe(
      false,
    );
    expect(
      externalEffectReceiptSupportsCriterion(
        email.controller,
        email.evidence,
        "The email is sent and meeting scheduled",
      ),
    ).toBe(false);
    expect(
      externalEffectReceiptSupportsCriterion(
        email.controller,
        email.evidence,
        "External effect 1 via tool send_email completes successfully after approval",
      ),
    ).toBe(false);
    expect(externalEffectReceiptSupportsCriterion(email.controller, email.evidence, "The email is not sent")).toBe(
      false,
    );
  });

  it("allows unknown tools only for an exact bounded external-effect outcome", () => {
    const unknown = fixture("default_unknown", "opaque_tool");
    expect(
      externalEffectReceiptSupportsCriterion(
        unknown.controller,
        unknown.evidence,
        "The requested external effect completes successfully",
      ),
    ).toBe(true);
    expect(
      externalEffectReceiptSupportsCriterion(
        unknown.controller,
        unknown.evidence,
        "External effect via tool opaque_tool completes successfully",
      ),
    ).toBe(true);
    expect(
      externalEffectReceiptSupportsCriterion(
        unknown.controller,
        unknown.evidence,
        "The requested external effect completes successfully and the email is sent",
      ),
    ).toBe(false);
    expect(externalEffectReceiptSupportsCriterion(unknown.controller, unknown.evidence, "The email is sent")).toBe(
      false,
    );
  });
});
