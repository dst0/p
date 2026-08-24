import {
  isExplicitRequirementSourceAdoption,
  MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES,
  normalizeRequirementSourcePath,
  prepareReferencedRequirementSources,
} from "../referenced-requirement-sources.ts";
import { sourcePromptsForState } from "../requirement-audit-hashing.ts";
import {
  formatRequirementDefinitionPrompt,
  renderRequirementDefinitionPrompt,
} from "../requirement-definition-prompt.ts";
import { persistRequirementSourceSnapshots } from "../requirement-source-storage.ts";
import { emptyReadiness, emptyRequirementAudit } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type {
  RequirementAuditInput,
  TaskVerificationRequirementSourceRef,
  TaskVerificationSourcePrompt,
  VerificationResult,
} from "../types.ts";

export function do_prepareRequirementDefinition(
  self: TaskVerificationController,
  input: RequirementAuditInput,
): VerificationResult {
  if (!self.state.taskKind || !self.state.taskSummary) {
    return self.rejected("Declare the task before preparing referenced requirement sources.");
  }
  const prompts = sourcePromptsForState(self.state);
  const selectedPaths = input.selected_paths ?? [];
  const adoptionPaths = normalizeAdoptionPaths(input.adopt_changed_paths ?? []);
  if (typeof adoptionPaths === "string") return self.rejected(adoptionPaths);
  const adoptionError = validateAdoptions(self, selectedPaths, adoptionPaths);
  if (adoptionError) return self.rejected(adoptionError);

  const existing = self.state.requirementSourceRefs ?? [];
  const reusable = existing.filter(
    (reference) =>
      selectedPaths.some((path) => normalizeRequirementSourcePath(path) === reference.path) &&
      !adoptionPaths.has(reference.path),
  );
  for (const reference of reusable) {
    if (!self.requirementSourceTexts.has(reference.id)) {
      return self.rejected(
        `The frozen snapshot for ${reference.path} is unavailable. Ask the user to explicitly adopt the current changed file before preparing again.`,
      );
    }
  }
  const selection = prepareReferencedRequirementSources(
    self.sessionManager.getCwd(),
    prompts,
    selectedPaths,
    input.ignored_paths ?? [],
    reusable,
    existing.map((reference) => reference.path),
  );
  if (typeof selection === "string") return self.rejected(selection);

  const prospectiveSources = buildProspectiveSources(
    self,
    prompts,
    selection.selectedPaths,
    selection.sources,
    reusable,
  );
  if (typeof prospectiveSources === "string") return self.rejected(prospectiveSources);
  if (prospectiveSources.length > prompts.length) {
    const definitionPrompt = renderRequirementDefinitionPrompt(prospectiveSources);
    if (definitionPrompt.normalPromptExceedsLimit) {
      return self.rejected(
        `The rendered requirement-definition prompt exceeds ${MAX_REQUIREMENT_DEFINITION_PROMPT_BYTES} bytes. Select smaller sources or ask the user to narrow the specification.`,
      );
    }
  }

  const persisted = persistRequirementSourceSnapshots(self.sessionManager, self.state, selection.sources);
  const references = orderReferences(selection.selectedPaths, [...reusable, ...persisted]);
  const selectedTexts = new Map<string, string>();
  for (const reference of reusable) selectedTexts.set(reference.id, self.requirementSourceTexts.get(reference.id)!);
  for (const source of selection.sources) selectedTexts.set(source.id, source.text);
  self.rejectedRequirementDefinitionDraft = undefined;
  self.requirementSourceTexts.clear();
  for (const [id, text] of selectedTexts) self.requirementSourceTexts.set(id, text);
  self.state = {
    ...self.state,
    requirementSourceRefs: references,
    ignoredRequirementSources: selection.ignoredSources,
    readiness: emptyReadiness(),
    requirementAudit:
      references.length > 0 ? { ...emptyRequirementAudit(), status: "awaiting_definition" } : emptyRequirementAudit(),
    updatedAt: new Date().toISOString(),
  };
  if (self.restoreError?.startsWith("requirement-source snapshot")) self.restoreError = undefined;
  self.persistState();

  if (references.length === 0) {
    return self.updated(
      `Classified ${selection.ignoredSources.length} referenced path(s) as non-authoritative; no requirement source was selected. Implementation may proceed.`,
      false,
    );
  }
  return self.updated(
    [
      `Prepared ${references.length} immutable requirement-source snapshot(s) (${persisted.length} new, ${reusable.length} reused).`,
      `Ignored ${selection.ignoredSources.length} classified candidate(s).`,
      "Define the complete clause-to-requirement matrix in the next model turn.",
      "",
      formatRequirementDefinitionPrompt(prospectiveSources),
    ].join("\n"),
    false,
  );
}

function buildProspectiveSources(
  self: TaskVerificationController,
  prompts: readonly TaskVerificationSourcePrompt[],
  selectedPaths: readonly string[],
  prepared: readonly { id: string; path: string; sha256: string; text: string }[],
  reusable: readonly TaskVerificationRequirementSourceRef[],
): TaskVerificationSourcePrompt[] | string {
  const referenced: TaskVerificationSourcePrompt[] = [];
  for (const path of selectedPaths) {
    const fresh = prepared.find((source) => source.path === path);
    if (fresh) {
      referenced.push({ id: fresh.id, kind: "referenced_file", path, sha256: fresh.sha256, text: fresh.text });
      continue;
    }
    const reference = reusable.find((candidate) => candidate.path === path);
    const text = reference ? self.requirementSourceTexts.get(reference.id) : undefined;
    if (!reference || text === undefined) return `The frozen snapshot for ${path} is unavailable.`;
    referenced.push({ id: reference.id, kind: "referenced_file", path, sha256: reference.sha256, text });
  }
  return [...prompts, ...referenced];
}

function normalizeAdoptionPaths(values: readonly string[]): Set<string> | string {
  const normalized = values.map(normalizeRequirementSourcePath);
  if (normalized.some((path) => !path)) return "adopt_changed_paths contains an invalid requirement-source path.";
  return new Set(normalized as string[]);
}

function validateAdoptions(
  self: TaskVerificationController,
  selectedPaths: readonly string[],
  adoptionPaths: ReadonlySet<string>,
): string | undefined {
  const normalizedSelected = new Set(selectedPaths.map(normalizeRequirementSourcePath));
  const existingPaths = new Set((self.state.requirementSourceRefs ?? []).map((reference) => reference.path));
  for (const path of adoptionPaths) {
    if (!normalizedSelected.has(path) || !existingPaths.has(path)) {
      return `adopt_changed_paths may only name an already frozen selected path: ${path}.`;
    }
    if (!isExplicitRequirementSourceAdoption(self.latestUserPrompt, path)) {
      return `The latest direct user prompt does not explicitly authorize adopting the changed contents of ${path}.`;
    }
  }
  return undefined;
}

function orderReferences(
  selectedPaths: readonly string[],
  references: readonly TaskVerificationRequirementSourceRef[],
): TaskVerificationRequirementSourceRef[] {
  return selectedPaths.map((path) => references.find((reference) => reference.path === path)!);
}
