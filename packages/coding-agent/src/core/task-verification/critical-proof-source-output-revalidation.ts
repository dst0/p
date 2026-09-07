import { completionVerificationScope } from "./completion-verification-scope.ts";
import {
  promptContainsSourceOutputAuthorization,
  sourceOutputAuthorizationIsBound,
  sourceOutputAuthorizationMarker,
} from "./critical-proof-source-output-authorization.ts";
import type { TaskVerificationCriticalProofSourceOutput } from "./critical-proof-source-output-state.ts";
import type { TaskVerificationController } from "./taskverificationcontroller.ts";
import { readWorkspaceEffectPathState } from "./taskverificationcontroller-methods/source-workspace-snapshot.ts";
import { isRecord } from "./tool-classification.ts";
import type { TaskVerificationCriticalProofObligation } from "./types.ts";

export function frozenSourceOutputRevalidation(
  self: TaskVerificationController,
  obligation: TaskVerificationCriticalProofObligation,
): true | string | undefined {
  const authorization = (self.state.criticalProofSourceOutputs ?? []).find(
    (output) => output.sourcePath === obligation.sourcePath,
  );
  if (!authorization) return undefined;
  if (!authorization.baselineState.endsWith(`:${obligation.sourceSha256}`)) {
    return `Frozen source-output authority for ${obligation.sourcePath} does not match its critical proof boundary.`;
  }
  return frozenSourceOutputStateRevalidation(self, authorization);
}

export function frozenSourceOutputRestoreError(self: TaskVerificationController): string | undefined {
  for (const authorization of self.state.criticalProofSourceOutputs ?? []) {
    const error = frozenSourceOutputStateRevalidation(self, authorization);
    if (typeof error === "string") return error;
  }
  return undefined;
}

export function promptCanRecoverStaleSourceOutputAuthorization(
  self: TaskVerificationController,
  promptText: string,
): boolean {
  return (
    recoverableStaleSourceOutputs(self).some((output) =>
      promptContainsSourceOutputAuthorization(promptText, output.sourcePath),
    ) && staleAuthorizationMatchesRestoreError(self)
  );
}

export function inputCanRecoverStaleSourceOutputAuthorization(
  self: TaskVerificationController,
  input: unknown,
): boolean {
  if (!isRecord(input) || input.action !== "record_completion_checklist") return false;
  if (input.authoritative_source_paths !== undefined || input.deauthorized_source_paths !== undefined) return false;
  if (!Array.isArray(input.source_output_paths) || !Array.isArray(input.completion_checklist)) return false;
  const sourceOutputPaths: unknown[] = input.source_output_paths;
  const completionChecklist: unknown[] = input.completion_checklist;
  const stalePaths = new Set(recoverableStaleSourceOutputs(self).map((output) => output.sourcePath));
  const latestDirectPrompt = [...(self.state.taskPrompts ?? [])]
    .reverse()
    .find((item) => item.kind !== "referenced_file");
  return (
    staleAuthorizationMatchesRestoreError(self) &&
    sourceOutputPaths.length > 0 &&
    sourceOutputPaths.every(
      (path) =>
        typeof path === "string" &&
        stalePaths.has(path) &&
        latestDirectPrompt !== undefined &&
        completionChecklist.some(
          (criterion) =>
            typeof criterion === "string" && sourceOutputAuthorizationIsBound(latestDirectPrompt.text, criterion, path),
        ),
    )
  );
}

function staleAuthorizationMatchesRestoreError(self: TaskVerificationController): boolean {
  const stale = recoverableStaleSourceOutputs(self)[0];
  return stale !== undefined && self.restoreError === staleSourceOutputAuthorizationError(stale.sourcePath);
}

function recoverableStaleSourceOutputs(self: TaskVerificationController): TaskVerificationCriticalProofSourceOutput[] {
  const prompts = self.state.taskPrompts ?? [];
  const latestDirectPrompt = [...prompts].reverse().find((item) => item.kind !== "referenced_file");
  return (self.state.criticalProofSourceOutputs ?? []).filter((authorization) => {
    const prompt = prompts.find((item) => item.id === authorization.authorizedAtPromptId);
    return (
      prompt !== undefined &&
      latestDirectPrompt?.id !== authorization.authorizedAtPromptId &&
      sourceOutputAuthorizationIsBound(prompt.text, authorization.authorizedCriterion, authorization.sourcePath)
    );
  });
}

function staleSourceOutputAuthorizationError(sourcePath: string): string {
  return `Frozen source output ${sourcePath} has no valid mutation authorization for the latest direct user prompt. Ask the user for the standalone line ${sourceOutputAuthorizationMarker(sourcePath)}, then redeclare source_output_paths before another mutation.`;
}

function frozenSourceOutputStateRevalidation(
  self: TaskVerificationController,
  authorization: TaskVerificationCriticalProofSourceOutput,
): true | string {
  const prompt = (self.state.taskPrompts ?? []).find((item) => item.id === authorization.authorizedAtPromptId);
  const latestDirectPrompt = [...(self.state.taskPrompts ?? [])]
    .reverse()
    .find((item) => item.kind !== "referenced_file");
  if (
    !prompt ||
    latestDirectPrompt?.id !== authorization.authorizedAtPromptId ||
    !sourceOutputAuthorizationIsBound(prompt.text, authorization.authorizedCriterion, authorization.sourcePath)
  ) {
    return staleSourceOutputAuthorizationError(authorization.sourcePath);
  }
  const sourceSha256 = authorization.baselineState.slice(authorization.baselineState.lastIndexOf(":") + 1);
  if (
    completionVerificationScope(self.state.completionChecklist) === "runtime_behavior" &&
    !self.state.criticalProofObligationOverflow
  ) {
    const obligations = self.state.criticalProofObligations ?? [];
    const missingDomain = authorization.criticalDomains.find(
      (domain) =>
        !obligations.some(
          (obligation) =>
            obligation.sourcePath === authorization.sourcePath &&
            obligation.sourceSha256 === sourceSha256 &&
            obligation.artifactDomain === domain,
        ),
    );
    if (missingDomain) {
      return `Frozen source output ${authorization.sourcePath} is missing its frozen critical obligation for ${missingDomain}.`;
    }
  }
  const taskOwned = (self.state.taskOwnedPaths ?? []).includes(authorization.sourcePath);
  const currentState = readWorkspaceEffectPathState(self.sessionManager.getCwd(), authorization.sourcePath);
  if (!taskOwned) {
    return currentState === authorization.baselineState
      ? true
      : `Frozen source output ${authorization.sourcePath} changed before its requested task mutation was recorded.`;
  }
  const baseline = (self.state.taskOwnedPathBaselines ?? []).find((entry) => entry.path === authorization.sourcePath);
  if (!baseline || baseline.state !== authorization.baselineState) {
    return `Cannot prove the pre-mutation bytes for frozen source output ${authorization.sourcePath}. Restore it and declare source_output_paths before retrying the mutation.`;
  }
  if (
    currentState === authorization.baselineState ||
    (currentState !== "missing" && !/^file:[-x]:/u.test(currentState ?? ""))
  ) {
    return `Frozen source output ${authorization.sourcePath} must resolve to a changed regular file or a recorded missing path.`;
  }
  return true;
}
