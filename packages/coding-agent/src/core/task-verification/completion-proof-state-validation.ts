import { persistedCompletionChecklistIsCanonical } from "./completion-checklist-policy.ts";
import { completionVerificationScope, isCompletionVerificationScope } from "./completion-verification-scope.ts";
import { sourceOutputAuthorizationIsBound } from "./critical-proof-source-output-authorization.ts";
import { MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS } from "./evidence-critical-proof.ts";
import { normalizeRequirementSourcePath } from "./referenced-requirement-sources.ts";
import type { TaskVerificationCompletionChecklist, TaskVerificationCriticalProofObligation } from "./types.ts";

export function persistedCompletionChecklistIsValid(
  value: unknown,
  taskPrompts: unknown,
  mutationRevision: unknown,
): value is TaskVerificationCompletionChecklist {
  return (
    isRecord(value) &&
    value.version === 1 &&
    (value.verificationScope === undefined || isCompletionVerificationScope(value.verificationScope)) &&
    persistedCompletionChecklistIsCanonical(value.criteria) &&
    isStringArray(value.sourcePromptIds) &&
    value.sourcePromptIds.length > 0 &&
    new Set(value.sourcePromptIds).size === value.sourcePromptIds.length &&
    Array.isArray(taskPrompts) &&
    value.sourcePromptIds.length === taskPrompts.length &&
    value.sourcePromptIds.every((id, index) => isRecord(taskPrompts[index]) && taskPrompts[index].id === id) &&
    isNonnegativeInteger(value.createdAtMutationRevision) &&
    isNonnegativeInteger(mutationRevision) &&
    value.createdAtMutationRevision <= mutationRevision
  );
}

export function persistedCriticalProofObligationsAreValid(value: unknown): boolean {
  if (!Array.isArray(value) || value.length > MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS) return false;
  if (!value.every(isCriticalProofObligation)) return false;
  const obligations = value as TaskVerificationCriticalProofObligation[];
  return (
    new Set(obligations.map((item) => item.id)).size === obligations.length &&
    new Set(obligations.map((item) => `${item.sourcePath}\n${item.artifactDomain}`)).size === obligations.length
  );
}

export function persistedChecklistProofScopeIsConsistent(checklist: unknown, obligations: unknown): boolean {
  return (
    !isRecord(checklist) ||
    completionVerificationScope(checklist) === "runtime_behavior" ||
    !Array.isArray(obligations) ||
    obligations.length === 0
  );
}

export function persistedCriticalProofAuxiliaryStateIsValid(
  failuresValue: unknown,
  deauthorizedValue: unknown,
  obligationsValue: unknown,
  obligationOverflowValue: unknown,
  completionChecklistValue: unknown,
  selectionsValue: unknown,
  sourceOutputsValue: unknown,
  taskPromptsValue: unknown,
  taskOwnedPathsValue: unknown,
  taskOwnedPathBaselinesValue: unknown,
): boolean {
  if (
    !discoveryFailuresAreValid(failuresValue) ||
    !deauthorizedPathsAreValid(deauthorizedValue) ||
    !sourceSelectionsAreValid(selectionsValue, taskPromptsValue) ||
    !sourceOutputsAreValid(
      sourceOutputsValue,
      selectionsValue,
      obligationsValue,
      obligationOverflowValue,
      completionChecklistValue,
      taskPromptsValue,
      taskOwnedPathsValue,
      taskOwnedPathBaselinesValue,
    )
  ) {
    return false;
  }
  const deauthorized = new Set(Array.isArray(deauthorizedValue) ? deauthorizedValue : []);
  const activePaths = [
    ...(Array.isArray(failuresValue) ? failuresValue : []),
    ...(Array.isArray(obligationsValue) ? obligationsValue : []),
    ...(Array.isArray(selectionsValue) ? selectionsValue : []),
    ...(Array.isArray(sourceOutputsValue) ? sourceOutputsValue : []),
  ].flatMap((item) => (isRecord(item) && typeof item.sourcePath === "string" ? [item.sourcePath] : []));
  const selectionHashes = new Map(
    Array.isArray(selectionsValue)
      ? selectionsValue.flatMap((selection) =>
          isRecord(selection) && typeof selection.sourcePath === "string" && typeof selection.sourceSha256 === "string"
            ? [[selection.sourcePath, selection.sourceSha256] as const]
            : [],
        )
      : [],
  );
  const obligationsMatchSelections = !Array.isArray(obligationsValue)
    ? true
    : obligationsValue.every(
        (obligation) =>
          !isRecord(obligation) ||
          typeof obligation.sourcePath !== "string" ||
          !selectionHashes.has(obligation.sourcePath) ||
          selectionHashes.get(obligation.sourcePath) === obligation.sourceSha256,
      );
  return obligationsMatchSelections && activePaths.every((path) => !deauthorized.has(path));
}

function sourceOutputsAreValid(
  value: unknown,
  selectionsValue: unknown,
  obligationsValue: unknown,
  obligationOverflowValue: unknown,
  completionChecklistValue: unknown,
  taskPromptsValue: unknown,
  taskOwnedPathsValue: unknown,
  taskOwnedPathBaselinesValue: unknown,
): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 8 || !Array.isArray(selectionsValue)) return false;
  const selected = new Set(
    selectionsValue.flatMap((selection) =>
      isRecord(selection) && typeof selection.sourcePath === "string" ? [selection.sourcePath] : [],
    ),
  );
  const selectedHashes = new Map(
    selectionsValue.flatMap((selection) =>
      isRecord(selection) && typeof selection.sourcePath === "string" && typeof selection.sourceSha256 === "string"
        ? [[selection.sourcePath, selection.sourceSha256] as const]
        : [],
    ),
  );
  const prompts = new Map(
    Array.isArray(taskPromptsValue)
      ? taskPromptsValue.flatMap((prompt) =>
          isRecord(prompt) && typeof prompt.id === "string" && typeof prompt.text === "string"
            ? [[prompt.id, prompt.text] as const]
            : [],
        )
      : [],
  );
  const paths = new Set<string>();
  const taskOwnedPaths = new Set(Array.isArray(taskOwnedPathsValue) ? taskOwnedPathsValue : []);
  const baselines = new Map(
    Array.isArray(taskOwnedPathBaselinesValue)
      ? taskOwnedPathBaselinesValue.flatMap((baseline) =>
          isRecord(baseline) && typeof baseline.path === "string" ? [[baseline.path, baseline.state] as const] : [],
        )
      : [],
  );
  return value.every((output) => {
    if (
      !isRecord(output) ||
      typeof output.sourcePath !== "string" ||
      normalizeRequirementSourcePath(output.sourcePath) !== output.sourcePath ||
      paths.has(output.sourcePath) ||
      !selected.has(output.sourcePath) ||
      typeof output.authorizedAtPromptId !== "string" ||
      !prompts.has(output.authorizedAtPromptId) ||
      typeof output.authorizedCriterion !== "string" ||
      output.authorizedCriterion.length === 0 ||
      output.authorizedCriterion.length > 300 ||
      !sourceOutputAuthorizationIsBound(
        prompts.get(output.authorizedAtPromptId)!,
        output.authorizedCriterion,
        output.sourcePath,
      ) ||
      typeof output.baselineState !== "string" ||
      !/^file:[-x]:[a-f0-9]{64}$/u.test(output.baselineState) ||
      selectedHashes.get(output.sourcePath) !== output.baselineState.slice(output.baselineState.lastIndexOf(":") + 1) ||
      !Array.isArray(output.criticalDomains) ||
      output.criticalDomains.length > 4 ||
      new Set(output.criticalDomains).size !== output.criticalDomains.length ||
      !output.criticalDomains.every((domain) => typeof domain === "string" && /^[a-z][a-z0-9-]{0,63}$/u.test(domain))
    ) {
      return false;
    }
    const criticalDomains = output.criticalDomains as string[];
    const outputObligations = Array.isArray(obligationsValue)
      ? obligationsValue.filter((obligation) => isRecord(obligation) && obligation.sourcePath === output.sourcePath)
      : [];
    const sourceSha256 = output.baselineState.slice(output.baselineState.lastIndexOf(":") + 1);
    const obligationDomains = new Set(
      outputObligations.flatMap((obligation) =>
        isRecord(obligation) && typeof obligation.artifactDomain === "string" ? [obligation.artifactDomain] : [],
      ),
    );
    if (
      outputObligations.some(
        (obligation) =>
          obligation.sourceSha256 !== sourceSha256 ||
          typeof obligation.artifactDomain !== "string" ||
          !criticalDomains.includes(obligation.artifactDomain),
      ) ||
      (completionVerificationScope(isRecord(completionChecklistValue) ? completionChecklistValue : undefined) ===
        "runtime_behavior" &&
        obligationOverflowValue !== true &&
        (obligationDomains.size !== criticalDomains.length ||
          criticalDomains.some((domain) => !obligationDomains.has(domain)))) ||
      (taskOwnedPaths.has(output.sourcePath) && baselines.get(output.sourcePath) !== output.baselineState)
    ) {
      return false;
    }
    paths.add(output.sourcePath);
    return true;
  });
}

function discoveryFailuresAreValid(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 8) return false;
  const paths = new Set<string>();
  return value.every((failure) => {
    if (!isRecord(failure) || !isNonemptyString(failure.sourcePath) || !isNonemptyString(failure.reason)) return false;
    if (
      failure.reason.length > 500 ||
      normalizeRequirementSourcePath(failure.sourcePath) !== failure.sourcePath ||
      paths.has(failure.sourcePath)
    ) {
      return false;
    }
    paths.add(failure.sourcePath);
    return true;
  });
}

function deauthorizedPathsAreValid(value: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 8) return false;
  return (
    new Set(value).size === value.length &&
    value.every((path) => typeof path === "string" && normalizeRequirementSourcePath(path) === path)
  );
}

function sourceSelectionsAreValid(value: unknown, taskPromptsValue: unknown): boolean {
  if (value === undefined) return true;
  if (!Array.isArray(value) || value.length > 8 || !Array.isArray(taskPromptsValue)) return false;
  const promptIds = new Set(
    taskPromptsValue.flatMap((prompt) => (isRecord(prompt) && typeof prompt.id === "string" ? [prompt.id] : [])),
  );
  const paths = new Set<string>();
  return value.every((selection) => {
    if (
      !isRecord(selection) ||
      typeof selection.sourcePath !== "string" ||
      normalizeRequirementSourcePath(selection.sourcePath) !== selection.sourcePath ||
      typeof selection.selectedAtPromptId !== "string" ||
      !promptIds.has(selection.selectedAtPromptId) ||
      typeof selection.sourceSha256 !== "string" ||
      !/^[a-f0-9]{64}$/u.test(selection.sourceSha256) ||
      paths.has(selection.sourcePath)
    ) {
      return false;
    }
    paths.add(selection.sourcePath);
    return true;
  });
}

function isCriticalProofObligation(value: unknown): value is TaskVerificationCriticalProofObligation {
  return (
    isRecord(value) &&
    isNonemptyString(value.id) &&
    value.policy === "remove_exact_final_byte" &&
    isNonemptyString(value.sourcePath) &&
    normalizeRequirementSourcePath(value.sourcePath) === value.sourcePath &&
    typeof value.sourceSha256 === "string" &&
    /^[a-f0-9]{64}$/u.test(value.sourceSha256) &&
    typeof value.artifactDomain === "string" &&
    /^[a-z][a-z0-9-]{0,63}$/u.test(value.artifactDomain)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

function isNonnegativeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
