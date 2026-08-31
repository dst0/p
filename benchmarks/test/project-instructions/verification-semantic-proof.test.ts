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
  end(audit, "verdict", "record_requirement_audit", "verification_token: audit-token");
  start(audit, "finish", "finish_work", "finish");
  end(audit, "finish", "finish_work", "Work completed");
  assert.equal(taskVerificationSemanticFailure("audit", audit.snapshot()), undefined);
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
