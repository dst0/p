import { createHash } from "node:crypto";
import {
  formatFocusedSelectorExample,
  formatRequirementProofWitnessTemplates,
} from "./taskverificationcontroller-methods/requirement-audit-prompt.ts";
import type { TaskRequirement, TaskVerificationCriticalProofObligation } from "./types.ts";

export const MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS = 4;

export function createExactFinalByteObligation(
  sourcePath: string,
  sourceSha256: string,
  artifactDomain: string,
): TaskVerificationCriticalProofObligation {
  return {
    id: `evidence-boundary-${hashJson({ sourcePath, sourceSha256, artifactDomain }).slice(0, 16)}`,
    policy: "remove_exact_final_byte",
    sourcePath,
    sourceSha256,
    artifactDomain,
  };
}

export function evidenceCriticalProofRequirement(obligation: TaskVerificationCriticalProofObligation): TaskRequirement {
  const artifact = `${obligation.artifactDomain} artifact from ${obligation.sourcePath}`;
  return {
    id: obligation.id,
    type: "behavior",
    text: `Reject exact final-byte truncation of the newline-terminated ${artifact}`,
    acceptanceCriterion: `Exact final-byte truncation is rejected: removing only its final LF byte from the ${artifact} throws instead of restoring`,
    sourcePromptIndexes: [1],
    highRisk: true,
    proofPolicies: [obligation.policy],
  };
}

export function evidenceCriticalProofSetHash(
  obligations: readonly TaskVerificationCriticalProofObligation[],
): string | undefined {
  return obligations.length > 0
    ? hashJson(
        [...obligations]
          .sort((left, right) => left.id.localeCompare(right.id))
          .map(({ id, policy, sourcePath, sourceSha256, artifactDomain }) => ({
            id,
            policy,
            sourcePath,
            sourceSha256,
            artifactDomain,
          })),
      )
    : undefined;
}

export function formatEvidenceCriticalProofGuidance(
  obligations: readonly TaskVerificationCriticalProofObligation[],
): string[] {
  if (obligations.length === 0) return [];
  return [
    "Bounded critical proof obligations:",
    ...obligations.flatMap((obligation) => {
      const requirement = evidenceCriticalProofRequirement(obligation);
      return [
        `- ${obligation.id}: ${requirement.acceptanceCriterion}`,
        `  Required exact focused case selector: ${formatFocusedSelectorExample(requirement)}`,
        `  Required same-test witness: ${formatRequirementProofWitnessTemplates(requirement)}`,
      ];
    }),
  ];
}

function hashJson(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}
