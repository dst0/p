import { describe, expect, it } from "vitest";
import { evidenceMatchesRequirement } from "../src/core/task-verification/taskverificationcontroller-methods/focused-evidence-relevance.ts";
import {
  auditEvidenceHandle,
  callRequirementAudit,
  createRequirementAuditHarness,
  nextModelTurn,
  reachAuditEvidenceReady,
  recordAuditToolResult,
} from "./task-requirement-audit-test-harness.ts";

interface RequirementDefinition {
  type: "behavior" | "constraint";
  text: string;
  acceptance_criterion: string;
  source_prompt_indexes: number[];
}

async function auditEvidence(requirement: RequirementDefinition, command: string): Promise<string> {
  const harness = createRequirementAuditHarness();
  await reachAuditEvidenceReady(harness);
  await nextModelTurn(harness);
  await callRequirementAudit(harness.controller, {
    action: "define",
    requirements: [requirement],
    ignored_source_prompts: [],
  });
  const evidenceRef = auditEvidenceHandle(
    await recordAuditToolResult(
      harness.agent,
      "bash",
      { command },
      { text: "Test Files 1 passed (1) Tests 1 passed (1)" },
    ),
  );
  await nextModelTurn(harness);
  return callRequirementAudit(harness.controller, {
    action: "verdict",
    verdicts: [
      {
        requirement_id: "R1",
        passed: true,
        reason: "The focused test is claimed as proof.",
        evidence_refs: [evidenceRef],
      },
    ],
  });
}

describe("focused high-risk evidence qualifiers", () => {
  it.each([
    {
      requirement: {
        type: "constraint" as const,
        text: "Authorization rejects completion tokens with invalid signatures",
        acceptance_criterion: "Authorization rejects an invalid completion-token signature",
        source_prompt_indexes: [1],
      },
      conflicting: "vitest --run test/authorization-rejects-valid-completion-token-signature.test.ts",
      matching: "vitest --run test/authorization-rejects-invalid-completion-token-signature.test.ts",
    },
    {
      requirement: {
        type: "constraint" as const,
        text: "Authorization rejects unauthorized completion tokens",
        acceptance_criterion: "An unauthorized completion token is rejected",
        source_prompt_indexes: [1],
      },
      conflicting: "vitest --run test/authorization-rejects-authorized-completion-token.test.ts",
      matching: "vitest --run test/authorization-rejects-unauthorized-completion-token.test.ts",
    },
    {
      requirement: {
        type: "constraint" as const,
        text: "Security rejects forged CSRF form tokens",
        acceptance_criterion: "A forged CSRF form token is rejected",
        source_prompt_indexes: [1],
      },
      conflicting: "vitest --run test/security-rejects-genuine-csrf-form-token.test.ts",
      matching: "vitest --run test/security-rejects-forged-csrf-form-token.test.ts",
    },
    {
      requirement: {
        type: "constraint" as const,
        text: "Authentication rejects a missing credential header",
        acceptance_criterion: "A missing authentication credential header is rejected",
        source_prompt_indexes: [1],
      },
      conflicting: "vitest --run test/authentication-rejects-present-credential-header.test.ts",
      matching: "vitest --run test/authentication-rejects-missing-credential-header.test.ts",
    },
    {
      requirement: {
        type: "constraint" as const,
        text: "Authorization rejects expired credentials",
        acceptance_criterion: "An expired authorization credential is rejected",
        source_prompt_indexes: [1],
      },
      conflicting: "vitest --run test/authorization-rejects-unexpired-credential.test.ts",
      matching: "vitest --run test/authorization-rejects-expired-credential.test.ts",
    },
  ])("rejects the opposite qualifier while accepting the required one: $matching", async (testCase) => {
    expect(await auditEvidence(testCase.requirement, testCase.conflicting)).toContain(
      "requires focused executable evidence",
    );
    expect(await auditEvidence(testCase.requirement, testCase.matching)).toContain("Requirement audit passed: 1/1");
  });

  it("interprets direct qualifier negation without substring matching", async () => {
    const requirement = {
      type: "constraint" as const,
      text: "Authorization rejects completion tokens with invalid signatures",
      acceptance_criterion: "Authorization rejects an invalid completion-token signature",
      source_prompt_indexes: [1],
    };
    expect(
      await auditEvidence(
        requirement,
        "vitest --run test/authorization-rejects-not-invalid-completion-token-signature.test.ts",
      ),
    ).toContain("requires focused executable evidence");
    expect(
      await auditEvidence(
        requirement,
        "vitest --run test/authorization-rejects-invalid-valid-completion-token-signature.test.ts",
      ),
    ).toContain("requires focused executable evidence");
    expect(
      await auditEvidence(
        requirement,
        "vitest --run test/authorization-rejects-not-valid-completion-token-signature.test.ts",
      ),
    ).toContain("Requirement audit passed: 1/1");
    expect(
      await auditEvidence(
        requirement,
        "vitest --run test/authorization-rejects-not-not-valid-completion-token-signature.test.ts",
      ),
    ).toContain("requires focused executable evidence");
    expect(
      await auditEvidence(
        requirement,
        "vitest --run test/authorization-rejects-never-not-valid-completion-token-signature.test.ts",
      ),
    ).toContain("requires focused executable evidence");
  });

  it.each([
    {
      requirement: {
        type: "constraint" as const,
        text: "Authorization rejects invalid and malformed completion-token signatures",
        acceptance_criterion: "An invalid and malformed completion-token signature is rejected",
        source_prompt_indexes: [1],
      },
      partial: "vitest --run test/authorization-rejects-invalid-completion-token-signature.test.ts",
      matching: "vitest --run test/authorization-rejects-invalid-malformed-completion-token-signature.test.ts",
      equivalent:
        "vitest --run test/authorization-rejects-not-valid-not-well-formed-completion-token-signature.test.ts",
    },
    {
      requirement: {
        type: "constraint" as const,
        text: "Authorization rejects unauthenticated and unauthorized completion-token requests",
        acceptance_criterion: "An unauthenticated and unauthorized completion-token request is rejected",
        source_prompt_indexes: [1],
      },
      partial: "vitest --run test/authorization-rejects-unauthenticated-completion-token-request.test.ts",
      matching: "vitest --run test/authorization-rejects-unauthenticated-unauthorized-completion-token-request.test.ts",
      equivalent:
        "vitest --run test/authorization-rejects-not-authenticated-not-authorized-completion-token-request.test.ts",
    },
    {
      requirement: {
        type: "constraint" as const,
        text: "Authentication rejects missing and omitted HTTP credential headers",
        acceptance_criterion: "A missing and omitted authentication HTTP credential header is rejected",
        source_prompt_indexes: [1],
      },
      partial: "vitest --run test/authentication-rejects-missing-http-credential-header.test.ts",
      matching: "vitest --run test/authentication-rejects-missing-omitted-http-credential-header.test.ts",
      equivalent: "vitest --run test/authentication-rejects-not-present-not-provided-http-credential-header.test.ts",
    },
  ])("requires every explicit same-polarity qualifier during selector matching: $matching", (testCase) => {
    const requirement = {
      id: "R1",
      type: testCase.requirement.type,
      text: testCase.requirement.text,
      acceptanceCriterion: testCase.requirement.acceptance_criterion,
      sourcePromptIndexes: testCase.requirement.source_prompt_indexes,
    };
    expect(evidenceMatchesRequirement(requirement, [testCase.partial])).toBe(false);
    expect(evidenceMatchesRequirement(requirement, [testCase.matching])).toBe(true);
    expect(evidenceMatchesRequirement(requirement, [testCase.equivalent])).toBe(true);
  });

  it("binds exactness to the metadata subject instead of accepting it elsewhere", () => {
    const requirement = {
      id: "R1",
      type: "constraint" as const,
      text: "Export starts with count metadata",
      acceptanceCriterion:
        'Export starts with exactly {"count":N} metadata and emits deterministic newline-terminated JSONL',
      sourcePromptIndexes: [1],
    };

    expect(evidenceMatchesRequirement(requirement, ["export count metadata with exact newline terminated jsonl"])).toBe(
      false,
    );
    expect(
      evidenceMatchesRequirement(requirement, [
        "export starts with count metadata and exactly one newline terminated jsonl",
      ]),
    ).toBe(false);
    expect(
      evidenceMatchesRequirement(requirement, [
        "export starts with exactly count only metadata and deterministic newline terminated jsonl",
      ]),
    ).toBe(true);
  });

  it("does not treat the purpose phrase in order to as an ordering qualifier", () => {
    const requirement = {
      id: "R1",
      type: "constraint" as const,
      text: "Retry requests in order to preserve durable state",
      acceptanceCriterion: "Retries preserve durable state",
      sourcePromptIndexes: [1],
    };

    expect(evidenceMatchesRequirement(requirement, ["retry preserves durable state"])).toBe(true);
  });

  it("requires a separate anchored selector occurrence for every exact constraint", () => {
    const requirement = {
      id: "R1",
      type: "constraint" as const,
      text: "Manifest export starts with exactly count metadata and ends with exactly one LF byte",
      acceptanceCriterion: "Both manifest artifact boundaries are enforced",
      sourcePromptIndexes: [1],
    };

    expect(
      evidenceMatchesRequirement(requirement, [
        "manifest export starts with exactly count metadata and ends with one lf byte",
      ]),
    ).toBe(false);
    expect(
      evidenceMatchesRequirement(requirement, [
        "manifest export starts with exactly count metadata and ends with exactly one lf byte",
      ]),
    ).toBe(true);

    expect(
      evidenceMatchesRequirement(
        {
          ...requirement,
          text: "Manifest export starts with exactly count metadata",
          acceptanceCriterion: "Manifest export starts with exactly count metadata",
        },
        ["manifest export starts with exactly count metadata"],
      ),
    ).toBe(true);
  });

  it("distinguishes purpose phrases and identifiers from ordering semantics", () => {
    const purposeRequirement = {
      id: "R1",
      type: "constraint" as const,
      text: "Retry requests in order for durable state to be preserved",
      acceptanceCriterion: "Retry preserves durable state",
      sourcePromptIndexes: [1],
    };
    const identifierRequirement = {
      id: "R2",
      type: "constraint" as const,
      text: "Persist the order ID",
      acceptanceCriterion: "The order ID remains persisted",
      sourcePromptIndexes: [1],
    };
    const orderingRequirement = {
      id: "R3",
      type: "constraint" as const,
      text: "Manifest records are preserved in order",
      acceptanceCriterion: "Manifest record order is preserved",
      sourcePromptIndexes: [1],
    };

    expect(evidenceMatchesRequirement(purposeRequirement, ["retry preserves durable state"])).toBe(true);
    expect(evidenceMatchesRequirement(identifierRequirement, ["persists order id"])).toBe(true);
    expect(evidenceMatchesRequirement(orderingRequirement, ["manifest records are preserved in sequence"])).toBe(true);
    expect(evidenceMatchesRequirement(orderingRequirement, ["ordered manifest records are preserved"])).toBe(true);
  });
});
