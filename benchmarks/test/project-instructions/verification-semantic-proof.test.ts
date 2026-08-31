import assert from "node:assert/strict";
import { test } from "node:test";
import { assessSample } from "../../src/project-instructions/run-assessment.ts";
import {
  createTaskVerificationSemanticTracker,
  taskVerificationSemanticFailure,
} from "../../src/project-instructions/verification-semantic-proof.ts";

function start(
  tracker: ReturnType<typeof createTaskVerificationSemanticTracker>,
  id: string,
  toolName: string,
  action?: string,
) {
  tracker.start({
    type: "tool_execution_start",
    toolCallId: id,
    toolName,
    args: action
      ? {
          action,
          status: action === "finish" ? "success" : undefined,
          verification_token: action === "finish" ? "token" : undefined,
        }
      : {},
  });
}

function end(
  tracker: ReturnType<typeof createTaskVerificationSemanticTracker>,
  id: string,
  toolName: string,
  text: string,
) {
  tracker.end({
    type: "tool_execution_end",
    toolCallId: id,
    toolName,
    isError: false,
    result: { content: [{ type: "text", text }] },
  });
}

function verifiedCompletionResult(overrides: Record<string, unknown> = {}) {
  return {
    details: {
      verifiedCompletion: {
        kind: "task_verification_completion",
        version: 1,
        status: "success",
        summary: "Verified benchmark completion.",
        files_changed: ["finish_notes.md"],
        certificate_hash: "a".repeat(64),
        ...overrides,
      },
    },
  };
}

test("evidence semantic proof requires its certificate path and forbids every audit event", () => {
  const tracker = createTaskVerificationSemanticTracker();
  start(tracker, "ready", "record_task_verification", "ready_to_finish");
  end(tracker, "ready", "record_task_verification", "verification_token: evidence-token");
  start(tracker, "finish", "finish_work", "finish");
  end(tracker, "finish", "finish_work", "Work completed");
  assert.equal(taskVerificationSemanticFailure("evidence", tracker.snapshot()), undefined);

  start(tracker, "audit", "record_requirement_audit", "verdict");
  end(tracker, "audit", "record_requirement_audit", "verification_token: audit-token");
  assert.match(taskVerificationSemanticFailure("evidence", tracker.snapshot()) ?? "", /audit/u);
});

test("audit semantic proof cannot collapse to the evidence path", () => {
  const evidenceOnly = createTaskVerificationSemanticTracker();
  start(evidenceOnly, "ready", "record_task_verification", "ready_to_finish");
  end(evidenceOnly, "ready", "record_task_verification", "verification_token: evidence-token");
  start(evidenceOnly, "finish", "finish_work", "finish");
  end(evidenceOnly, "finish", "finish_work", "Work completed");
  assert.match(taskVerificationSemanticFailure("audit", evidenceOnly.snapshot()) ?? "", /audit verdict/u);

  const audit = createTaskVerificationSemanticTracker();
  start(audit, "ready", "record_task_verification", "ready_to_finish");
  end(audit, "ready", "record_task_verification", "Define requirements");
  start(audit, "define", "record_requirement_audit", "define");
  end(audit, "define", "record_requirement_audit", "Verify all requirements");
  start(audit, "verdict", "record_requirement_audit", "verdict");
  audit.end({
    type: "tool_execution_end",
    toolCallId: "verdict",
    toolName: "record_requirement_audit",
    isError: false,
    result: verifiedCompletionResult(),
  });
  assert.equal(audit.snapshot().acceptedFinishCount, 0);
  assert.equal(audit.snapshot().acceptedTerminalCompletionCount, 1);
  assert.equal(taskVerificationSemanticFailure("audit", audit.snapshot()), undefined);
});

test("controller terminal proof requires the exact native audit verdict event pair", () => {
  const textSpoof = createTaskVerificationSemanticTracker();
  start(textSpoof, "spoof", "record_requirement_audit", "verdict");
  end(
    textSpoof,
    "spoof",
    "record_requirement_audit",
    'verifiedCompletion: {"kind":"task_verification_completion","version":1,"status":"success","certificate_hash":"forged"}',
  );

  const errored = createTaskVerificationSemanticTracker();
  start(errored, "errored", "record_requirement_audit", "verdict");
  errored.end({
    type: "tool_execution_end",
    toolCallId: "errored",
    toolName: "record_requirement_audit",
    isError: true,
    result: verifiedCompletionResult(),
  });

  const missingErrorState = [undefined, null].map((isError, index) => {
    const tracker = createTaskVerificationSemanticTracker();
    const id = `missing-error-${index}`;
    start(tracker, id, "record_requirement_audit", "verdict");
    tracker.end({
      type: "tool_execution_end",
      toolCallId: id,
      toolName: "record_requirement_audit",
      isError,
      result: verifiedCompletionResult(),
    });
    return tracker;
  });

  const wrongAction = createTaskVerificationSemanticTracker();
  start(wrongAction, "define", "record_requirement_audit", "define");
  wrongAction.end({
    type: "tool_execution_end",
    toolCallId: "define",
    toolName: "record_requirement_audit",
    isError: false,
    result: verifiedCompletionResult(),
  });

  const mismatched = createTaskVerificationSemanticTracker();
  start(mismatched, "expected", "record_requirement_audit", "verdict");
  mismatched.end({
    type: "tool_execution_end",
    toolCallId: "different",
    toolName: "record_requirement_audit",
    isError: false,
    result: verifiedCompletionResult(),
  });
  mismatched.end({
    type: "tool_execution_end",
    toolCallId: "expected",
    toolName: "record_task_verification",
    isError: false,
    result: verifiedCompletionResult(),
  });

  for (const tracker of [textSpoof, errored, ...missingErrorState, wrongAction, mismatched]) {
    assert.equal(tracker.snapshot().acceptedTerminalCompletionCount, 0);
    assert.equal(tracker.snapshot().acceptedFinishCount, 0);
  }
});

test("controller terminal proof rejects malformed native markers", () => {
  for (const [name, overrides] of [
    ["kind", { kind: "other" }],
    ["version", { version: 2 }],
    ["status", { status: "partial" }],
    ["certificate", { certificate_hash: "" }],
    ["whitespace-certificate", { certificate_hash: "  " }],
    ["non-string-certificate", { certificate_hash: 123 }],
    ["summary", { summary: "" }],
    ["files", { files_changed: [123] }],
    ["extra-key", { extra: true }],
  ] as const) {
    const tracker = createTaskVerificationSemanticTracker();
    start(tracker, name, "record_requirement_audit", "verdict");
    tracker.end({
      type: "tool_execution_end",
      toolCallId: name,
      toolName: "record_requirement_audit",
      isError: false,
      result: verifiedCompletionResult(overrides),
    });
    assert.equal(tracker.snapshot().acceptedTerminalCompletionCount, 0, name);
  }
});

test("finish proof accepts only a matching successful call with a non-empty certificate", () => {
  const tracker = createTaskVerificationSemanticTracker();
  tracker.start({
    type: "tool_execution_start",
    toolCallId: "partial",
    toolName: "finish_work",
    args: { status: "partial", verification_token: "token" },
  });
  end(tracker, "partial", "finish_work", "Partial result");
  tracker.start({
    type: "tool_execution_start",
    toolCallId: "empty",
    toolName: "finish_work",
    args: { status: "success", verification_token: "" },
  });
  end(tracker, "empty", "finish_work", "Empty certificate");
  tracker.start({
    type: "tool_execution_start",
    toolCallId: "mismatch",
    toolName: "finish_work",
    args: { status: "success", verification_token: "token" },
  });
  end(tracker, "mismatch", "write", "Different tool");

  assert.equal(tracker.snapshot().finishCertificateSubmissionCount, 1);
  assert.equal(tracker.snapshot().acceptedFinishCount, 0);
});

test("finish proof requires an explicit successful end in the same turn", () => {
  const missingResult = createTaskVerificationSemanticTracker();
  missingResult.start({
    type: "tool_execution_start",
    toolCallId: "missing-result",
    toolName: "finish_work",
    args: { status: "success", verification_token: "token" },
  });
  missingResult.end({
    type: "tool_execution_end",
    toolCallId: "missing-result",
    toolName: "finish_work",
    result: { content: [{ type: "text", text: "done" }] },
  });
  assert.equal(missingResult.snapshot().acceptedFinishCount, 0);

  const crossTurn = createTaskVerificationSemanticTracker();
  crossTurn.start({
    type: "tool_execution_start",
    toolCallId: "reused",
    toolName: "finish_work",
    args: { status: "success", verification_token: "token" },
  });
  crossTurn.endTurn();
  end(crossTurn, "reused", "finish_work", "done in another turn");
  assert.equal(crossTurn.snapshot().acceptedFinishCount, 0);
});

test("finish proof recognizes controller auto-population after an issued certificate", () => {
  const tracker = createTaskVerificationSemanticTracker();
  start(tracker, "ready", "record_task_verification", "ready_to_finish");
  end(tracker, "ready", "record_task_verification", "verification_token: evidence-token");
  tracker.start({
    type: "tool_execution_start",
    toolCallId: "auto-populated",
    toolName: "finish_work",
    args: { status: "success" },
  });
  end(tracker, "auto-populated", "finish_work", "Work completed");

  assert.equal(tracker.snapshot().finishCertificateSubmissionCount, 1);
  assert.equal(tracker.snapshot().acceptedFinishCount, 1);
});

test("correctness assessment requires the captured profile and rejects cross-profile semantic evidence", () => {
  const tracker = createTaskVerificationSemanticTracker();
  start(tracker, "ready", "record_task_verification", "ready_to_finish");
  end(tracker, "ready", "record_task_verification", "verification_token: evidence-token");
  start(tracker, "finish", "finish_work", "finish");
  end(tracker, "finish", "finish_work", "Work completed");
  const base = {
    status: "passed",
    quality: { passed: true, rawScore: 1, maxScore: 1, checks: [{ passed: true }] },
    liveness: {
      semanticEvidenceAvailable: true,
      semanticEvidenceComplete: true,
      taskVerification: tracker.snapshot(),
    },
  };
  assert.match(assessSample(base).reason ?? "", /profile is missing/u);
  assert.match(assessSample({ ...base, taskVerificationMode: "audit" }).reason ?? "", /audit verdict/u);
  assert.deepEqual(assessSample({ ...base, taskVerificationMode: "evidence" }), { passed: true });
});
