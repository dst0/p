import {
  createExactFinalByteObligation,
  formatEvidenceCriticalProofGuidance,
  MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS,
} from "./evidence-critical-proof.ts";
import { exactFinalByteProofDomains } from "./evidence-critical-proof-source.ts";
import {
  MAX_REQUIREMENT_SOURCE_BYTES,
  normalizeRequirementSourcePath,
  referencedRequirementCandidates,
} from "./referenced-requirement-sources.ts";
import {
  isAuthoritativeRequirementSourceCandidate,
  latestRequirementSourceDeauthorization,
} from "./requirement-source-authority.ts";
import { inspectRequirementSourceFile } from "./requirement-source-file.ts";
import { emptyReadiness } from "./state-factories.ts";
import { inferTaskKind } from "./task-kind-inference.ts";
import type { TaskVerificationController } from "./taskverificationcontroller.ts";
import { pathArgument } from "./tool-classification.ts";
import type { TaskVerificationCriticalProofObligation, TaskVerificationSourcePrompt } from "./types.ts";

export interface ReconciledCriticalProofState {
  obligations: TaskVerificationCriticalProofObligation[];
  overflow: boolean | undefined;
}

export function recordCriticalProofObservation(self: TaskVerificationController, args: unknown): string | undefined {
  if (self.mode !== "evidence") return undefined;
  const taskKind = inferTaskKind(self.taskText());
  if (taskKind === "docs" || taskKind === "investigation") return undefined;
  const sourcePath = normalizeRequirementSourcePath(pathArgument(args) ?? "");
  if (!sourcePath || taskOwnsPath(self, sourcePath)) return undefined;

  const prompts = self.state.taskPrompts ?? [];
  const candidate = referencedRequirementCandidates(prompts).find((item) => item.path === sourcePath);
  if (
    !candidate ||
    !isAuthoritativeRequirementSourceCandidate(prompts, candidate) ||
    latestRequirementSourceDeauthorization(prompts, sourcePath)
  ) {
    return undefined;
  }
  const inspected = inspectRequirementSourceFile(
    self.sessionManager.getCwd(),
    sourcePath,
    MAX_REQUIREMENT_SOURCE_BYTES,
  );
  if (typeof inspected === "string") return undefined;
  const domains = exactFinalByteProofDomains(inspected.text);
  const existing = self.state.criticalProofObligations ?? [];
  const retained = existing.filter((obligation) => obligation.sourcePath !== sourcePath);
  const replacements = domains.map((domain) => createExactFinalByteObligation(sourcePath, inspected.sha256, domain));
  const previousForPath = existing.filter((obligation) => obligation.sourcePath === sourcePath);
  if (sameObligations(previousForPath, replacements)) return undefined;
  if (retained.length + replacements.length > MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS) {
    self.state = {
      ...self.state,
      criticalProofObligationOverflow: true,
      readiness: emptyReadiness(),
      updatedAt: new Date().toISOString(),
    };
    self.persistState();
    return "Critical proof discovery exceeded its four-boundary safety limit. Ask the user to narrow the authoritative source set.";
  }
  const obligations = [...retained, ...replacements];
  self.state = {
    ...self.state,
    criticalProofObligations: obligations,
    readiness: emptyReadiness(),
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return [
    "The authoritative source's bounded critical proof boundary changed; prior readiness is invalidated.",
    ...formatEvidenceCriticalProofGuidance(replacements),
  ].join("\n");
}

export function revalidateCriticalProofSources(self: TaskVerificationController): string | undefined {
  const inspectedByPath = new Map<string, ReturnType<typeof inspectRequirementSourceFile>>();
  for (const obligation of self.state.criticalProofObligations ?? []) {
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
    if (!error) continue;
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
  return undefined;
}

export function reconcileCriticalProofAfterPrompt(
  self: TaskVerificationController,
  prompts: readonly TaskVerificationSourcePrompt[],
): ReconciledCriticalProofState {
  const retained = (self.state.criticalProofObligations ?? []).filter(
    (obligation) => !latestRequirementSourceDeauthorization(prompts, obligation.sourcePath),
  );
  if (!self.state.criticalProofObligationOverflow) return { obligations: retained, overflow: undefined };
  const recomputed: TaskVerificationCriticalProofObligation[] = [];
  for (const candidate of referencedRequirementCandidates(prompts)) {
    if (
      !isAuthoritativeRequirementSourceCandidate(prompts, candidate) ||
      latestRequirementSourceDeauthorization(prompts, candidate.path) ||
      taskOwnsPath(self, candidate.path)
    ) {
      continue;
    }
    const inspected = inspectRequirementSourceFile(
      self.sessionManager.getCwd(),
      candidate.path,
      MAX_REQUIREMENT_SOURCE_BYTES,
    );
    if (typeof inspected === "string") return { obligations: retained, overflow: true };
    for (const domain of exactFinalByteProofDomains(inspected.text)) {
      recomputed.push(createExactFinalByteObligation(candidate.path, inspected.sha256, domain));
    }
  }
  const unique = [...new Map(recomputed.map((obligation) => [obligation.id, obligation])).values()].sort(
    (left, right) => left.id.localeCompare(right.id),
  );
  return unique.length > MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS
    ? { obligations: unique.slice(0, MAX_EVIDENCE_CRITICAL_PROOF_OBLIGATIONS), overflow: true }
    : { obligations: unique, overflow: undefined };
}

function taskOwnsPath(self: TaskVerificationController, sourcePath: string): boolean {
  return (self.state.taskOwnedPaths ?? []).some((path) => normalizeRequirementSourcePath(path) === sourcePath);
}

function sameObligations(
  left: readonly TaskVerificationCriticalProofObligation[],
  right: readonly TaskVerificationCriticalProofObligation[],
): boolean {
  return left.length === right.length && left.every((obligation, index) => obligation.id === right[index]?.id);
}
