import assert from "node:assert/strict";
import { test } from "node:test";
import { isProjectInstructionVerificationControlPlaneAction } from "../../../packages/coding-agent/src/core/agent-session/project-instruction-action-phases.ts";
import { isBenchmarkProjectInstructionVerificationControlPlaneAction } from "../../src/project-instructions/verification-control-plane.ts";

test("benchmark verification control-plane exemptions stay in parity with production", () => {
  const cases: Array<[string, unknown]> = [
    ["record_requirement_audit", { action: "prepare_definition" }],
    ["record_requirement_audit", { action: "define" }],
    ["record_requirement_audit", { action: "verdict" }],
    ["record_task_verification", { action: "status" }],
    ["record_task_verification", { action: "declare_task" }],
    ["record_task_verification", { action: "ready_to_finish" }],
    ["extension_tool", { action: "status" }],
    ["record_task_verification", null],
    ["record_task_verification", Object.assign([], { action: "status" })],
  ];
  for (const [toolName, args] of cases) {
    assert.equal(
      isBenchmarkProjectInstructionVerificationControlPlaneAction(toolName, args),
      isProjectInstructionVerificationControlPlaneAction(toolName, args),
      `${toolName} ${JSON.stringify(args)}`,
    );
  }
});
