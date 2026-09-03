import { completionVerificationScope } from "../completion-verification-scope.ts";
import { HIGH_RISK_REQUIREMENT_PATTERN } from "../constants.ts";
import { evidenceCriticalProofRequirement, evidenceCriticalProofSetHash } from "../evidence-critical-proof.ts";
import { classifyExactFileBytesAssertion } from "../exact-file-assertion-classifier.ts";
import { exactFileAssertionProvesCriterion } from "../exact-file-criterion-matcher.ts";
import { selectorsMatchProofPolicies } from "../requirement-proof-evidence.ts";
import { evidenceHasProofWitnesses } from "../requirement-proof-witnesses.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool } from "../tool-classification.ts";
import type { TaskRequirement, TaskVerificationAcceptanceCheck, TaskVerificationEvidence } from "../types.ts";
import { criterionCoversCriticalProof } from "./completion-checklist.ts";
import { evidenceHasRecordedExternalEffect } from "./external-effect-receipt.ts";
import { evidenceMatchesRequirement } from "./focused-evidence-relevance.ts";
import { focusedTestSelectors } from "./focused-requirement-evidence.ts";
import { evidenceHasPositivePassingTestResult } from "./test-evidence-outcome.ts";

const CONTROLLER_PROOF_DEMAND_PATTERN = /\bcontroller[-\s]+required\s+proof\s+witness\b/iu;
const NEGATED_DIRECT_PROOF_ACTION_PATTERN =
  /\b(?:(?:do|does)\s+not\s+(?:have|need)\s+to|not\s+required\s+to|need\s+not)\s+(?:emit|produce|include|attach)\w*\b[^\n]{0,40}\bP_PROOF_V1\b/iu;
const DIRECT_MODAL_PROOF_ACTION_PATTERN =
  /\b(?:must|should|shall|(?:has|have|needs?)\s+to|required\s+to)\s+(?:(?:also|always|still|directly|successfully|exactly)\s+){0,3}(?:emit|produce|include|attach)\w*\b[^\n]{0,40}\bP_PROOF_V1\b/iu;
const NEGATED_REQUIRED_SUBJECT_PROOF_ACTION_PATTERN =
  /\b(?:(?:do|does|did|will|would|should|must|shall|may|might|can|could)\s+not|never)\s+require(?:s|d)?\s+(?:(?!(?:not|to)\b)[\p{L}\p{N}_-]+\s+){1,6}to\s+(?:emit|produce|include|attach)\w*\b[^\n]{0,40}\bP_PROOF_V1\b/iu;
const REQUIRED_SUBJECT_PROOF_ACTION_PATTERN =
  /\brequire(?:s|d)?\s+(?:(?!(?:not|to)\b)[\p{L}\p{N}_-]+\s+){1,6}to\s+(?:emit|produce|include|attach)\w*\b[^\n]{0,40}\bP_PROOF_V1\b/iu;
const IMPERATIVE_PROOF_ACTION_PATTERN = /^\s*(?:emit|produce|include|attach)\w*\s+(?:an?\s+)?P_PROOF_V1\b/iu;
const ENSURED_PASSIVE_PROOF_PATTERN =
  /\bensure(?:s|d)?(?:\s+that)?\s+(?:an?\s+)?P_PROOF_V1\b[^\n]{0,40}\bis\s+(?:emitted|produced|included|attached)\b/iu;
const TOKEN_MODAL_PROOF_PATTERN =
  /\bP_PROOF_V1\b[^\n]{0,40}\b(?:(?:must|should|shall|(?:has|have|needs?)\s+to)\s+be\s+(?:emitted|produced|included|attached)|witness\s+is\s+required)\b/iu;

export function validateCriticalProofEvidence(
  self: TaskVerificationController,
  checks: readonly TaskVerificationAcceptanceCheck[],
  evidence: ReadonlyMap<string, TaskVerificationEvidence>,
): string | undefined {
  if (completionVerificationScope(self.state.completionChecklist) !== "runtime_behavior") return undefined;
  const obligations = self.state.criticalProofObligations ?? [];
  const explicitProofRequested =
    hasExplicitControllerProofDemand(self.taskText()) ||
    checks.some((check) => hasExplicitControllerProofDemand(check.criterion));
  if (obligations.length === 0 && explicitProofRequested) {
    return "The task requires a controller proof witness, but no critical proof obligation is active. Re-read the explicitly referenced authoritative source so the controller can derive its bounded obligation and exact P_PROOF_V1 template before collecting evidence.";
  }
  const proofSetHash = evidenceCriticalProofSetHash(obligations);
  for (const obligation of obligations) {
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

function hasExplicitControllerProofDemand(text: string): boolean {
  return text.split(/[.!?\n;]+|\b(?:but|however|whereas)\b/iu).some((clause) => {
    if (CONTROLLER_PROOF_DEMAND_PATTERN.test(clause)) return true;
    if (NEGATED_DIRECT_PROOF_ACTION_PATTERN.test(clause)) return false;
    if (NEGATED_REQUIRED_SUBJECT_PROOF_ACTION_PATTERN.test(clause)) return false;
    return (
      DIRECT_MODAL_PROOF_ACTION_PATTERN.test(clause) ||
      REQUIRED_SUBJECT_PROOF_ACTION_PATTERN.test(clause) ||
      IMPERATIVE_PROOF_ACTION_PATTERN.test(clause) ||
      ENSURED_PASSIVE_PROOF_PATTERN.test(clause) ||
      TOKEN_MODAL_PROOF_PATTERN.test(clause)
    );
  });
}

export function validateHighRiskChecklistEvidence(
  self: TaskVerificationController,
  checks: readonly TaskVerificationAcceptanceCheck[],
  evidence: ReadonlyMap<string, TaskVerificationEvidence>,
): string | undefined {
  if (completionVerificationScope(self.state.completionChecklist) === "non_runtime_content") return undefined;
  for (const [index, check] of checks.entries()) {
    if (!HIGH_RISK_REQUIREMENT_PATTERN.test(check.criterion)) continue;
    if (
      check.evidenceRefs.some((ref) => {
        const item = evidence.get(ref);
        return item ? evidenceHasRecordedExternalEffect(self, item) : false;
      })
    ) {
      continue;
    }
    const requirement = checklistRequirement(index, check.criterion);
    let hasIncompleteFocusedSelector = false;
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
      if (selectors === undefined) return false;
      if (evidenceMatchesRequirement(requirement, selectors)) return true;
      hasIncompleteFocusedSelector = true;
      return false;
    });
    if (!focused) {
      if (hasIncompleteFocusedSelector) {
        return `The focused selector did not name the complete invariant for high-risk checklist item "${check.criterion}". Name one test case exactly ${JSON.stringify(suggestedFocusedCaseName(check.criterion))}, then run only that named case with the runner's test-name selector and reuse its fresh evidence. The guard still requires the selector itself to name the subject, boundary, behavior, and qualifiers.`;
      }
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

function suggestedFocusedCaseName(criterion: string): string {
  return criterion
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}\s]+/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();
}
