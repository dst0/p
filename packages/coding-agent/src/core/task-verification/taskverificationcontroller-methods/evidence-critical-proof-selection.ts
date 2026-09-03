import type { CompletionVerificationScope } from "../completion-verification-scope.ts";
import {
  type CriticalProofSourceSelectionCandidate,
  recomputeCriticalProofSelections,
} from "../critical-proof-selection-recompute.ts";
import { MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS } from "../evidence-critical-proof.ts";
import {
  activeRequirementSourceCandidateCatalog,
  MAX_REQUIREMENT_SOURCE_CANDIDATES,
  MAX_SELECTED_REQUIREMENT_SOURCES,
  normalizeRequirementSourcePath,
  referencedRequirementCandidateCatalog,
  requirementSourcePathReferencedByPrompt,
} from "../referenced-requirement-sources.ts";
import {
  isAuthoritativeRequirementSourceCandidate,
  latestRequirementSourceDeauthorization,
} from "../requirement-source-authority.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type {
  TaskVerificationCriticalProofDiscoveryFailure,
  TaskVerificationCriticalProofSourceSelection,
} from "../types.ts";
import { retainedCriticalProofSourceOutputs } from "./critical-proof-source-output.ts";

export function selectCriticalProofSources(
  self: TaskVerificationController,
  values: readonly string[] | undefined,
  deauthorizedValues: readonly string[] | undefined,
  verificationScope: CompletionVerificationScope,
): string | undefined {
  const normalized = normalizedPaths("authoritative_source_paths", values);
  if (typeof normalized === "string") return normalized;
  const deauthorized = normalizedPaths("deauthorized_source_paths", deauthorizedValues);
  if (typeof deauthorized === "string") return deauthorized;
  if (normalized.some((path) => deauthorized.includes(path))) {
    return "A source path cannot be authoritative and de-authorized in the same checklist call.";
  }
  const prompts = self.state.taskPrompts ?? [];
  const latestDirectPrompt = [...prompts].reverse().find((prompt) => prompt.kind !== "referenced_file");
  if (normalized.length > 0 && !latestDirectPrompt) {
    return "authoritative_source_paths requires a current direct user prompt.";
  }
  const staleDeauthorization = deauthorized.find(
    (path) => !latestDirectPrompt || !requirementSourcePathReferencedByPrompt(latestDirectPrompt, path),
  );
  if (staleDeauthorization) {
    return `deauthorized_source_paths must be referenced in the latest direct user prompt: ${staleDeauthorization}.`;
  }
  const acceptedDeauthorizations = [...(self.state.criticalProofDeauthorizedSourcePaths ?? []), ...deauthorized].filter(
    (path) => !normalized.includes(path),
  );
  const catalog = activeRequirementSourceCandidateCatalog(prompts, acceptedDeauthorizations);
  if (catalog.overflow) {
    return `More than ${MAX_REQUIREMENT_SOURCE_CANDIDATES} requirement-source candidates were referenced. Ask the user to narrow the authoritative specification set.`;
  }
  const candidates = catalog.candidates;
  const unknown = normalized.filter((path) => !candidates.some((candidate) => candidate.path === path));
  if (unknown.length > 0) return `Authoritative source was not referenced by the user: ${unknown.join(", ")}.`;
  const samePromptDeauthorization = deauthorized.find((path) =>
    (self.state.criticalProofSourceSelections ?? []).some(
      (selection) => selection.sourcePath === path && selection.selectedAtPromptId === latestDirectPrompt?.id,
    ),
  );
  if (samePromptDeauthorization) {
    return `deauthorized_source_paths requires a later direct user prompt than the source selection: ${samePromptDeauthorization}.`;
  }
  const activePaths = new Set([
    ...(self.state.criticalProofObligations ?? []).map((item) => item.sourcePath),
    ...(self.state.criticalProofDiscoveryFailures ?? []).map((item) => item.sourcePath),
    ...(self.state.criticalProofDeauthorizedSourcePaths ?? []),
    ...(self.state.criticalProofSourceSelections ?? []).map((item) => item.sourcePath),
  ]);
  const inactiveDeauthorization = deauthorized.find(
    (path) => !activePaths.has(path) && !referencedRequirementCandidateCatalog(prompts).overflow,
  );
  if (inactiveDeauthorization) {
    return `Cannot de-authorize a source that was not selected for critical proof: ${inactiveDeauthorization}.`;
  }
  const taskOwned = normalized.find((path) => (self.state.taskOwnedPaths ?? []).includes(path));
  if (taskOwned) return `A task-owned output cannot be selected as an authoritative source: ${taskOwned}.`;
  let selections: CriticalProofSourceSelectionCandidate[] = (self.state.criticalProofSourceSelections ?? []).filter(
    (item) => !deauthorized.includes(item.sourcePath),
  );
  const deauthorizedPaths = new Set([...(self.state.criticalProofDeauthorizedSourcePaths ?? []), ...deauthorized]);
  if (deauthorizedPaths.size > MAX_REQUIREMENT_SOURCE_CANDIDATES) {
    return `De-authorized critical-proof sources exceed the ${MAX_REQUIREMENT_SOURCE_CANDIDATES}-source bound.`;
  }
  for (const path of normalized) deauthorizedPaths.delete(path);
  for (const path of normalized) {
    const current = selections.find((selection) => selection.sourcePath === path);
    selections = [
      ...selections.filter((selection) => selection.sourcePath !== path),
      current
        ? { ...current, selectedAtPromptId: latestDirectPrompt!.id }
        : { sourcePath: path, selectedAtPromptId: latestDirectPrompt!.id },
    ];
  }
  for (const candidate of candidates) {
    if (
      selections.some((selection) => selection.sourcePath === candidate.path) ||
      (self.state.taskOwnedPaths ?? []).includes(candidate.path) ||
      latestRequirementSourceDeauthorization(prompts, candidate.path) ||
      !isAuthoritativeRequirementSourceCandidate(prompts, candidate)
    ) {
      continue;
    }
    selections.push({ sourcePath: candidate.path, selectedAtPromptId: candidate.referencedByPromptIds.at(-1)! });
  }
  const recomputed = recomputeCriticalProofSelections(
    self.sessionManager.getCwd(),
    selections,
    self.state.criticalProofSourceOutputs,
  );
  const allObligations = verificationScope === "runtime_behavior" ? recomputed.obligations : [];
  const obligations = allObligations.slice(0, MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS);
  const overflow = allObligations.length > MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS;
  persistSelection(
    self,
    obligations,
    recomputed.failures,
    overflow || undefined,
    [...deauthorizedPaths],
    recomputed.selections,
  );
  const failedSelection = recomputed.failures.find((failure) => normalized.includes(failure.sourcePath));
  if (failedSelection) {
    return `Cannot select authoritative source ${failedSelection.sourcePath}: ${failedSelection.reason}`;
  }
  return overflow ? "Selected authoritative sources exceed the four-boundary critical-proof limit." : undefined;
}

function persistSelection(
  self: TaskVerificationController,
  obligations: TaskVerificationController["state"]["criticalProofObligations"],
  failures: TaskVerificationCriticalProofDiscoveryFailure[],
  overflow: boolean | undefined,
  deauthorizedPaths: string[],
  selections: TaskVerificationCriticalProofSourceSelection[],
): void {
  const selectedPaths = new Set(selections.map((selection) => selection.sourcePath));
  self.state = {
    ...self.state,
    criticalProofObligations: obligations,
    criticalProofDiscoveryFailures: failures.length > 0 ? failures : undefined,
    criticalProofObligationOverflow: overflow,
    criticalProofDeauthorizedSourcePaths: deauthorizedPaths.length > 0 ? deauthorizedPaths : undefined,
    criticalProofSourceSelections: selections.length > 0 ? selections : undefined,
    criticalProofSourceOutputs: retainedCriticalProofSourceOutputs(
      self.state.criticalProofSourceOutputs,
      selectedPaths,
    ),
    readiness: emptyReadiness(),
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
}

function normalizedPaths(label: string, values: readonly string[] | undefined): string[] | string {
  if (values === undefined) return [];
  if (values.length === 0 || values.length > MAX_SELECTED_REQUIREMENT_SOURCES) {
    return `${label} requires 1-${MAX_SELECTED_REQUIREMENT_SOURCES} relative paths.`;
  }
  const normalized = values.map(normalizeRequirementSourcePath);
  return normalized.some((path) => !path) || new Set(normalized).size !== normalized.length
    ? `${label} must contain unique safe relative paths.`
    : (normalized as string[]);
}
