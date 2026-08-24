import { MAX_REQUIREMENT_COUNT } from "../constants.ts";
import {
  computeRequirementSetHash,
  computeStateUserRequirementsHash,
  requirementDefinitionMatchesState,
} from "../requirement-audit-hashing.ts";
import {
  formatRequirementDefinitionDiagnostics,
  validateRequirementDefinition,
} from "../requirement-definition-validation.ts";
import { requirementDefinitionSources } from "../requirement-source-storage.ts";
import { emptyReadiness } from "../state-factories.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { RequirementAuditInput, VerificationResult } from "../types.ts";
import { definitionContextError } from "./requirement-audit-context.ts";
import { formatRequirementBatchPrompt, formatRequirementProofPlan } from "./requirement-audit-prompt.ts";

export function do_defineRequirements(
  self: TaskVerificationController,
  input: RequirementAuditInput,
): VerificationResult {
  const contextError = definitionContextError(self);
  if (contextError) return self.rejected(contextError);
  if (self.state.requirementAudit.status !== "awaiting_definition" && requirementDefinitionMatchesState(self.state)) {
    return self.rejected("Requirement definitions are already fixed for this user-requirements hash.");
  }

  const prompts = requirementDefinitionSources(self.state, self.requirementSourceTexts);
  if (typeof prompts === "string") return self.rejected(prompts);
  const requested = input.requirements ?? [];
  if (requested.length === 0) return self.rejected("define requires at least one atomic requirement.");
  if (requested.length > MAX_REQUIREMENT_COUNT) {
    return self.rejected(`define supports at most ${MAX_REQUIREMENT_COUNT} atomic requirements.`);
  }
  const validation = validateRequirementDefinition(prompts, input);
  if (!validation.definition) {
    return {
      ...self.rejected(formatRequirementDefinitionDiagnostics(validation.diagnostics)),
      requirementDefinitionDiagnosticCount: validation.diagnostics.length,
    };
  }
  const { requirements, ignoredSourcePrompts, ignoredSourceClauses } = validation.definition;

  const userRequirementsHash = computeStateUserRequirementsHash(self.state);
  const requirementSetHash = computeRequirementSetHash(requirements, ignoredSourcePrompts, ignoredSourceClauses);
  self.state = {
    ...self.state,
    requirementAudit: {
      status: "verifying",
      requirements,
      ignoredSourcePrompts,
      ignoredSourceClauses,
      nextRequirementIndex: 0,
      userRequirementsHash,
      requirementSetHash,
    },
    readiness: { ...(self.state.readiness ?? emptyReadiness()), requirementSetHash },
    updatedAt: new Date().toISOString(),
  };
  self.persistState();
  const proofPlan = formatRequirementProofPlan(requirements);
  return self.updated(
    self.state.mutationRevision === 0
      ? [
          `Defined ${requirements.length} atomic requirement(s) before production mutation. Implementation may proceed.`,
          "Structural preflight: ready_to_finish blocks mutated source files over 250 physical lines unless the user explicitly overrides the file-size limit. Plan focused modules before implementation and complete any required split before final verification.",
          proofPlan,
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n")
      : `Defined ${requirements.length} atomic requirement(s).\n\n${formatRequirementBatchPrompt(requirements)}`,
    false,
  );
}
