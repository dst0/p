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
  const normalized = paths as string[];
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
  const selected = new Map((self.state.criticalProofSourceSelections ?? []).map((item) => [item.sourcePath, item]));
  const unknown = normalized.find((path) => !selected.has(path));
  if (unknown) return `source_output_paths requires an active authoritative source selection: ${unknown}.`;
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

export function retainedCriticalProofSourceOutputs(
  outputs: readonly TaskVerificationCriticalProofSourceOutput[] | undefined,
  selectedPaths: ReadonlySet<string>,
): TaskVerificationCriticalProofSourceOutput[] | undefined {
  const retained = (outputs ?? []).filter((output) => selectedPaths.has(output.sourcePath));
  return retained.length > 0 ? retained : undefined;
}
