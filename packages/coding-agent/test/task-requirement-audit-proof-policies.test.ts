import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { computeRequirementSetHash } from "../src/core/task-verification/requirement-audit-hashing.ts";
import { sourceClauseConceptCoverageError } from "../src/core/task-verification/requirement-clause-semantics.ts";
import { deriveRequirementProofPolicies } from "../src/core/task-verification/requirement-derived-boundaries.ts";
import { selectorsMatchProofPolicies } from "../src/core/task-verification/requirement-proof-evidence.ts";
import { collectProofWitnesses } from "../src/core/task-verification/requirement-proof-witnesses.ts";
import { requirementSourceClauses } from "../src/core/task-verification/requirement-source-clauses.ts";
import { isFocusedEvidence } from "../src/core/task-verification/taskverificationcontroller-methods/focused-requirement-evidence.ts";
import type {
  TaskRequirement,
  TaskVerificationEvidence,
  TaskVerificationSourcePrompt,
} from "../src/core/task-verification/types.ts";
import { createRequirementAuditHarness } from "./task-requirement-audit-test-harness.ts";

const sources: TaskVerificationSourcePrompt[] = [
  { id: "user", text: "Implement SPEC.md." },
  {
    id: "spec",
    kind: "referenced_file",
    path: "SPEC.md",
    text: [
      "Export the log as deterministic newline-terminated JSONL.",
      "Any log truncation must throw ValidationError.",
    ].join("\n"),
  },
];

describe("controller-derived requirement proof policies", () => {
  it("attaches exact final-byte proof to a complete universal truncation requirement", () => {
    const result = deriveRequirementProofPolicies(sources, [serializationRequirement(), truncationRequirement()]);

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[1]?.proofPolicies).toContain("remove_exact_final_byte");
  });

  it("derives changed-artifact proof from a mapped direct tampering prompt", () => {
    const result = deriveRequirementProofPolicies(
      [{ id: "user", kind: "user_prompt", text: "Reject corruption or tampering that changes persisted bytes." }],
      [
        {
          id: "R1",
          type: "constraint",
          text: "Reject a tampered persisted artifact",
          acceptanceCriterion: "A changed artifact byte is rejected",
          sourcePromptIndexes: [1],
        },
      ],
    );

    expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("change_artifact_bytes");
  });

  it("rejects a narrowed truncation requirement that omits the exact terminal boundary", () => {
    const narrowed = {
      ...truncationRequirement(),
      text: "A malformed truncated event line is rejected",
      acceptanceCriterion: "One truncated event line throws ValidationError",
    };

    expect(deriveRequirementProofPolicies(sources, [serializationRequirement(), narrowed])).toMatch(
      /exact final[- ]byte removal.*terminal newline/iu,
    );
  });

  it("requires focused evidence selectors to name the derived boundary", () => {
    const requirement = {
      ...truncationRequirement(),
      proofPolicies: ["remove_exact_final_byte" as const],
    };
    expect(selectorsMatchProofPolicies(requirement, ["fromLog rejects truncated log"])).toBe(false);
    expect(
      selectorsMatchProofPolicies(requirement, [
        "fromLog rejects truncation after removing exact final byte terminal newline",
      ]),
    ).toBe(true);
  });

  it("requires a validated runtime relationship in addition to an exact selector", () => {
    const requirement = {
      ...truncationRequirement(),
      proofPolicies: ["remove_exact_final_byte" as const],
    };
    const controller = createRequirementAuditHarness().controller;
    controller.state.requirementAudit = {
      ...controller.state.requirementAudit,
      requirements: [requirement],
      requirementSetHash: "proof-set",
    };
    const selector = "fromLog rejects any truncation after removing exact final byte terminal newline";
    expect(isFocusedEvidence(controller, evidence(selector), requirement)).toBe(false);

    const proofWitnesses = witnesses(requirement, "remove_exact_final_byte", {
      originalBase64: Buffer.from("event\n").toString("base64"),
      candidateBase64: Buffer.from("event").toString("base64"),
      outcome: "threw",
    });
    expect(isFocusedEvidence(controller, evidence(selector, proofWitnesses), requirement)).toBe(true);
  });

  it.each([
    ["unchanged", "event\n"],
    ["two-byte suffix", "even"],
    ["interior change", "evXnt"],
  ])("rejects a %s terminal-byte witness", (_name, candidate) => {
    const requirement = {
      ...truncationRequirement(),
      proofPolicies: ["remove_exact_final_byte" as const],
    };
    expect(
      witnesses(requirement, "remove_exact_final_byte", {
        originalBase64: Buffer.from("event\n").toString("base64"),
        candidateBase64: Buffer.from(candidate).toString("base64"),
        outcome: "threw",
      }),
    ).toBeUndefined();
  });

  it("rejects an exact suffix witness when the removed final byte is not LF", () => {
    const requirement = {
      ...truncationRequirement(),
      proofPolicies: ["remove_exact_final_byte" as const],
    };
    expect(
      witnesses(requirement, "remove_exact_final_byte", {
        originalBase64: Buffer.from("event}").toString("base64"),
        candidateBase64: Buffer.from("event").toString("base64"),
        outcome: "threw",
      }),
    ).toBeUndefined();
  });

  it("derives rollback proof from mapped source semantics when the atomic requirement is concise", () => {
    const rollbackSources: TaskVerificationSourcePrompt[] = [
      {
        id: "spec",
        kind: "referenced_file",
        text: "Failed batches are all-or-nothing: restore state without partial mutation.",
      },
    ];
    const requirement: TaskRequirement = {
      id: "R1",
      type: "constraint",
      text: "Batch state matches its pre-batch snapshot",
      acceptanceCriterion: "State equals the snapshot captured before the batch",
      sourcePromptIndexes: [1],
      sourceClauseIds: ["S1-C1"],
    };
    const result = deriveRequirementProofPolicies(rollbackSources, [requirement]);

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("preserve_state_on_failure");
  });

  it("treats source-level all-or-nothing atomicity as failure-preservation semantics", () => {
    const rollbackSources: TaskVerificationSourcePrompt[] = [
      {
        id: "spec",
        kind: "referenced_file",
        text: "A batch is atomic: either all commands commit or no observable state changes.",
      },
    ];
    const requirement: TaskRequirement = {
      id: "R1",
      type: "constraint",
      text: "Batch state matches its pre-batch snapshot",
      acceptanceCriterion: "State equals the snapshot captured before the batch",
      sourcePromptIndexes: [1],
      sourceClauseIds: ["S1-C1"],
    };
    const result = deriveRequirementProofPolicies(rollbackSources, [requirement]);

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toContain("preserve_state_on_failure");
  });

  it("does not derive a terminal-byte obligation from a superseded source clause", () => {
    const result = deriveRequirementProofPolicies(sources, [serializationRequirement()], new Set(["S2-C2"]));

    expect(typeof result).not.toBe("string");
    expect((result as TaskRequirement[])[0]?.proofPolicies).toBeUndefined();
  });

  it("requires every high-risk concept in a broad normative clause to survive its split requirements", () => {
    const clause = requirementSourceClauses([
      {
        id: "spec",
        kind: "referenced_file",
        text: "fromLog validates positions, stream versions, every hash link, the manifest, and command-ID consistency.",
      },
    ])[0]!;

    expect(sourceClauseConceptCoverageError(clause, ["fromLog rejects non-sequential positions"])).toContain(
      "uncovered normative concepts: command ID, version, hash, manifest",
    );
  });

  it("preserves the legacy requirement-set hash shape when no source clauses are ignored", () => {
    const requirement = serializationRequirement();
    const legacyPayload = {
      requirements: [
        {
          id: requirement.id,
          type: requirement.type,
          text: requirement.text,
          acceptanceCriterion: requirement.acceptanceCriterion,
          sourcePromptIndexes: requirement.sourcePromptIndexes,
          sourceClauseIds: requirement.sourceClauseIds,
          highRisk: requirement.highRisk,
          highRiskSourcePromptIndexes: requirement.highRiskSourcePromptIndexes,
        },
      ],
      ignoredSourcePrompts: [],
    };
    const expected = createHash("sha256").update(JSON.stringify(legacyPayload)).digest("hex");

    expect(computeRequirementSetHash([requirement], [], [])).toBe(expected);
  });
});

function serializationRequirement(): TaskRequirement {
  return {
    id: "R1",
    type: "behavior",
    text: "Export deterministic newline-terminated JSONL",
    acceptanceCriterion: "The exported log is deterministic JSONL ending in a terminal newline",
    sourcePromptIndexes: [2],
    sourceClauseIds: ["S2-C1"],
  };
}

function truncationRequirement(): TaskRequirement {
  return {
    id: "R2",
    type: "constraint",
    text: "Reject any log truncation including exact final-byte removal",
    acceptanceCriterion: "Removing the exact terminal newline final byte is rejected as one case of any truncation",
    sourcePromptIndexes: [2],
    sourceClauseIds: ["S2-C2"],
  };
}

function evidence(
  selector: string,
  proofWitnesses?: TaskVerificationEvidence["proofWitnesses"],
): TaskVerificationEvidence {
  return {
    version: 2,
    taskId: "task",
    ref: "verification-evidence-1",
    toolCallId: "bash-1",
    toolName: "bash",
    descriptor: `node --test --test-name-pattern="${selector}" test/integrity.test.ts`,
    outputSummary: "Tests 1 passed\nTests 0 failed",
    ...(proofWitnesses ? { proofWitnesses } : {}),
    isError: false,
    mutationRevision: 0,
    timestamp: "2026-08-23T00:00:00.000Z",
  };
}

function witnesses(
  requirement: TaskRequirement,
  policy: NonNullable<TaskRequirement["proofPolicies"]>[number],
  facts: Record<string, unknown>,
): TaskVerificationEvidence["proofWitnesses"] {
  return collectProofWitnesses(
    [
      {
        type: "text",
        text: `P_PROOF_V1 ${JSON.stringify({ requirementId: requirement.id, policy, facts })}`,
      },
    ],
    [requirement],
    "proof-set",
    0,
  );
}
