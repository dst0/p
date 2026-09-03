import {
  type CriticalProofSourceSelectionCandidate,
  recomputeCriticalProofSelections,
} from "./critical-proof-selection-recompute.ts";
import { MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS } from "./evidence-critical-proof.ts";
import {
  activeRequirementSourceCandidateCatalog,
  normalizeRequirementSourcePath,
  type RequirementSourceCandidate,
} from "./referenced-requirement-sources.ts";
import {
  isAuthoritativeRequirementSourceCandidate,
  latestRequirementSourceDeauthorization,
} from "./requirement-source-authority.ts";
import type { TaskVerificationController } from "./taskverificationcontroller.ts";
import type {
  TaskVerificationCriticalProofDiscoveryFailure,
  TaskVerificationCriticalProofObligation,
  TaskVerificationCriticalProofSourceSelection,
  TaskVerificationSourcePrompt,
} from "./types.ts";

export interface ReconciledCriticalProofState {
  obligations: TaskVerificationCriticalProofObligation[];
  overflow: boolean | undefined;
  failures: TaskVerificationCriticalProofDiscoveryFailure[] | undefined;
  selections: TaskVerificationCriticalProofSourceSelection[] | undefined;
}

export function reconcileCriticalProofAfterPrompt(
  self: TaskVerificationController,
  prompts: readonly TaskVerificationSourcePrompt[],
): ReconciledCriticalProofState {
  const selections = (self.state.criticalProofSourceSelections ?? []).filter((selection) =>
    sourceRemainsAuthorized(self, prompts, selection.sourcePath),
  );
  const catalog = activeRequirementSourceCandidateCatalog(prompts, self.state.criticalProofDeauthorizedSourcePaths);
  const candidates = catalog.candidates.filter(
    (candidate) =>
      isAuthoritativeRequirementSourceCandidate(prompts, candidate) &&
      sourceRemainsAuthorized(self, prompts, candidate.path) &&
      !taskOwnsPath(self, candidate.path),
  );
  addCandidateSelections(selections, candidates);
  const recomputed = recomputeCriticalProofSelections(
    self.sessionManager.getCwd(),
    selections,
    self.state.criticalProofSourceOutputs,
  );
  return boundedResult(recomputed.obligations, recomputed.failures, recomputed.selections, catalog.overflow);
}

function boundedResult(
  obligations: TaskVerificationCriticalProofObligation[],
  failures: TaskVerificationCriticalProofDiscoveryFailure[],
  selections: TaskVerificationCriticalProofSourceSelection[],
  candidateOverflow: boolean,
): ReconciledCriticalProofState {
  const boundedSelections = selections.slice(0, 8);
  const overflow = candidateOverflow || obligations.length > MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS;
  return {
    obligations: obligations.slice(0, MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS),
    overflow: overflow || undefined,
    failures: failures.length > 0 ? failures : undefined,
    selections: boundedSelections.length > 0 ? boundedSelections : undefined,
  };
}

function sourceRemainsAuthorized(
  self: TaskVerificationController,
  prompts: readonly TaskVerificationSourcePrompt[],
  sourcePath: string,
): boolean {
  return (
    !(self.state.criticalProofDeauthorizedSourcePaths ?? []).includes(sourcePath) &&
    !latestRequirementSourceDeauthorization(prompts, sourcePath)
  );
}

function taskOwnsPath(self: TaskVerificationController, sourcePath: string): boolean {
  return (self.state.taskOwnedPaths ?? []).some((path) => normalizeRequirementSourcePath(path) === sourcePath);
}

function addCandidateSelections(
  selections: CriticalProofSourceSelectionCandidate[],
  candidates: readonly RequirementSourceCandidate[],
): void {
  for (const candidate of candidates) {
    if (selections.some((selection) => selection.sourcePath === candidate.path)) continue;
    selections.push({ sourcePath: candidate.path, selectedAtPromptId: candidate.referencedByPromptIds.at(-1)! });
  }
}
