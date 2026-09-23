import {
  sourceOutputAuthorizationIsBound,
  sourceOutputAuthorizationMarker,
} from "../critical-proof-source-output-authorization.ts";
import { exactFinalByteProofDomains } from "../evidence-critical-proof-source.ts";
import { MAX_REQUIREMENT_SOURCE_BYTES, normalizeRequirementSourcePath } from "../referenced-requirement-sources.ts";
import { inspectRequirementSourceFile } from "../requirement-source-file.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { TaskVerificationCriticalProofSourceOutput } from "../types.ts";

const MAX_SOURCE_OUTPUTS_PER_CALL = 3;

export function declareCriticalProofSourceOutputs(
  self: TaskVerificationController,
  values: readonly string[] | undefined,
  checklistCriteria: readonly string[],
): string | undefined {
  if (values === undefined) return undefined;
  if (values.length === 0 || values.length > MAX_SOURCE_OUTPUTS_PER_CALL) {
    return `source_output_paths requires 1-${MAX_SOURCE_OUTPUTS_PER_CALL} relative paths.`;
  }
  const paths = values.map(normalizeRequirementSourcePath);
  if (paths.some((path) => !path) || new Set(paths).size !== paths.length) {
    return "source_output_paths must contain unique safe relative paths.";
  }
  const allPaths = paths as string[];
  const selected = new Map((self.state.criticalProofSourceSelections ?? []).map((item) => [item.sourcePath, item]));
  // A path that is not an active authoritative requirement source selection is an ordinary edit target:
  // it never requires mutation authorization, so it is silently dropped here rather than gated below.
  const normalized = allPaths.filter((path) => selected.has(path));
  if (normalized.length === 0) return undefined;
  const latestDirectPrompt = [...(self.state.taskPrompts ?? [])]
    .reverse()
    .find((prompt) => prompt.kind !== "referenced_file");
  const authorizedCriteria = new Map(
    normalized.flatMap((path) => {
      const criterion = checklistCriteria.find(
        (candidate) => latestDirectPrompt && sourceOutputAuthorizationIsBound(latestDirectPrompt.text, candidate, path),
      );
      return criterion ? [[path, criterion] as const] : [];
    }),
  );
  const unauthorized = normalized.find((path) => !authorizedCriteria.has(path));
  if (unauthorized) {
    const marker = sourceOutputAuthorizationMarker(unauthorized);
    return `Mutating authoritative source ${unauthorized} requires explicit user authorization. Ask the user to reply with this standalone line: ${marker}. Then name ${unauthorized} in one output-specific completion checklist item before mutation.`;
  }
  const outputs = new Map((self.state.criticalProofSourceOutputs ?? []).map((output) => [output.sourcePath, output]));
  const taskOwned = normalized.find((path) => (self.state.taskOwnedPaths ?? []).includes(path) && !outputs.has(path));
  if (taskOwned) return `source_output_paths must be declared before the task first mutates ${taskOwned}.`;
  for (const sourcePath of normalized) {
    const existing = outputs.get(sourcePath);
    if (existing && (self.state.taskOwnedPaths ?? []).includes(sourcePath)) {
      outputs.set(sourcePath, {
        ...existing,
        authorizedAtPromptId: latestDirectPrompt!.id,
        authorizedCriterion: authorizedCriteria.get(sourcePath)!,
      });
      continue;
    }
    const inspected = inspectRequirementSourceFile(
      self.sessionManager.getCwd(),
      sourcePath,
      MAX_REQUIREMENT_SOURCE_BYTES,
    );
    const obligationHashes = new Set(
      (self.state.criticalProofObligations ?? [])
        .filter((obligation) => obligation.sourcePath === sourcePath)
        .map((obligation) => obligation.sourceSha256),
    );
    if (
      typeof inspected === "string" ||
      selected.get(sourcePath)!.sourceSha256 !== inspected.sha256 ||
      (obligationHashes.size > 0 && !obligationHashes.has(inspected.sha256))
    ) {
      return `Cannot freeze source output ${sourcePath}: its live bytes no longer match the selected authority.`;
    }
    outputs.set(sourcePath, {
      sourcePath,
      authorizedAtPromptId: latestDirectPrompt!.id,
      authorizedCriterion: authorizedCriteria.get(sourcePath)!,
      baselineState: `file:${inspected.executable ? "x" : "-"}:${inspected.sha256}`,
      criticalDomains: exactFinalByteProofDomains(inspected.text),
    });
  }
  self.state = {
    ...self.state,
    criticalProofSourceOutputs: [...outputs.values()].sort((left, right) =>
      left.sourcePath.localeCompare(right.sourcePath),
    ),
    readiness: emptyReadiness(),
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  return undefined;
}

/**
 * source_output_paths entries that are not an active authoritative source selection are silently
 * ignored by declareCriticalProofSourceOutputs (they never require mutation authorization). This
 * surfaces a benign, non-blocking note about them so the model stops passing them.
 */
export function nonAuthoritativeSourceOutputNote(
  self: TaskVerificationController,
  values: readonly string[] | undefined,
): string | undefined {
  if (!values || values.length === 0) return undefined;
  const selected = new Set((self.state.criticalProofSourceSelections ?? []).map((item) => item.sourcePath));
  const ignored = values
    .map(normalizeRequirementSourcePath)
    .filter((path): path is string => path !== undefined && !selected.has(path));
  if (ignored.length === 0) return undefined;
  return ignored.length === 1
    ? `${ignored[0]} is not an authoritative requirement source; omit source_output_paths for it and edit it normally.`
    : `${ignored.join(", ")} are not authoritative requirement sources; omit source_output_paths for them and edit them normally.`;
}

export function retainedCriticalProofSourceOutputs(
  outputs: readonly TaskVerificationCriticalProofSourceOutput[] | undefined,
  selectedPaths: ReadonlySet<string>,
): TaskVerificationCriticalProofSourceOutput[] | undefined {
  const retained = (outputs ?? []).filter((output) => selectedPaths.has(output.sourcePath));
  return retained.length > 0 ? retained : undefined;
}
