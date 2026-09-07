import { isAbsolute, relative, resolve } from "node:path";
import { completionVerificationScope } from "./completion-verification-scope.ts";
import { frozenSourceOutputRevalidation } from "./critical-proof-source-output-revalidation.ts";
import {
  createExactFinalByteObligation,
  formatEvidenceCriticalProofGuidance,
  MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS,
} from "./evidence-critical-proof.ts";
import { exactFinalByteProofDomains } from "./evidence-critical-proof-source.ts";
import type { RequirementSourceCandidate } from "./referenced-requirement-sources.ts";
import {
  MAX_REQUIREMENT_SOURCE_BYTES,
  normalizeRequirementSourcePath,
  referencedRequirementCandidates,
} from "./referenced-requirement-sources.ts";
import {
  isAuthoritativeRequirementSourceCandidate,
  latestRequirementSourceDeauthorization,
} from "./requirement-source-authority.ts";
import {
  hashRequirementSourceText,
  inspectRequirementSourceFile,
  inspectRequirementSourcePathIdentity,
} from "./requirement-source-file.ts";
import { emptyReadiness } from "./state-factories.ts";
import type { TaskVerificationController } from "./taskverificationcontroller.ts";
import { argsRecord, pathArgument } from "./tool-classification.ts";
import type {
  TaskVerificationCriticalProofDiscoveryFailure,
  TaskVerificationCriticalProofObligation,
} from "./types.ts";

export { reconcileCriticalProofAfterPrompt } from "./evidence-critical-proof-reconciliation.ts";
export function recordCriticalProofObservation(
  self: TaskVerificationController,
  args: unknown,
  readText?: string,
): string | undefined {
  if (self.mode !== "evidence") return undefined;
  const verificationScope =
    self.state.completionChecklist && completionVerificationScope(self.state.completionChecklist);
  const prompts = self.state.taskPrompts ?? [];
  const candidate = observedRequirementSourceCandidate(
    self.sessionManager.getCwd(),
    pathArgument(args) ?? "",
    referencedRequirementCandidates(prompts),
  );
  if (!candidate || taskOwnsPath(self, candidate.path)) return undefined;
  if ((self.state.criticalProofDeauthorizedSourcePaths ?? []).includes(candidate.path)) return undefined;
  if (latestRequirementSourceDeauthorization(prompts, candidate.path)) return undefined;
  const explicitlyAuthoritative = isAuthoritativeRequirementSourceCandidate(prompts, candidate);
  const alreadySelected =
    (self.state.criticalProofObligations ?? []).some((item) => item.sourcePath === candidate.path) ||
    (self.state.criticalProofDiscoveryFailures ?? []).some((item) => item.sourcePath === candidate.path) ||
    (self.state.criticalProofSourceSelections ?? []).some((item) => item.sourcePath === candidate.path);
  if (!explicitlyAuthoritative && !alreadySelected) return undefined;
  if (candidate.observationError)
    return recordCriticalProofDiscoveryFailure(self, candidate.path, candidate.observationError);
  const inspected = inspectRequirementSourceFile(
    self.sessionManager.getCwd(),
    candidate.path,
    MAX_REQUIREMENT_SOURCE_BYTES,
  );
  if (typeof inspected === "string") return recordCriticalProofDiscoveryFailure(self, candidate.path, inspected);
  if (verificationScope && verificationScope !== "runtime_behavior") {
    const selected = (self.state.criticalProofSourceSelections ?? []).find(
      (selection) => selection.sourcePath === candidate.path,
    );
    const sourceIsOutput = (self.state.criticalProofSourceOutputs ?? []).some(
      (output) => output.sourcePath === candidate.path,
    );
    if (!selected || sourceIsOutput) return undefined;
    const readArgs = argsRecord(args);
    if (
      readArgs.offset !== undefined ||
      readArgs.limit !== undefined ||
      readText === undefined ||
      hashRequirementSourceText(readText) !== inspected.sha256
    ) {
      return `Authoritative source ${candidate.path} was not refreshed because the read was partial, truncated, or did not match its current full bytes. Re-read the full source without offset or limit.`;
    }
    const failures = (self.state.criticalProofDiscoveryFailures ?? []).filter(
      (failure) => failure.sourcePath !== candidate.path,
    );
    if (
      selected.sourceSha256 === inspected.sha256 &&
      failures.length === (self.state.criticalProofDiscoveryFailures ?? []).length
    ) {
      return undefined;
    }
    self.state = {
      ...self.state,
      criticalProofSourceSelections: self.state.criticalProofSourceSelections!.map((selection) =>
        selection.sourcePath === candidate.path ? { ...selection, sourceSha256: inspected.sha256 } : selection,
      ),
      criticalProofDiscoveryFailures: failures.length > 0 ? failures : undefined,
      readiness: emptyReadiness(),
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
    return `Authoritative source ${candidate.path} was re-read; its selected content hash was refreshed and prior readiness was invalidated.`;
  }
  const domains = exactFinalByteProofDomains(inspected.text);
  const existing = self.state.criticalProofObligations ?? [];
  const retained = existing.filter((obligation) => obligation.sourcePath !== candidate.path);
  const replacements = domains.map((domain) =>
    createExactFinalByteObligation(candidate.path, inspected.sha256, domain),
  );
  const previousForPath = existing.filter((obligation) => obligation.sourcePath === candidate.path);
  const failures = (self.state.criticalProofDiscoveryFailures ?? []).filter(
    (failure) => failure.sourcePath !== candidate.path,
  );
  const clearedFailure = failures.length !== (self.state.criticalProofDiscoveryFailures ?? []).length;
  const sourceIsOutput = (self.state.criticalProofSourceOutputs ?? []).some(
    (output) => output.sourcePath === candidate.path,
  );
  const selectionChanged =
    !sourceIsOutput &&
    (self.state.criticalProofSourceSelections ?? []).some(
      (selection) => selection.sourcePath === candidate.path && selection.sourceSha256 !== inspected.sha256,
    );
  if (sameObligations(previousForPath, replacements) && !clearedFailure && !selectionChanged) return undefined;
  if (retained.length + replacements.length > MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS) {
    self.state = {
      ...self.state,
      criticalProofObligationOverflow: true,
      criticalProofDiscoveryFailures: failures.length > 0 ? failures : undefined,
      readiness: emptyReadiness(),
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
    return "Critical proof discovery exceeded its four-boundary safety limit. Ask the user to narrow the authoritative source set.";
  }
  const obligations = [...retained, ...replacements];
  const selections = (self.state.criticalProofSourceSelections ?? []).map((selection) =>
    selection.sourcePath === candidate.path && !sourceIsOutput
      ? { ...selection, sourceSha256: inspected.sha256 }
      : selection,
  );
  self.state = {
    ...self.state,
    criticalProofObligations: obligations,
    criticalProofDiscoveryFailures: failures.length > 0 ? failures : undefined,
    criticalProofSourceSelections: selections.length > 0 ? selections : undefined,
    readiness: emptyReadiness(),
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return replacements.length > 0
    ? [
        "The authoritative source's bounded critical proof boundary changed; prior readiness is invalidated.",
        ...formatEvidenceCriticalProofGuidance(replacements),
      ].join("\n")
    : `Critical proof discovery for ${candidate.path} is now safely resolved; prior readiness remains invalidated.`;
}

export function revalidateCriticalProofSources(self: TaskVerificationController): string | undefined {
  const discoveryFailure = criticalProofDiscoveryFailureMessage(self);
  if (discoveryFailure) return discoveryFailure;
  return revalidateCriticalProofState(self);
}

export function revalidatePersistedCriticalProofSources(self: TaskVerificationController): string | undefined {
  return revalidateCriticalProofState(self);
}

function revalidateCriticalProofState(self: TaskVerificationController): string | undefined {
  const inspectedByPath = new Map<string, ReturnType<typeof inspectRequirementSourceFile>>();
  const outputPaths = new Set((self.state.criticalProofSourceOutputs ?? []).map((output) => output.sourcePath));
  const obligationPaths = new Set(
    (self.state.criticalProofObligations ?? []).map((obligation) => obligation.sourcePath),
  );
  for (const selection of self.state.criticalProofSourceSelections ?? []) {
    if (outputPaths.has(selection.sourcePath) || obligationPaths.has(selection.sourcePath)) continue;
    const inspected = inspectRequirementSourceFile(
      self.sessionManager.getCwd(),
      selection.sourcePath,
      MAX_REQUIREMENT_SOURCE_BYTES,
    );
    inspectedByPath.set(selection.sourcePath, inspected);
    const error =
      typeof inspected === "string"
        ? `Cannot revalidate authoritative source ${selection.sourcePath}: ${inspected}`
        : inspected.sha256 !== selection.sourceSha256
          ? `The authoritative source ${selection.sourcePath} changed after it was selected. Re-read the full source and refresh the completion checklist before completion.`
          : undefined;
    if (error) return invalidateReadiness(self, error);
  }
  for (const obligation of self.state.criticalProofObligations ?? []) {
    const frozenOutput = frozenSourceOutputRevalidation(self, obligation);
    if (frozenOutput === true) continue;
    if (typeof frozenOutput === "string") return frozenOutput;
    let inspected = inspectedByPath.get(obligation.sourcePath);
    if (!inspected) {
      inspected = inspectRequirementSourceFile(
        self.sessionManager.getCwd(),
        obligation.sourcePath,
        MAX_REQUIREMENT_SOURCE_BYTES,
      );
      inspectedByPath.set(obligation.sourcePath, inspected);
    }
    const error =
      typeof inspected === "string"
        ? `Cannot revalidate authoritative source ${obligation.sourcePath}: ${inspected}`
        : inspected.sha256 !== obligation.sourceSha256 ||
            !exactFinalByteProofDomains(inspected.text).includes(obligation.artifactDomain)
          ? `The authoritative source ${obligation.sourcePath} changed after its critical proof boundary was recorded. Re-read the full source, refresh the completion checklist if its behavior changed, and collect new focused proof.`
          : undefined;
    if (error) return invalidateReadiness(self, error);
  }
  return undefined;
}

function invalidateReadiness(self: TaskVerificationController, error: string): string {
  if (self.state.readiness?.status !== "pending") {
    self.state = {
      ...self.state,
      readiness: emptyReadiness(),
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
  }
  return error;
}

export function criticalProofDiscoveryFailureMessage(self: TaskVerificationController): string | undefined {
  const failure = self.state.criticalProofDiscoveryFailures?.[0];
  return failure
    ? `Critical proof discovery is blocked for authoritative source ${failure.sourcePath}: ${failure.reason} Resolve the source safety issue and re-read it, or ask the user to de-authorize that source.`
    : undefined;
}

function taskOwnsPath(self: TaskVerificationController, sourcePath: string): boolean {
  return (self.state.taskOwnedPaths ?? []).some((path) => normalizeRequirementSourcePath(path) === sourcePath);
}

function observedRequirementSourceCandidate(
  cwd: string,
  value: string,
  candidates: readonly RequirementSourceCandidate[],
): (RequirementSourceCandidate & { observationError?: string }) | undefined {
  const workspaceRelative = relative(resolve(cwd), resolve(cwd, value));
  if (!workspaceRelative || isAbsolute(workspaceRelative)) return undefined;
  const observedPath = normalizeRequirementSourcePath(workspaceRelative.replaceAll("\\", "/"));
  if (!observedPath) return undefined;
  const exact = candidates.find((candidate) => candidate.path === observedPath);
  if (exact) return exact;
  const foldedPath = observedPath.toLocaleLowerCase("en-US");
  const aliases = candidates.filter((candidate) => candidate.path.toLocaleLowerCase("en-US") === foldedPath);
  if (aliases.length !== 1) return undefined;
  const candidate = aliases[0]!;
  const observedIdentity = inspectRequirementSourcePathIdentity(cwd, observedPath);
  if (typeof observedIdentity === "string") return { ...candidate, observationError: observedIdentity };
  const candidateIdentity = inspectRequirementSourcePathIdentity(cwd, candidate.path);
  if (typeof candidateIdentity === "string") return candidate;
  return observedIdentity.stat.dev === candidateIdentity.stat.dev &&
    observedIdentity.stat.ino === candidateIdentity.stat.ino
    ? candidate
    : {
        ...candidate,
        observationError: `Observed path ${observedPath} does not resolve to authoritative source ${candidate.path}.`,
      };
}

function recordCriticalProofDiscoveryFailure(
  self: TaskVerificationController,
  sourcePath: string,
  reason: string,
): string {
  self.state = {
    ...self.state,
    criticalProofDiscoveryFailures: upsertCriticalProofDiscoveryFailure(
      self.state.criticalProofDiscoveryFailures ?? [],
      sourcePath,
      reason,
    ),
    readiness: emptyReadiness(),
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return criticalProofDiscoveryFailureMessage(self)!;
}

function upsertCriticalProofDiscoveryFailure(
  failures: readonly TaskVerificationCriticalProofDiscoveryFailure[],
  sourcePath: string,
  reason: string,
): TaskVerificationCriticalProofDiscoveryFailure[] {
  return [
    ...failures.filter((failure) => failure.sourcePath !== sourcePath),
    { sourcePath, reason: reason.slice(0, 500) },
  ];
}

function sameObligations(
  left: readonly TaskVerificationCriticalProofObligation[],
  right: readonly TaskVerificationCriticalProofObligation[],
): boolean {
  return left.length === right.length && left.every((obligation, index) => obligation.id === right[index]?.id);
}
