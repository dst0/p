import assert from "node:assert/strict";
import { test } from "node:test";
import { isProjectInstructionVerificationControlPlaneAction } from "../../../packages/coding-agent/src/core/agent-session/project-instruction-action-phases.ts";
import { isBenchmarkProjectInstructionVerificationControlPlaneAction } from "../../src/project-instructions/verification-control-plane.ts";

test("benchmark verification control-plane exemptions stay in parity with production", () => {
  const cases: Array<[string, unknown, boolean]> = [
    ["record_requirement_audit", { action: "prepare_definition" }, true],
    ["record_requirement_audit", { action: "define" }, true],
    ["record_requirement_audit", { action: "verdict" }, true],
    ["record_task_verification", { action: "status" }, true],
    ["record_task_verification", { action: "declare_task" }, true],
    ["record_task_verification", { action: "authorize_baseline_test" }, true],
    ["record_task_verification", { action: "record_baseline" }, true],
    ["record_task_verification", { action: "record_final" }, true],
    ["record_task_verification", { action: "ready_to_finish" }, true],
    ["record_task_verification", { action: "unknown" }, false],
    ["record_task_verification", {}, false],
    ["record_task_verification", "status", false],
    ["extension_tool", { action: "status" }, false],
    ["extension_tool", { action: "ready_to_finish" }, false],
    ["record_task_verification", null, false],
    ["record_task_verification", Object.assign([], { action: "status" }), false],
  ];
  for (const [toolName, args, expected] of cases) {
    assert.equal(isBenchmarkProjectInstructionVerificationControlPlaneAction(toolName, args), expected);
    assert.equal(
      isProjectInstructionVerificationControlPlaneAction(toolName, args),
      expected,
      `${toolName} ${JSON.stringify(args)}`,
    );
  }
});
