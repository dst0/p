import { describe, expect, it } from "vitest";
import { compoundHighRiskRequirementError } from "../src/core/task-verification/requirement-definition-atomicity.ts";
import { validateRequirementDefinition } from "../src/core/task-verification/requirement-definition-validation.ts";
import { deriveRequirementProofPolicies } from "../src/core/task-verification/requirement-derived-boundaries.ts";
import { isHighRiskText } from "../src/core/task-verification/requirement-risk.ts";
import { isHighRiskRequirement } from "../src/core/task-verification/taskverificationcontroller-methods/requirement-verdict-validation.ts";
import type { TaskRequirement, TaskVerificationSourcePrompt } from "../src/core/task-verification/types.ts";
import {
  auditEvidenceHandle,
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
} from "./task-requirement-audit-test-harness.ts";

describe("procedural requirement risk classification", () => {
  it.each(["workflow", "verification"] as const)(
    "does not turn a %s instruction into a recursively high-risk invariant",
    (type) => {
      expect(
        isHighRiskRequirement({
          id: "R1",
          type,
          text: "Run the tests after implementation and recover with npm test when needed",
          acceptanceCriterion: "The test command completes with all contract tests passing",
          sourcePromptIndexes: [1],
          highRisk: true,
        }),
      ).toBe(false);
    },
  );

  it("does not treat a recovery test fallback as a runtime invariant", () => {
    expect(
      compoundHighRiskRequirementError(
        "Run tests after implementation and recover with npm test when needed",
        "The unit tests pass; the typecheck passes",
      ),
    ).toBeUndefined();
  });

  it.each([
    "If that script is unavailable, recover by running `npm test`.",
    "Recover by running `npm test` after the unit script is unavailable",
    "Recover using pnpm test after implementation",
    "Use yarn test as a recovery fallback",
    "The recovery fallback runs bun test",
    "Recovers by running cargo test after implementation",
    "Recover with go test ./... after implementation",
    "Recover using pytest after implementation",
    "Recover with node --test test/x.test.js after implementation",
    "Recover with vitest --run after implementation",
    "Recover with vitest --run test/recovery-manifest.test.ts after implementation",
    "Recover with npm run test:recovery after implementation",
    "As a recovery fallback, run npm test.",
    "As a recovery fallback: run npm test.",
    "As the fallback for recovery, run npm test.",
    "As a recovery fallback run npm test.",
    "As a recovery fallback, run npm test to run recovery tests.",
    "As the fallback for recovery: run npm test for manifest tests.",
    "As a recovery fallback run npm test to execute authorization tests.",
    "Use npm test as the fallback for recovery.",
    'Recover with vitest -t "recovery preserves state" after implementation',
  ])("recognizes procedural test fallback wording without suppressing real recovery invariants: %s", (text) => {
    expect(isHighRiskText(text)).toBe(false);
  });

  it.each([
    "If npm run test:unit is unavailable, npm test is run as a recovery fallback.",
    "If npm run test:unit is unavailable then npm test is run as a recovery fallback.",
    "If npm run test:unit is unavailable: npm test is used as recovery fallback.",
    "If npm run test:recovery is unavailable then npm test is run as a recovery fallback.",
    "If `npm run test:recovery` is unavailable then npm test is run as a recovery fallback.",
    "If the recovery test is unavailable then npm test is run as a recovery fallback.",
    "If the `recovery test` is unavailable then npm test is run as a recovery fallback.",
    "When recovery tests are unavailable then npm test is run as a recovery fallback.",
    "When npm run test:unit is unavailable, npm test is used as the recovery fallback to run tests.",
    "If npm run test:unit is unavailable, npm test is run as recovery to execute tests.",
    "When npm run test:unit is unavailable, npm test is selected as the recovery fallback.",
    "When npm run test:unit is unavailable, npm test is chosen as the recovery fallback.",
    "When npm run test:unit is unavailable, npm test serves as the recovery fallback.",
    "When primary tests are unavailable, npm test is used as the recovery fallback to run recovery tests.",
    "When the suite is unavailable, npm test is selected as the recovery fallback for manifest tests.",
  ])("recognizes a passive recovery-fallback acceptance criterion: %s", (acceptanceCriterion) => {
    expect(
      isHighRiskText(`If test:unit script is unavailable, recover by running npm test\n${acceptanceCriterion}`),
    ).toBe(false);
  });

  it.each([
    "Recover with npm test and preserve state after failure",
    "Recover with npm test with no partial mutation",
    "Recover with `latest persisted manifest`",
    "Recover with `test artifact integrity`",
    "Recover with npm test && delete the persisted manifest",
    "Recover with npm test | mutate state",
    "Recover with npm run typecheck && remove integrity metadata",
    "Recover with npm test without mutating state",
    "Recover with npm test, then delete the persisted manifest",
    "Recover with npm test then preserve logs",
    "Recover with npm test and preserve history",
    "Recover with npm test and preserve version",
    "Recover with npm test and preserve position",
    "Recover with npm test but delete the persisted manifest",
    "Recover with npm test to preserve state",
    "Recover with npm test however mutate state",
    "Recover with npm test to delete state",
    "Recover with npm test however change state",
    "Recover with npm test and advance version",
    "Recover with npm test but clear logs",
    "Recover with npm test and leave state unchanged",
    "Recover with npm test without changing state",
    "Use npm test as a recovery fallback without partial mutation",
    "If failed recovery must preserve state then npm test is run as a recovery fallback",
    "When primary tests are unavailable, npm test is used as the recovery fallback to run recovery tests while preserving state",
    "When the suite is unavailable, npm test is selected as the recovery fallback for manifest tests without partial mutation",
    "When primary tests are unavailable, npm test is used as the recovery fallback to run recovery tests with authorization required",
    "As a recovery fallback, run npm test while preserving state",
    "As a recovery fallback: run npm test while preserving state",
    "As the fallback for recovery, run npm test without partial mutation",
    "As a recovery fallback, run npm test to run recovery tests while preserving state",
    "As the fallback for recovery: run npm test for manifest tests without partial mutation",
    "As a recovery fallback run npm test to execute authorization tests with authorization required",
    "Use npm test as the fallback for recovery without partial mutation",
  ])("retains runtime-state semantics outside an actual procedural fallback: %s", (text) => {
    expect(isHighRiskText(text)).toBe(true);
  });

  it.each(["workflow", "verification"] as const)(
    "clears stale executable proof policies from a restored %s",
    (type) => {
      const sources: TaskVerificationSourcePrompt[] = [
        {
          id: "spec",
          kind: "referenced_file",
          text: "Run tests after implementation and recover with npm test when needed.",
        },
      ];
      const requirement: TaskRequirement = {
        id: "R1",
        type,
        text: "Run tests after implementation and recover with npm test when needed",
        acceptanceCriterion: "The test command passes after implementation",
        sourcePromptIndexes: [1],
        sourceClauseIds: ["S1-C1"],
        proofPolicies: ["preserve_state_on_failure"],
      };
      const result = deriveRequirementProofPolicies(sources, [requirement]);

      expect(typeof result).not.toBe("string");
      expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
    },
  );

  it.each(["workflow", "verification"] as const)("rejects a direct high-risk invariant mislabeled as %s", (type) => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Failed recovery preserves state without partial mutation." }],
      {
        action: "define",
        requirements: [
          {
            type,
            text: "Recover with npm test when needed",
            acceptance_criterion: "npm test passes",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics.join("\n")).toContain("must use behavior, constraint, or deliverable");
  });

  it("allows a separate workflow when an eligible requirement covers the direct invariant", () => {
    const validation = validateRequirementDefinition(
      [{ id: "user", text: "Failed recovery preserves state without partial mutation." }],
      {
        action: "define",
        requirements: [
          {
            type: "constraint",
            text: "Failed recovery preserves state without partial mutation",
            acceptance_criterion: "State remains unchanged after failed recovery",
            source_prompt_indexes: [1],
          },
          {
            type: "workflow",
            text: "Recover with npm test when needed",
            acceptance_criterion: "npm test passes",
            source_prompt_indexes: [1],
          },
        ],
        ignored_source_prompts: [],
        ignored_source_clauses: [],
      },
    );

    expect(validation.diagnostics).toEqual([]);
  });

  it.each(["workflow", "verification"] as const)(
    "rejects a referenced high-risk invariant mislabeled as %s",
    (type) => {
      const validation = validateRequirementDefinition(
        [
          { id: "user", text: "Implement SPEC.md." },
          {
            id: "spec",
            kind: "referenced_file",
            path: "SPEC.md",
            text: "Failed recovery preserves state without partial mutation.",
          },
        ],
        {
          action: "define",
          requirements: [
            {
              type,
              text: "Failed recovery preserves state without partial mutation",
              acceptance_criterion: "State remains unchanged after failed recovery",
              source_clause_ids: ["S2-C1"],
            },
          ],
          ignored_source_prompts: [{ source_prompt_index: 1, reason: "Pure delegation to SPEC.md" }],
          ignored_source_clauses: [],
        },
      );

      expect(validation.diagnostics.join("\n")).toContain("must use behavior, constraint, or deliverable");
    },
  );

  it("keeps a high-risk deliverable inside the executable evidence gate", () => {
    expect(
      isHighRiskRequirement({
        id: "R1",
        type: "deliverable",
        text: "Persist a recovery manifest with integrity metadata",
        acceptanceCriterion: "The persisted manifest has a verified integrity hash",
        sourcePromptIndexes: [1],
      }),
    ).toBe(true);
  });

  it("accepts broad suite evidence for a test-execution workflow", async () => {
    const harness = createRequirementAuditHarness();
    await reachAuditEvidenceReady(harness);
    await nextModelTurn(harness);
    const definition = await callRequirementAudit(harness.controller, {
      action: "define",
      requirements: [
        {
          type: "workflow",
          text: "Run completion-gate tests after implementation and recover with the full test command when needed",
          acceptance_criterion:
            "The full test command runs after implementation with all completion-gate tests passing",
          source_prompt_indexes: [1],
        },
      ],
      ignored_source_prompts: [],
    });
    expect(definition).toContain("Defined 1 atomic requirement");
    expect(harness.controller.currentState.requirementAudit.requirements[0]?.highRisk).toBeUndefined();

    const broadSuite = auditEvidenceHandle(
      await recordAuditToolResult(
        harness.agent,
        "bash",
        { command: "npm test" },
        { text: "Test Files 1 passed (1) Tests 3 passed (3)" },
      ),
    );
    await nextModelTurn(harness);
    const verdict = await callRequirementAudit(harness.controller, {
      action: "verdict",
      verdicts: [
        {
          requirement_id: "R1",
          passed: true,
          reason: "The required post-implementation test command passed all completion-gate tests.",
          evidence_refs: [broadSuite],
        },
      ],
    });
    expect(verdict).toContain("Requirement audit passed: 1/1");
  });
});
