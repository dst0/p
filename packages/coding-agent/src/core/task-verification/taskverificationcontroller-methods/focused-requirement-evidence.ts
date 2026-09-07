import { evidenceCriticalProofSetHash } from "../evidence-critical-proof.ts";
import { selectorsMatchProofPolicies } from "../requirement-proof-evidence.ts";
import { evidenceHasProofWitnesses } from "../requirement-proof-witnesses.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool } from "../tool-classification.ts";
import type { TaskRequirement, TaskVerificationEvidence } from "../types.ts";
import { evidenceMatchesRequirement } from "./focused-evidence-relevance.ts";
import { focusedTestInvocation } from "./test-command-invocation.ts";
import { evidenceHasPositivePassingTestResult } from "./test-evidence-outcome.ts";
import { focusedRequirementSelectors } from "./test-invocation-selection.ts";

export function isFocusedEvidence(
  self: TaskVerificationController,
  evidence: TaskVerificationEvidence,
  requirement: TaskRequirement,
): boolean {
  if (evidence.isError || !isShellTool(evidence.toolName)) return false;
  const selectors = focusedTestSelectors(evidence.descriptor);
  const proofSetHash =
    self.mode === "evidence"
      ? evidenceCriticalProofSetHash(self.state.criticalProofObligations ?? [])
      : self.state.requirementAudit.requirementSetHash;
  return (
    selectors !== undefined &&
    evidenceMatchesRequirement(requirement, selectors) &&
    selectorsMatchProofPolicies(requirement, selectors) &&
    evidenceHasProofWitnesses(evidence, requirement, proofSetHash) &&
    evidenceHasPositivePassingTestResult(evidence)
  );
}

export function focusedTestSelectors(command: string, depth = 0): string[] | undefined {
  const invocation = focusedTestInvocation(command, depth);
  return invocation === undefined ? undefined : focusedRequirementSelectors(invocation);
}
