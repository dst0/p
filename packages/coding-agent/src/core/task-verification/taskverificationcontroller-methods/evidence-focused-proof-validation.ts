import { HIGH_RISK_REQUIREMENT_PATTERN } from "../constants.ts";
import { evidenceCriticalProofRequirement, evidenceCriticalProofSetHash } from "../evidence-critical-proof.ts";
import { classifyExactFileBytesAssertion } from "../exact-file-assertion-classifier.ts";
import { exactFileAssertionProvesCriterion } from "../exact-file-criterion-matcher.ts";
import { selectorsMatchProofPolicies } from "../requirement-proof-evidence.ts";
import { evidenceHasProofWitnesses } from "../requirement-proof-witnesses.ts";
import { inferTaskKind } from "../task-kind-inference.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool } from "../tool-classification.ts";
import type { TaskRequirement, TaskVerificationAcceptanceCheck, TaskVerificationEvidence } from "../types.ts";
import { criterionCoversCriticalProof } from "./completion-checklist.ts";
import { evidenceMatchesRequirement } from "./focused-evidence-relevance.ts";
import { focusedTestSelectors } from "./focused-requirement-evidence.ts";
import { evidenceHasPositivePassingTestResult } from "./test-evidence-outcome.ts";

export function validateCriticalProofEvidence(
  self: TaskVerificationController,
  checks: readonly TaskVerificationAcceptanceCheck[],
  evidence: ReadonlyMap<string, TaskVerificationEvidence>,
): string | undefined {
  const proofSetHash = evidenceCriticalProofSetHash(self.state.criticalProofObligations ?? []);
  for (const obligation of self.state.criticalProofObligations ?? []) {
    const requirement = evidenceCriticalProofRequirement(obligation);
    const check = checks.find((candidate) => criterionCoversCriticalProof(candidate.criterion, obligation));
    const focused = check?.evidenceRefs.some((ref) => {
      const item = evidence.get(ref);
      if (!item || !isShellTool(item.toolName) || !evidenceHasPositivePassingTestResult(item)) return false;
      const selectors = focusedTestSelectors(item.descriptor);
      return (
        selectors !== undefined &&
        evidenceMatchesRequirement(requirement, selectors) &&
        selectorsMatchProofPolicies(requirement, selectors) &&
        evidenceHasProofWitnesses(item, requirement, proofSetHash)
      );
    });
    if (!focused) {
      return `The ${obligation.artifactDomain} terminal-byte boundary from ${obligation.sourcePath} requires one focused passing case plus its valid same-run P_PROOF_V1 exact-byte witness; a broad suite or selector wording alone cannot prove it.`;
    }
  }
  return undefined;
}

export function validateHighRiskChecklistEvidence(
  self: TaskVerificationController,
  checks: readonly TaskVerificationAcceptanceCheck[],
  evidence: ReadonlyMap<string, TaskVerificationEvidence>,
): string | undefined {
  const taskKind = inferTaskKind(self.taskText());
  if (taskKind === "docs" || taskKind === "investigation") return undefined;
  for (const [index, check] of checks.entries()) {
    if (!HIGH_RISK_REQUIREMENT_PATTERN.test(check.criterion)) continue;
    const requirement = checklistRequirement(index, check.criterion);
    const focused = check.evidenceRefs.some((ref) => {
      const item = evidence.get(ref);
      if (!item || !isShellTool(item.toolName)) return false;
      const exactArtifact = classifyExactFileBytesAssertion({
        cwd: self.sessionManager.getCwd(),
        taskOwnedPaths: self.state.taskOwnedPaths ?? [],
        descriptor: item.descriptor,
        isError: item.isError,
      });
      if (exactArtifact && exactFileAssertionProvesCriterion(check.criterion, exactArtifact)) {
        return true;
      }
      if (!evidenceHasPositivePassingTestResult(item)) return false;
      const selectors = focusedTestSelectors(item.descriptor);
      return selectors !== undefined && evidenceMatchesRequirement(requirement, selectors);
    });
    if (!focused) {
      return `High-risk checklist item "${check.criterion}" requires a relevant focused passing test or, for an exact non-source artifact, a controller-verified literal-byte assertion such as diff <(printf 'expected\\n') task-owned/path; a generic suite or unrelated selector cannot prove this invariant.`;
    }
  }
  return undefined;
}

function checklistRequirement(index: number, criterion: string): TaskRequirement {
  return {
    id: `evidence-check-${index + 1}`,
    type: "behavior",
    text: criterion,
    acceptanceCriterion: criterion,
    sourcePromptIndexes: [1],
    highRisk: true,
  };
}
