import { expect, it } from "vitest";
import { isFocusedEvidence } from "../src/core/task-verification/taskverificationcontroller-methods/focused-requirement-evidence.ts";
import type { TaskRequirement } from "../src/core/task-verification/types.ts";
import {
  auditEvidenceHandle,
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
  withAuditProofWitnesses,
} from "./task-requirement-audit-test-harness.ts";

const requirements = [
  {
    type: "behavior" as const,
    text: "Idempotent duplicate commandId retry",
    acceptance_criterion: "A duplicate commandId retry returns the original result",
    source_prompt_indexes: [1],
  },
  {
    type: "constraint" as const,
    text: "Idempotency rejects commandId reuse for a different command",
    acceptance_criterion: "A reused commandId for a different command throws ValidationError",
    source_prompt_indexes: [1],
  },
  {
    type: "behavior" as const,
    text: "Atomic batch rollback restores state",
    acceptance_criterion: "A failed batch rolls back all state to the pre-batch snapshot",
    source_prompt_indexes: [1],
  },
  {
    type: "constraint" as const,
    text: "Atomic batch rollback removes idempotency records",
    acceptance_criterion: "A failed batch rolls back idempotency records",
    source_prompt_indexes: [1],
  },
  {
    type: "constraint" as const,
    text: "Optimistic concurrency rejects version mismatches",
    acceptance_criterion: "A mismatched expectedVersion throws ConcurrencyError",
    source_prompt_indexes: [1],
  },
  ...[
    ["malformed JSON", "malformed JSON"],
    ["tampered hashes", "a tampered hash"],
    ["truncated logs", "a truncated log"],
    ["non-sequential positions", "non-sequential event positions"],
    ["empty logs", "an empty log"],
    ["event-version mismatches", "an event-version mismatch"],
    ["impossible transitions", "an impossible event transition"],
    ["terminal-newline truncation", "a log missing its terminal newline"],
  ].map(([text, criterion]) => ({
    type: "constraint" as const,
    text: `Replay integrity rejects ${text}`,
    acceptance_criterion: `fromLog rejects ${criterion}`,
    source_prompt_indexes: [1],
  })),
];

const initialSelectors = [
  "idempotent duplicate commandId retry returns original result",
  "idempotency reused commandId different command throws ValidationError",
  "atomic failed batch rolls back pre-batch state",
  "atomic failed batch rolls back idempotency records",
  "concurrency mismatched expectedVersion throws ConcurrencyError",
  "integrity fromLog rejects malformed JSON",
  "integrity fromLog rejects tampered hash",
  "integrity fromLog rejects truncated log",
  "integrity fromLog rejects non-sequential event positions",
];

const missingSelectors = [
  "integrity fromLog rejects empty log",
  "integrity fromLog rejects event-version mismatch",
  "integrity fromLog rejects impossible event transition",
  "integrity fromLog rejects log missing terminal newline",
];

async function recordSelector(
  agent: Parameters<typeof recordAuditToolResult>[0],
  selector: string,
  requirement: TaskRequirement,
): Promise<string> {
  return auditEvidenceHandle(
    await recordAuditToolResult(
      agent,
      "bash",
      {
        command: `cd /private/tmp/inventory && node --import tsx --test --test-name-pattern="${selector}" test/*.test.ts 2>&1`,
      },
      { text: withAuditProofWitnesses("Tests 1 passed\nTests 0 failed", requirement) },
    ),
  );
}

it("requires every atomic inventory case before accepting one verdict batch", async () => {
  const harness = createRequirementAuditHarness();
  await reachAuditEvidenceReady(harness);
  await nextModelTurn(harness);
  const defined = await callRequirementAudit(harness.controller, {
    action: "define",
    requirements,
    ignored_source_prompts: [],
  });
  expect(defined).toContain("Defined 13 atomic requirement");
  const definedRequirements = harness.controller.currentState.requirementAudit.requirements;
  const evidenceRefs: string[] = [];
  for (const [index, selector] of initialSelectors.entries()) {
    evidenceRefs.push(await recordSelector(harness.agent, selector, definedRequirements[index]!));
  }
  await nextModelTurn(harness);
  const incomplete = await callRequirementAudit(harness.controller, {
    action: "verdict",
    verdicts: requirements.map((_requirement, index) => ({
      requirement_id: `R${index + 1}`,
      passed: true,
      reason: "The focused current-revision regression passed.",
      evidence_refs: [evidenceRefs[index] ?? evidenceRefs[0]!],
    })),
  });
  expect(incomplete).toContain("R10 requires focused executable evidence");
  expect(incomplete).toContain("R11 requires focused executable evidence");
  expect(incomplete).toContain("R12 requires focused executable evidence");
  expect(incomplete).toContain("R13 requires focused executable evidence");

  const missingRefs: string[] = [];
  for (const [index, selector] of missingSelectors.entries()) {
    missingRefs.push(await recordSelector(harness.agent, selector, definedRequirements[index + 9]!));
  }
  expect(
    harness.controller.currentState.requirementAudit.requirements
      .slice(9)
      .map((requirement, index) =>
        isFocusedEvidence(harness.controller, harness.controller.evidence.get(missingRefs[index]!)!, requirement),
      ),
  ).toEqual([true, true, true, true]);
  await nextModelTurn(harness);
  const result = await callRequirementAudit(harness.controller, {
    action: "verdict",
    verdicts: requirements.map((_requirement, index) => ({
      requirement_id: `R${index + 1}`,
      passed: true,
      reason: "The focused current-revision regression passed.",
      evidence_refs: [index >= 9 ? missingRefs[index - 9]! : evidenceRefs[index]!],
    })),
  });

  expect(result).toContain("Requirement audit passed: 13/13");
});
