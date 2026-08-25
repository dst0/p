import type { BeforeToolCallResult } from "@dst0/p-agent-core";
import {
  isExplicitRequirementSourceAdoption,
  preparedRequirementSourceMatches,
  referencedRequirementCandidates,
  requirementSourceSelectionMatches,
} from "../referenced-requirement-sources.ts";
import { sourcePromptsForState } from "../requirement-audit-hashing.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import {
  isConfidentlyReadOnlyShellTool,
  isDirectMutationTool,
  isPublishCommand,
  isShellTool,
} from "../tool-classification.ts";

export function requirementSourceMutationGate(
  self: TaskVerificationController,
  toolName: string,
  args: unknown,
): BeforeToolCallResult | undefined {
  const prompts = sourcePromptsForState(self.state);
  const candidates = referencedRequirementCandidates(prompts);
  if (candidates.length === 0 || !canPotentiallyChangeWorkspace(toolName, args)) return undefined;

  const references = self.state.requirementSourceRefs ?? [];
  const ignored = self.state.ignoredRequirementSources ?? [];
  if (!requirementSourceSelectionMatches(prompts, references, ignored)) {
    return self.blocked(
      [
        "Freeze explicitly referenced task specifications before the first matching mutating action.",
        `Candidates: ${candidates.map((candidate) => candidate.path).join(", ")}.`,
        'Call record_requirement_audit once with action "prepare_definition", 0-3 relevant selected_paths, and every remaining candidate in ignored_paths with a concrete reason.',
      ].join("\n"),
    );
  }

  if (references.length === 0) return undefined;

  const explicitlyAdoptedChanged = references.find(
    (reference) =>
      isExplicitRequirementSourceAdoption(self.latestUserPrompt, reference.path) &&
      !preparedRequirementSourceMatches(self.sessionManager.getCwd(), reference),
  );
  if (explicitlyAdoptedChanged) {
    return self.blocked(
      `The user authorized adopting changed contents of ${explicitlyAdoptedChanged.path}. Call prepare_definition with that path in adopt_changed_paths before mutation.`,
    );
  }

  const referencesToValidate =
    self.state.requirementAudit.requirements.length === 0
      ? references
      : references.filter((reference) => reference.capturedAtMutationRevision === self.state.mutationRevision);
  if (
    referencesToValidate.some((reference) => !preparedRequirementSourceMatches(self.sessionManager.getCwd(), reference))
  ) {
    return self.blocked(
      "A referenced requirement source changed after preparation. Ask the user whether to adopt the changed specification before continuing.",
    );
  }
  return undefined;
}

export function canPotentiallyChangeWorkspace(toolName: string, args: unknown): boolean {
  if (isDirectMutationTool(toolName)) return true;
  return isShellTool(toolName) && !isPublishCommand(toolName, args) && !isConfidentlyReadOnlyShellTool(toolName, args);
}
