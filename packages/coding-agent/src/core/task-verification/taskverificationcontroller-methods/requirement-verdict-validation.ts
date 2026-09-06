import { evidenceHasProofWitnesses } from "../requirement-proof-witnesses.ts";
import { isHighRiskText, isProductInvariantRequirementType } from "../requirement-risk.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { normalizeStrings, normalizeText } from "../tool-classification.ts";
import type { TaskRequirement, TaskRequirementVerdict, TaskVerificationEvidence } from "../types.ts";
import { isFocusedEvidence } from "./focused-requirement-evidence.ts";
import { formatFocusedSelectorContract, formatRequirementProofWitnessTemplates } from "./requirement-audit-prompt.ts";

interface SubmittedRequirementVerdict {
  passed: boolean;
  reason: string;
  evidence_refs?: string[];
}

export { isFocusedEvidence } from "./focused-requirement-evidence.ts";

export function validateRequirementVerdict(
  self: TaskVerificationController,
  requirement: TaskRequirement,
  input: SubmittedRequirementVerdict,
): TaskRequirementVerdict | string {
  if (typeof input.passed !== "boolean") return `${requirement.id}: verdict requires passed: true or false.`;
  const reason = normalizeText(input.reason);
  if (!reason) return `${requirement.id}: verdict requires a concrete reason for both passed and failed outcomes.`;
  const evidenceRefs = normalizeStrings(input.evidence_refs);
  if (input.passed && evidenceRefs.length === 0) {
    return `${requirement.id}: a passed verdict requires at least one evidence_refs handle.`;
  }
  const evidence = resolveOptionalEvidence(self, requirement.id, evidenceRefs);
  if (typeof evidence === "string") return evidence;
  if (evidence.some((item) => item.mutationRevision !== self.state.mutationRevision)) {
    return `${requirement.id}: verdict evidence must come from mutation revision ${self.state.mutationRevision}.`;
  }
  if (input.passed && evidence.some((item) => item.isError)) {
    return `${requirement.id}: failed evidence cannot support a passed requirement verdict.`;
  }
  if (
    input.passed &&
    isProductInvariantRequirementType(requirement.type) &&
    requirement.proofPolicies?.length &&
    !evidence.some((item) =>
      evidenceHasProofWitnesses(item, requirement, self.state.requirementAudit.requirementSetHash),
    )
  ) {
    return [
      `${requirement.id} requires valid P_PROOF_V1 runtime witnesses for: ${requirement.proofPolicies.join(", ")}.`,
      formatFocusedSelectorContract(requirement),
      "Add each witness emission inside the exact named focused test case, then rerun with a selector satisfying this contract.",
      "A standalone proof script or separate command is invalid.",
      `Required witness lines:\n${formatRequirementProofWitnessTemplates(requirement)}`,
    ].join(" ");
  }
  if (
    input.passed &&
    isHighRiskRequirement(requirement) &&
    !evidence.some((item) => isFocusedEvidence(self, item, requirement))
  ) {
    return `${requirement.id} requires focused executable evidence that ran and matches this high-risk invariant; a generic or unrelated test is insufficient. ${formatFocusedSelectorContract(requirement)} Run only that full case name with the test runner's case selector (for example, --test-name-pattern="..." or -t "..."), then resubmit the complete verdict batch.`;
  }
  return { passed: input.passed, reason, evidenceRefs, mutationRevision: self.state.mutationRevision };
}

function resolveOptionalEvidence(
  self: TaskVerificationController,
  requirementId: string,
  evidenceRefs: readonly string[],
): TaskVerificationEvidence[] | string {
  if (evidenceRefs.length === 0) return [];
  const evidence = self.resolveEvidence(evidenceRefs);
  return typeof evidence === "string" ? `${requirementId}: ${evidence}` : evidence;
}

export function isHighRiskRequirement(requirement: TaskRequirement): boolean {
  if (!isProductInvariantRequirementType(requirement.type)) return false;
  const text = `${requirement.text}\n${requirement.acceptanceCriterion}`;
  return requirement.highRisk === true || isHighRiskText(text);
}
