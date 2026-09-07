import { describe, expect, it } from "vitest";
import { SessionManager } from "../src/core/session-manager.ts";
import {
  formatRequirementBatchPrompt,
  formatRequirementProofPlan,
} from "../src/core/task-verification/taskverificationcontroller-methods/requirement-audit-prompt.ts";
import { requirementProofCommandGate } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-proof-command-gate.ts";
import type { TaskRequirement } from "../src/core/task-verification/types.ts";
import { createRequirementAuditHarness } from "./task-requirement-audit-test-harness.ts";

describe("persisted procedural requirement risk", () => {
  it("restores a safe procedural requirement without reviving stale proof fields", () => {
    const sessionManager = SessionManager.inMemory();
    const initial = createRequirementAuditHarness(sessionManager);
    const requirement: TaskRequirement = {
      id: "R1",
      type: "workflow",
      text: "Run tests after implementation and recover with npm test when needed",
      acceptanceCriterion: "The test command passes after implementation",
      sourcePromptIndexes: [1],
      highRisk: true,
      proofPolicies: ["preserve_state_on_failure"],
    };
    initial.controller.state.mutationRevision = 1;
    initial.controller.state.requirementAudit = {
      ...initial.controller.state.requirementAudit,
      requirements: [requirement],
    };
    initial.controller.persistState();
    const restored = createRequirementAuditHarness(sessionManager);

    expect(restored.controller.restoreError).toBeUndefined();
    expect(formatRequirementBatchPrompt([requirement])).not.toContain("Controller proof obligations");
    expect(formatRequirementProofPlan([requirement])).toBeUndefined();
    expect(restored.controller.currentState.requirementAudit.requirements).toHaveLength(1);
    expect(requirementProofCommandGate(restored.controller, "bash", { command: "npm test" })).toBeUndefined();
  });

  it("fails closed for a safe legacy fallback with stale source-risk provenance", () => {
    const sessionManager = SessionManager.inMemory();
    const initial = createRequirementAuditHarness(sessionManager);
    initial.controller.state.requirementAudit = {
      ...initial.controller.state.requirementAudit,
      requirements: [
        {
          id: "R1",
          type: "workflow",
          text: "Run tests after implementation and recover with npm test when needed",
          acceptanceCriterion: "The test command passes after implementation",
          sourcePromptIndexes: [1],
          highRisk: true,
          highRiskSourcePromptIndexes: [1],
        },
      ],
    };
    initial.controller.persistState();
    const restored = createRequirementAuditHarness(sessionManager);

    expect(restored.controller.restoreError).toContain("latest persisted task-verification state is invalid");
  });

  it("fails closed when a persisted workflow hides a runtime invariant", () => {
    const sessionManager = SessionManager.inMemory();
    const initial = createRequirementAuditHarness(sessionManager);
    initial.controller.state.requirementAudit = {
      ...initial.controller.state.requirementAudit,
      requirements: [
        {
          id: "R1",
          type: "workflow",
          text: "Failed recovery preserves state without partial mutation",
          acceptanceCriterion: "State remains unchanged after failed recovery",
          sourcePromptIndexes: [1],
          highRisk: true,
        },
      ],
    };
    initial.controller.persistState();
    const restored = createRequirementAuditHarness(sessionManager);

    expect(restored.controller.restoreError).toContain("latest persisted task-verification state is invalid");
  });

  it("restores a constraint proof policy that still blocks a broad test command", () => {
    const sessionManager = SessionManager.inMemory();
    const initial = createRequirementAuditHarness(sessionManager);
    initial.controller.state.mutationRevision = 1;
    initial.controller.state.requirementAudit = {
      ...initial.controller.state.requirementAudit,
      requirements: [
        {
          id: "R1",
          type: "constraint",
          text: "Failed recovery preserves state without partial mutation",
          acceptanceCriterion: "State remains unchanged after failed recovery",
          sourcePromptIndexes: [1],
          highRisk: true,
          proofPolicies: ["preserve_state_on_failure"],
        },
      ],
    };
    initial.controller.persistState();
    const restored = createRequirementAuditHarness(sessionManager);

    expect(restored.controller.restoreError).toBeUndefined();
    expect(restored.controller.currentState.requirementAudit.requirements).toHaveLength(1);
    expect(requirementProofCommandGate(restored.controller, "bash", { command: "npm test" })?.block).toBe(true);
  });
});
