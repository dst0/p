import assert from "node:assert/strict";
import { appendFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { brotliCompressSync, brotliDecompressSync, constants as zlibConstants } from "node:zlib";

import { createRequirementRepairTelemetry } from "./benchmark-project-instructions-repair-telemetry.js";
import { createCellLivenessMonitor } from "./benchmark-project-instructions-liveness.js";

const PRIVATE_REQUIREMENT = "Authorization private-prompt requirement";
const PRIVATE_DIAGNOSTIC = "private diagnostic payload";
const CURRENT_REVISION = "11111111-1111-1111-1111-111111111111";
const NEXT_REVISION = "22222222-2222-2222-2222-222222222222";

function start(toolCallId, toolName, args, benchmarkEventOrdinal) {
  return { type: "tool_execution_start", toolCallId, toolName, args, benchmarkEventOrdinal };
}

function end(toolCallId, toolName, status, message, content = message) {
  return {
    type: "tool_execution_end",
    toolCallId,
    toolName,
    isError: false,
    result: {
      content: [{ type: "text", text: content }],
      details: {
        status,
        message,
        state: { requirementAudit: { status: status === "updated" ? "verifying" : "awaiting_definition" } },
      },
    },
  };
}

function definitionArgs() {
  return {
    action: "define",
    requirements: [
      { text: PRIVATE_REQUIREMENT, acceptance_criterion: "first", source_clause_ids: ["S2-C1"] },
      { text: "second", acceptance_criterion: "second", source_clause_ids: ["S2-C2"] },
    ],
  };
}

function rejection(diagnostics, revision = CURRENT_REVISION) {
  return `${diagnostics}\n\ndefinition_revision: ${revision}`;
}

test("repair lineage distinguishes resolved and introduced diagnostics when the raw total increases", () => {
  const telemetry = createRequirementRepairTelemetry();
  telemetry.start(start("define", "record_requirement_audit", definitionArgs(), 10), "define", 100);
  const first = telemetry.end(
    end(
      "define",
      "record_requirement_audit",
      "needs_action",
      `Requirement definition has 2 deterministic validation errors:\n1. Requirement 1 is compound: ${PRIVATE_DIAGNOSTIC}.\n2. Requirement 2 references an invalid source_clause_id.`,
      rejection("rejected"),
    ),
    "define",
    200,
  );
  telemetry.start(
    start(
      "repair",
      "record_requirement_audit",
      {
        action: "repair_definition",
        definition_revision: CURRENT_REVISION,
        requirement_repairs: [{ requirement_index: 1, replacements: [{ text: "split one" }, { text: "split two" }] }],
      },
      20,
    ),
    "repair",
    300,
  );
  const second = telemetry.end(
    end(
      "repair",
      "record_requirement_audit",
      "needs_action",
      "Requirement definition has 3 deterministic validation errors:\n1. Requirement 1 references an invalid source_clause_id.\n2. Requirement 2 references an invalid source_facet_id.\n3. Requirement 3 references an invalid source_facet_id.",
      rejection("rejected again", NEXT_REVISION),
    ),
    "repair",
    400,
  );

  assert.equal(first.diagnosticTotal, 2);
  assert.equal(first.submittedRequirementCount, 2);
  assert.equal(first.currentDraftRequirementCount, 2);
  assert.equal(second.diagnosticTotal, 3);
  assert.equal(second.repairEntryCount, 1);
  assert.equal(second.replacementCount, 2);
  assert.equal(second.currentDraftRequirementCount, 3);
  assert.deepEqual(second.diagnosticLineage, { resolved: 1, persisting: 1, introduced: 2, complete: true });
  assert.equal(second.diagnosticClassHistogram.invalid_clause_id, 1);
  assert.equal(second.diagnosticClassHistogram.invalid_facet_id, 2);
  assert.ok(second.diagnosticFingerprints.every((item) => /^[a-f0-9]{64}$/u.test(item.hmacSha256)));
  assert.doesNotMatch(JSON.stringify([first, second]), new RegExp(`${PRIVATE_REQUIREMENT}|${PRIVATE_DIAGNOSTIC}|private-revision`, "u"));
});

test("final recording replay rebuilds lineage without emitting duplicate settled telemetry", () => {
  const telemetry = createRequirementRepairTelemetry();
  const startEvent = start("define", "record_requirement_audit", definitionArgs(), 10);
  const endEvent = end("define", "record_requirement_audit", "needs_action", "Requirement 1 is compound.", rejection("x"));
  telemetry.start(startEvent, "define", 100);
  assert.ok(telemetry.end(endEvent, "define", 200));
  telemetry.resetReplayState();
  telemetry.start(startEvent, "define", 300);
  assert.equal(telemetry.end(endEvent, "define", 400), undefined);
});

test("liveness final recording replay does not duplicate telemetry already observed live", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-repair-telemetry-replay-"));
  const activeRecordingPath = join(root, "recording.jsonl.active");
  const finalRecordingPath = join(root, "recording.jsonl.br");
  const progressPath = join(root, "progress.jsonl");
  const events = [
    start("define", "record_requirement_audit", definitionArgs(), 10),
    end("define", "record_requirement_audit", "needs_action", "Requirement 1 is compound.", rejection("x")),
  ];
  const recording = `${events.map(JSON.stringify).join("\n")}\n`;
  try {
    writeFileSync(activeRecordingPath, recording, { mode: 0o600 });
    const monitor = createCellLivenessMonitor({
      progressPath,
      activeRecordingPath,
      finalRecordingPath,
      schedule: () => ({ fake: true }),
      cancel: () => {},
    });
    monitor.observe();
    writeFileSync(
      finalRecordingPath,
      brotliCompressSync(recording, {
        params: { [zlibConstants.BROTLI_PARAM_QUALITY]: 6 },
      }),
      { mode: 0o600 },
    );
    rmSync(activeRecordingPath);
    await monitor.finalize({ outcome: "process_completed" });
    const records = brotliDecompressSync(readFileSync(`${progressPath}.br`)).toString("utf8").trim().split("\n").map(JSON.parse);
    assert.equal(records.filter((record) => record.event === "requirement_definition_settled").length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("status telemetry distinguishes active sparse repair recovery from a full-definition restart", () => {
  const telemetry = createRequirementRepairTelemetry();
  telemetry.start(start("active", "record_task_verification", { action: "status" }, 1), "active", 10);
  const active = telemetry.end(
    end("active", "record_task_verification", "needs_action", "status", "ACTIVE REJECTED DEFINITION BATCH"),
    "active",
    20,
  );
  telemetry.start(start("restart", "record_task_verification", { action: "status" }, 2), "restart", 30);
  const restart = telemetry.end(
    end(
      "restart",
      "record_task_verification",
      "needs_action",
      "status",
      'Call record_requirement_audit with action "define" using the full definition prompt.',
    ),
    "restart",
    40,
  );
  assert.equal(active.statusRecovery, "active_rejected_definition_batch");
  assert.equal(restart.statusRecovery, "full_definition_restart");
  assert.deepEqual([active.actionOrder, restart.actionOrder], [1, 2]);
});

test("rejected repair protocol calls preserve the active draft count and diagnostic lineage", () => {
  const telemetry = createRequirementRepairTelemetry();
  telemetry.start(start("define", "record_requirement_audit", definitionArgs(), 1), "define", 10);
  telemetry.end(
    end(
      "define",
      "record_requirement_audit",
      "needs_action",
      "Requirement definition has 2 deterministic validation errors:\n1. Requirement 1 is compound.\n2. Requirement 2 references an invalid source_clause_id.",
      rejection("rejected"),
    ),
    "define",
    20,
  );
  const repairArgs = {
    action: "repair_definition",
    definition_revision: "stale",
    requirement_repairs: [{ requirement_index: 1, replacements: [{ text: "one" }, { text: "two" }] }],
  };
  telemetry.start(start("stale", "record_requirement_audit", repairArgs, 2), "stale", 30);
  const stale = telemetry.end(
    end(
      "stale",
      "record_requirement_audit",
      "needs_action",
      "The definition_revision is stale or unavailable. Resubmit one complete definition batch.",
      rejection("The definition_revision is stale or unavailable."),
    ),
    "stale",
    40,
  );
  const invalidArgs = {
    ...repairArgs,
    definition_revision: CURRENT_REVISION,
    requirement_repairs: [{ requirement_index: 99, replacements: [{ text: "one" }, { text: "two" }] }],
  };
  telemetry.start(start("invalid", "record_requirement_audit", invalidArgs, 3), "invalid", 45);
  const invalid = telemetry.end(
    end(
      "invalid",
      "record_requirement_audit",
      "needs_action",
      "requirement_repairs references invalid rejected-batch indexes: 99.",
      rejection("requirement_repairs references invalid rejected-batch indexes: 99."),
    ),
    "invalid",
    50,
  );
  telemetry.start(start("barrier", "record_requirement_audit", repairArgs, 4), "barrier", 55);
  const barrier = telemetry.end(
    end(
      "barrier",
      "record_requirement_audit",
      "needs_action",
      'Requirement indexes changed. Call record_task_verification with action "status" before another repair_definition call.',
    ),
    "barrier",
    60,
  );

  for (const record of [stale, invalid, barrier]) {
    assert.equal(record.definitionOutcome, "protocol_rejected");
    assert.equal(record.currentDraftRequirementCount, 2);
    assert.equal(record.diagnosticTotal, 2);
    assert.deepEqual(record.diagnosticLineage, { resolved: null, persisting: null, introduced: null, complete: false });
    assert.equal(record.diagnosticsComparable, false);
  }
});

test("SIGINT finalization retains sanitized settled telemetry in Brotli progress evidence", async () => {
  const root = mkdtempSync(join(tmpdir(), "p-repair-telemetry-interrupted-"));
  const activeRecordingPath = join(root, "recording.jsonl.active");
  const progressPath = join(root, "progress.jsonl");
  let elapsedMs = 0;
  try {
    writeFileSync(activeRecordingPath, "", { mode: 0o600 });
    const monitor = createCellLivenessMonitor({
      progressPath,
      activeRecordingPath,
      finalRecordingPath: join(root, "recording.jsonl.br"),
      now: () => 1_000 + elapsedMs,
      schedule: () => ({ fake: true }),
      cancel: () => {},
    });
    const events = [
      start("define", "record_requirement_audit", definitionArgs(), 10),
      end("define", "record_requirement_audit", "needs_action", `Requirement 1 is compound: ${PRIVATE_DIAGNOSTIC}.`, rejection("x")),
      start("status", "record_task_verification", { action: "status" }, 20),
      end("status", "record_task_verification", "needs_action", "status", "ACTIVE REJECTED DEFINITION BATCH"),
    ];
    elapsedMs = 500;
    appendFileSync(activeRecordingPath, `${events.map(JSON.stringify).join("\n")}\n`);
    monitor.observe();
    elapsedMs = 700;
    await monitor.finalize({ outcome: "interrupted" });
    const evidence = brotliDecompressSync(readFileSync(`${progressPath}.br`)).toString("utf8");
    const records = evidence.trim().split("\n").map(JSON.parse);
    assert.deepEqual(records.map((record) => record.event), [
      "started",
      "requirement_definition_settled",
      "requirement_definition_status_settled",
      "interrupted",
    ]);
    assert.equal(records[1].diagnosticTotal, 1);
    assert.equal(records[2].statusRecovery, "active_rejected_definition_batch");
    assert.doesNotMatch(evidence, new RegExp(`${PRIVATE_REQUIREMENT}|${PRIVATE_DIAGNOSTIC}|ACTIVE REJECTED|"args"`, "u"));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
