import { describe, expect, it } from "vitest";
import { sourceIdentitiesAreUnique } from "../src/core/task-verification/requirement-source-state-validation.ts";
import { isMutatedSourcePaths } from "../src/core/task-verification/source-path-state.ts";
import { emptyState } from "../src/core/task-verification/state-factories.ts";
import { isTaskVerificationState } from "../src/core/task-verification/state-validation.ts";
import type { TaskRequirement, TaskVerificationState } from "../src/core/task-verification/types.ts";

describe("restored task-verification state validation", () => {
  it("preserves well-shaped ignored source-prompt metadata", () => {
    const state = emptyState("validation-task");
    state.requirementAudit.ignoredSourcePrompts = [{ sourcePromptIndex: 1, reason: "Non-requirement context." }];
    expect(isTaskVerificationState(state)).toBe(true);
    expect(
      isTaskVerificationState({
        ...state,
        completionChecklist: { ...state.completionChecklist, verificationScope: "unknown" },
      }),
    ).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        completionChecklist: { ...state.completionChecklist, verificationScope: "non_runtime_content" },
      }),
    ).toBe(false);
  });

  it("rejects malformed nested final and readiness collections", () => {
    const state = emptyState("validation-task");
    expect(isTaskVerificationState({ ...state, final: { ...state.final, unresolvedFailures: "not-an-array" } })).toBe(
      false,
    );
    expect(
      isTaskVerificationState({ ...state, readiness: { ...state.readiness, acceptanceChecks: "not-an-array" } }),
    ).toBe(false);
  });

  it("rejects malformed persisted source-size tracking", () => {
    const state = emptyState("validation-task");
    expect(isTaskVerificationState({ ...state, mutatedSourcePaths: ["../outside.ts"] })).toBe(false);
    expect(isTaskVerificationState({ ...state, mutatedSourcePathOverflow: "yes" })).toBe(false);
  });

  it("accepts only the current pre-mutation requirement-definition policy marker", () => {
    const state = emptyState("validation-task");
    expect(isTaskVerificationState({ ...state, requirementDefinitionPolicy: 1 })).toBe(true);
    expect(isTaskVerificationState({ ...state, requirementDefinitionPolicy: 2 })).toBe(false);
  });

  it("rejects evidence readiness without acceptance evidence", () => {
    const state = emptyState("validation-task");
    expect(
      isTaskVerificationState({
        ...state,
        readiness: {
          status: "evidence_ready",
          acceptanceChecks: [],
          verifiedMutationRevision: 1,
          userRequirementsHash: "requirements-hash",
        },
      }),
    ).toBe(false);
  });

  it.each(["id", "path", "snapshotEntryId"] as const)(
    "rejects duplicate requirement-source %s identities",
    (property) => {
      const state = emptyState("validation-task");
      const first = requirementSourceRef("source-1", "README.md", "snapshot-1");
      const second = requirementSourceRef("source-2", "SPEC.md", "snapshot-2");
      second[property] = first[property];
      state.requirementSourceRefs = [first, second];

      expect(isTaskVerificationState(state)).toBe(false);
    },
  );

  it("rejects overlap between frozen and ignored requirement-source paths", () => {
    const state = emptyState("validation-task");
    state.requirementSourceRefs = [requirementSourceRef("source-1", "README.md", "snapshot-1")];
    state.ignoredRequirementSources = [{ path: "README.md", reason: "Conflicting persisted classification." }];

    expect(isTaskVerificationState(state)).toBe(false);
  });

  it("requires every frozen source to have an in-range prompt anchor", () => {
    const state = emptyState("validation-task");
    state.taskPrompts = [{ id: "user-1", text: "Implement README.md." }];
    const reference = requirementSourceRef("source-1", "README.md", "snapshot-1");
    state.requirementSourceRefs = [reference];
    expect(isTaskVerificationState(state)).toBe(true);
    expect(
      isTaskVerificationState({ ...state, requirementSourceRefs: [{ ...reference, definitionSourcePromptCount: 0 }] }),
    ).toBe(false);
    expect(
      isTaskVerificationState({ ...state, requirementSourceRefs: [{ ...reference, definitionSourcePromptCount: 2 }] }),
    ).toBe(false);
    const { definitionSourcePromptCount: _missing, ...legacyReference } = reference;
    expect(isTaskVerificationState({ ...state, requirementSourceRefs: [legacyReference] })).toBe(false);
  });

  it("rejects a malformed requirement-source deauthorization prompt identity", () => {
    const state = emptyState("validation-task");
    state.ignoredRequirementSources = [
      { path: "notes.md", reason: "Directly deauthorized by the user.", deauthorizedByPromptId: 42 as never },
    ];

    expect(isTaskVerificationState(state)).toBe(false);
  });

  it.each([
    null,
    {
      sourceClauseId: "S1-C1",
      classification: "superseded",
      reason: "A later prompt supersedes this clause.",
      supersededBySourcePromptIndex: 0,
    },
    {
      sourceClauseId: "S1-C1",
      classification: "informational",
      reason: "Background context.",
      supersededBySourcePromptIndex: 1,
    },
  ])("rejects malformed persisted ignored-clause metadata %#", (ignoredClause) => {
    const state = emptyState("validation-task");
    state.requirementAudit.ignoredSourceClauses = [ignoredClause] as never;

    expect(isTaskVerificationState(state)).toBe(false);
  });

  it("rejects a malformed ignored-clause collection at the audit boundary", () => {
    const state = emptyState("validation-task");
    state.requirementAudit.ignoredSourceClauses = "not-an-array" as never;

    expect(isTaskVerificationState(state)).toBe(false);
  });

  it("accepts internally consistent passed and failed terminal audits", () => {
    const passed = terminalState("passed", true);
    const failed = terminalState("failed", false);

    expect(isTaskVerificationState(passed)).toBe(true);
    expect(isTaskVerificationState(failed)).toBe(true);
  });

  it("rejects terminal audits without a complete verdict set", () => {
    const state = terminalState("failed", false);
    delete state.requirementAudit.requirements[0]!.verdict;

    expect(isTaskVerificationState(state)).toBe(false);
  });

  it("requires canonical current-epoch checklists and bounded critical proof identities", () => {
    const state = emptyState("validation-task", "evidence");
    state.taskPrompts = [
      { id: "user-1", text: "Implement the event log." },
      { id: "user-2", text: "Also reject terminal-byte truncation." },
    ];
    state.completionChecklist = {
      version: 1,
      criteria: ["JSONL import rejects exact final-byte truncation"],
      sourcePromptIds: ["user-1", "user-2"],
      createdAtMutationRevision: 0,
    };
    state.criticalProofObligations = [
      {
        id: "evidence-boundary-1",
        policy: "remove_exact_final_byte",
        sourcePath: "SPEC.md",
        sourceSha256: "a".repeat(64),
        artifactDomain: "event-log",
      },
    ];
    expect(isTaskVerificationState(state)).toBe(true);
    expect(
      isTaskVerificationState({
        ...state,
        completionChecklist: { ...state.completionChecklist, sourcePromptIds: ["user-1"] },
      }),
    ).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        completionChecklist: { ...state.completionChecklist, criteria: ["All tests pass"] },
      }),
    ).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofObligations: [
          ...state.criticalProofObligations,
          { ...state.criticalProofObligations[0]!, id: "duplicate-path-domain" },
        ],
      }),
    ).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofObligations: [{ ...state.criticalProofObligations[0]!, sourceSha256: "BAD" }],
      }),
    ).toBe(false);
  });

  it("accepts only bounded canonical critical-proof discovery failures", () => {
    const state = emptyState("validation-task", "evidence");
    state.criticalProofDiscoveryFailures = [
      { sourcePath: "SPEC.md", reason: "Requirement source uses a symlink: SPEC.md" },
    ];
    expect(isTaskVerificationState(state)).toBe(true);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofDiscoveryFailures: [
          ...state.criticalProofDiscoveryFailures,
          { sourcePath: "SPEC.md", reason: "duplicate" },
        ],
      }),
    ).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofDiscoveryFailures: [{ sourcePath: "../SPEC.md", reason: "outside" }],
      }),
    ).toBe(false);
    expect(
      isTaskVerificationState({
        ...state,
        criticalProofDiscoveryFailures: [{ sourcePath: "SPEC.md", reason: "x".repeat(501) }],
      }),
    ).toBe(false);
  });

  it("validates source-identity overlap and mutated-path container shape directly", () => {
    expect(
      sourceIdentitiesAreUnique(
        [requirementSourceRef("source-1", "README.md", "snapshot-1")],
        [{ path: "README.md", reason: "Conflicting classification." }],
      ),
    ).toBe(false);
    expect(sourceIdentitiesAreUnique([], [{ path: "notes.md", reason: "User marked it as background." }])).toBe(true);
    expect(isMutatedSourcePaths("src/index.ts")).toBe(false);
  });
});

function terminalState(status: "failed" | "passed", passed: boolean): TaskVerificationState {
  const state = emptyState("validation-task");
  state.requirementAudit = {
    status,
    requirements: [requirement(passed)],
    ignoredSourcePrompts: [],
    nextRequirementIndex: 1,
    userRequirementsHash: "user-requirements",
    requirementSetHash: "requirement-set",
    verifiedMutationRevision: 0,
  };
  return state;
}

function requirement(passed: boolean): TaskRequirement {
  return {
    id: "R1",
    type: "behavior",
    text: "Preserve deterministic output",
    acceptanceCriterion: "Repeated execution produces identical output",
    sourcePromptIndexes: [1],
    verdict: {
      passed,
      reason: passed ? "Focused evidence passed." : "Focused evidence failed.",
      evidenceRefs: ["evidence-1"],
      mutationRevision: 0,
    },
  };
}

function requirementSourceRef(id: string, path: string, snapshotEntryId: string) {
  return {
    id,
    path,
    sha256: "a".repeat(64),
    byteLength: 12,
    snapshotEntryId,
    referencedByPromptIds: ["user-1"],
    definitionSourcePromptCount: 1,
    capturedAtMutationRevision: 0,
    origin: "requirement_audit.prepare_definition" as const,
    policyVersion: 1 as const,
  };
}
