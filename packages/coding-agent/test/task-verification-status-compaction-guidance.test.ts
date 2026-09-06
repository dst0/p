import type { ToolResultMessage } from "@dst0/p-ai";
import { describe, expect, it } from "vitest";
import { createToolResultStub } from "../src/core/compaction/compaction/token-counting.ts";
import {
  auditEvidenceHandle,
  callTaskVerification,
  createRequirementAuditHarness,
  nextModelTurn,
  recordAuditToolResult,
  recordProductionMutationForTest,
  sendAuditUserPrompt,
} from "./task-requirement-audit-test-harness.ts";

describe("task-verification status compaction guidance", () => {
  it("keeps the exact next action at the front and inside the compacted raw pointer", async () => {
    const harness = createRequirementAuditHarness();
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement and verify inventory behavior",
    });
    await recordProductionMutationForTest(harness);
    const evidenceRef = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "node scripts/inventory-reproduction.js" },
        { text: "inventory reproduction passed" },
      ),
    );
    for (let index = 0; index < 8; index++) {
      await recordAuditToolResult(
        harness.agent,
        "read",
        { path: `src/evidence-${index}.ts` },
        { text: `evidence ${index} ${"detail ".repeat(100)}` },
      );
    }

    const statusResult = await harness.controller.toolDefinition.execute(
      "status-call",
      { action: "status" },
      undefined,
      undefined,
      {} as never,
    );
    const status = statusResult.content
      .filter((part): part is { type: "text"; text: string } => part.type === "text")
      .map((part) => part.text)
      .join("\n");
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "status-call",
      toolName: "record_task_verification",
      content: statusResult.content,
      isError: false,
      details: statusResult.details,
      timestamp: 1_700_000_000_000,
    };
    const { stub } = createToolResultStub(message, 0, 4_000);
    const expectedPayload = JSON.stringify({
      action: "record_final",
      final_method: "manual_reproduction",
      final_status: "passed",
      expected_behavior: "the behavior that must now hold",
      observed_behavior: "what this evidence demonstrated",
      evidence_refs: [evidenceRef],
      unresolved_failures: [],
    });

    expect(status.startsWith("NEXT REQUIRED ACTION:")).toBe(true);
    expect(stub.rawPointer.summary).toContain("NEXT REQUIRED ACTION: record final verification");
    expect(stub.rawPointer.summary).toContain(`Use evidence_refs: ["${evidenceRef}"]`);
    expect(stub.rawPointer.summary).toContain("Call record_task_verification with:");
    expect(stub.rawPointer.summary).toContain(expectedPayload);
    expect(stub.rawPointer.summary).toContain("Mutation revision: 1");
  });

  it("requires exact raw recall instead of exposing a truncated oversized command", async () => {
    const harness = createRequirementAuditHarness();
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Implement and verify inventory behavior",
    });
    await recordProductionMutationForTest(harness);
    const longCommand = `node scripts/inventory-reproduction.js ${"a".repeat(900)} EXACT_MIDDLE_COMMAND_TOKEN ${"b".repeat(900)}`;
    await recordAuditToolResult(harness.agent, "bash", { command: longCommand }, { text: "reproduction passed" });

    const statusResult = await harness.controller.toolDefinition.execute(
      "oversized-status-call",
      { action: "status" },
      undefined,
      undefined,
      {} as never,
    );
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "oversized-status-call",
      toolName: "record_task_verification",
      content: statusResult.content,
      isError: false,
      details: statusResult.details,
      timestamp: 1_700_000_000_000,
    };
    const { message: compacted, stub } = createToolResultStub(message, 0, 6_000);
    const compactedText = compacted.content[0]?.type === "text" ? compacted.content[0].text : "";

    expect(stub.rawPointer.summary).toContain("retrieve the exact raw task-verification result before acting");
    expect(stub.rawPointer.summary).not.toContain("EXACT_MIDDLE_COMMAND_TOKEN");
    expect(stub.rawPointer.summary).not.toContain("[bounded action context]");
    expect(compactedText).toContain('session_recall("tool-result:oversized-status-call"');
  });

  it("provides structured next-action recovery for rejected tool results", async () => {
    const harness = createRequirementAuditHarness();
    const rejectedResult = await harness.controller.toolDefinition.execute(
      "rejected-call",
      { action: "record_final", final_status: "passed" },
      undefined,
      undefined,
      {} as never,
    );
    const message: ToolResultMessage = {
      role: "toolResult",
      toolCallId: "rejected-call",
      toolName: "record_task_verification",
      content: rejectedResult.content,
      isError: false,
      details: rejectedResult.details,
      timestamp: 1_700_000_000_000,
    };
    const { stub } = createToolResultStub(message, 0, 4_000);

    expect(rejectedResult.details).toMatchObject({ status: "needs_action", contextExtract: expect.any(Object) });
    expect(stub.rawPointer.summary).toContain("Task classification is pending");
  });

  it("refreshes structured context after a rejected definition creates its repair draft", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(
      harness,
      "Reject invalid input. Reject truncated input. Preserve state after either rejection.",
      100,
    );
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Reject invalid and truncated input without changing state",
    });

    const result = await harness.controller.requirementAuditToolDefinition.execute(
      "invalid-definition",
      {
        action: "define",
        requirements: [
          requirement(
            "Reject invalid or truncated input and preserve state",
            "Invalid or truncated inputs are rejected and state is preserved",
          ),
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
      undefined,
      undefined,
      {} as never,
    );
    const revision = harness.controller.rejectedRequirementDefinitionDraft?.revision;
    const summary = contextSummary(result.details);

    expect(revision).toBeTypeOf("string");
    expect(summary).toContain("next_required_action: repair_definition");
    expect(summary).toContain(`definition_revision: ${revision}`);
  });

  it("refreshes structured context after an accepted repair clears the rejected draft", async () => {
    const harness = createRequirementAuditHarness();
    await sendAuditUserPrompt(
      harness,
      "Reject invalid input. Reject truncated input. Preserve state after either rejection.",
      100,
    );
    await callTaskVerification(harness.controller, {
      action: "declare_task",
      task_kind: "feature",
      task_summary: "Reject invalid and truncated input without changing state",
    });
    await harness.controller.requirementAuditToolDefinition.execute(
      "invalid-definition",
      {
        action: "define",
        requirements: [
          requirement(
            "Reject invalid or truncated input and preserve state",
            "Invalid or truncated inputs are rejected and state is preserved",
          ),
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
      undefined,
      undefined,
      {} as never,
    );
    const revision = harness.controller.rejectedRequirementDefinitionDraft?.revision;
    await nextModelTurn(harness);

    const result = await harness.controller.requirementAuditToolDefinition.execute(
      "accepted-repair",
      {
        action: "repair_definition",
        definition_revision: revision,
        requirement_repairs: [
          {
            requirement_index: 1,
            replacements: [
              requirement("Reject invalid input", "Invalid input is rejected"),
              requirement("Reject truncated input", "Truncated input is rejected"),
              requirement("Preserve state after rejection", "State remains unchanged after either rejection"),
            ],
          },
        ],
      },
      undefined,
      undefined,
      {} as never,
    );
    const summary = contextSummary(result.details);

    expect(harness.controller.rejectedRequirementDefinitionDraft).toBeUndefined();
    expect(summary).not.toContain("repair_definition");
    expect(summary).not.toContain(`definition_revision: ${revision}`);
    expect(summary).toContain("Verify all 3 requirements");
  });
});

function requirement(text: string, acceptanceCriterion: string) {
  return {
    type: "behavior" as const,
    text,
    acceptance_criterion: acceptanceCriterion,
    source_prompt_indexes: [1],
  };
}

function contextSummary(details: unknown): string {
  if (!details || typeof details !== "object" || !("contextExtract" in details)) return "";
  const contextExtract = details.contextExtract;
  return contextExtract && typeof contextExtract === "object" && "summary" in contextExtract
    ? String(contextExtract.summary)
    : "";
}
