import assert from "node:assert/strict";
import test from "node:test";

import type { RequirementRepairTelemetry } from "../../src/project-instructions/run-repair-telemetry.ts";
import { createRequirementRepairTelemetry } from "../../src/project-instructions/run-repair-telemetry.ts";

const CURRENT_REVISION = "11111111-1111-1111-1111-111111111111";
const NEXT_REVISION = "22222222-2222-2222-2222-222222222222";

function start(id: string, args: Record<string, unknown>) {
  return { type: "tool_execution_start", toolCallId: id, toolName: "record_requirement_audit", args };
}

function end(
  id: string,
  status: string,
  message: string,
  revision?: string,
  acceptedCount?: number,
  diagnosticCount?: number,
) {
  const content = revision ? `${message}\n\ndefinition_revision: ${revision}` : message;
  const requirements = acceptedCount === undefined ? undefined : Array.from({ length: acceptedCount }, () => ({}));
  return {
    type: "tool_execution_end",
    toolCallId: id,
    toolName: "record_requirement_audit",
    result: {
      content: [{ type: "text", text: content }],
      details: {
        status,
        message,
        ...(diagnosticCount === undefined ? {} : { requirementDefinitionDiagnosticCount: diagnosticCount }),
        state: { requirementAudit: { requirements } },
      },
    },
  };
}

function repairArgs(definitionRevision: string) {
  return {
    action: "repair_definition",
    definition_revision: definitionRevision,
    requirement_repairs: [{ requirement_index: 1, replacements: [{ text: "replacement" }] }],
  };
}

test("revision rotation recognizes an unknown validator diagnostic and gates accepted repairs", () => {
  const telemetry = createRequirementRepairTelemetry();
  telemetry.start(
    start("define", { action: "define", requirements: [{ text: "one" }, { text: "two" }] }),
    "define",
    10,
  );
  telemetry.end(
    end(
      "define",
      "needs_action",
      "Requirement definition has 2 deterministic validation errors:\n1. Requirement 1 is compound.\n2. Requirement 2 references an invalid source_clause_id.",
      CURRENT_REVISION,
      undefined,
      2,
    ),
    "define",
    20,
  );
  telemetry.start(start("unknown", repairArgs(CURRENT_REVISION)), "unknown", 30);
  const unknown = telemetry.end(
    end(
      "unknown",
      "needs_action",
      "Requirement 1 violates a newly introduced validator invariant.",
      NEXT_REVISION,
      undefined,
      1,
    ),
    "unknown",
    40,
  );
  assert.ok(unknown && unknown.event === "requirement_definition_settled");
  assert.equal(unknown.definitionOutcome, "rejected");
  assert.equal(unknown.diagnosticsComparable, true);
  assert.equal(unknown.diagnosticTotal, 1);
  assert.deepEqual(unknown.diagnosticClassHistogram, { other: 1 });
  assert.deepEqual(unknown.diagnosticLineage, { resolved: 2, persisting: 0, introduced: 1, complete: true });

  telemetry.start(start("stale-accepted", repairArgs(CURRENT_REVISION)), "stale-accepted", 50);
  const staleAccepted = telemetry.end(end("stale-accepted", "updated", "accepted", undefined, 9), "stale-accepted", 60);
  assert.ok(staleAccepted && staleAccepted.event === "requirement_definition_settled");
  assert.equal(staleAccepted.definitionOutcome, "protocol_rejected");
  assert.equal(staleAccepted.currentDraftRequirementCount, 2);
  assert.equal(staleAccepted.diagnosticsComparable, false);

  telemetry.start(start("accepted", repairArgs(NEXT_REVISION)), "accepted", 70);
  const accepted = telemetry.end(end("accepted", "updated", "accepted", undefined, 3), "accepted", 80);
  assert.ok(accepted && accepted.event === "requirement_definition_settled");
  assert.equal(accepted.definitionOutcome, "accepted");
  assert.equal(accepted.currentDraftRequirementCount, 3);
  assert.deepEqual(accepted.diagnosticLineage, { resolved: 1, persisting: 0, introduced: 0, complete: true });
  assert.doesNotMatch(
    JSON.stringify([unknown, staleAccepted, accepted]),
    new RegExp(`${CURRENT_REVISION}|${NEXT_REVISION}`, "u"),
  );
});

test("diagnostic fingerprints correlate only inside one telemetry cell", () => {
  const diagnostic = "Requirement 1 contains customer-specific low-entropy-value.";
  const settleDefine = (telemetry: RequirementRepairTelemetry, id: string, revision: string) => {
    telemetry.start(start(id, { action: "define", requirements: [{ text: "one" }] }), id, 10);
    return telemetry.end(end(id, "needs_action", diagnostic, revision, undefined, 1), id, 20);
  };
  const firstCell = createRequirementRepairTelemetry();
  const first = settleDefine(firstCell, "first", CURRENT_REVISION);
  const repeated = settleDefine(firstCell, "repeated", NEXT_REVISION);
  const secondCell = createRequirementRepairTelemetry();
  const independent = settleDefine(secondCell, "independent", CURRENT_REVISION);

  assert.ok(first && first.event === "requirement_definition_settled");
  assert.ok(repeated && repeated.event === "requirement_definition_settled");
  assert.ok(independent && independent.event === "requirement_definition_settled");
  assert.equal(first.diagnosticFingerprints[0].hmacSha256, repeated.diagnosticFingerprints[0].hmacSha256);
  assert.notEqual(first.diagnosticFingerprints[0].hmacSha256, independent.diagnosticFingerprints[0].hmacSha256);
  assert.doesNotMatch(
    JSON.stringify([first, repeated, independent]),
    /customer-specific|low-entropy-value|fingerprintKey/iu,
  );
});

test("suppressed final replay rebuilds lineage before an unseen repair", () => {
  const telemetry = createRequirementRepairTelemetry();
  const defineStart = start("define", { action: "define", requirements: [{ text: "one" }] });
  const defineEnd = end("define", "needs_action", "Requirement 1 is compound.", CURRENT_REVISION, undefined, 1);
  telemetry.start(defineStart, "define", 10);
  assert.ok(telemetry.end(defineEnd, "define", 20));

  telemetry.resetReplayState();
  telemetry.start(defineStart, "define", 30);
  assert.equal(telemetry.end(defineEnd, "define", 40), undefined);
  telemetry.start(start("repair", repairArgs(CURRENT_REVISION)), "repair", 50);
  const repair = telemetry.end(
    end("repair", "needs_action", "Requirement 1 is compound.", NEXT_REVISION, undefined, 1),
    "repair",
    60,
  );

  assert.ok(repair && repair.event === "requirement_definition_settled");
  assert.equal(repair.definitionOutcome, "rejected");
  assert.deepEqual(repair.diagnosticLineage, { resolved: 0, persisting: 1, introduced: 0, complete: true });
});
