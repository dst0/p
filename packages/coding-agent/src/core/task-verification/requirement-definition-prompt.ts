import { REQUIREMENT_AUDIT_TOOL_NAME } from "./constants.ts";
import type { TaskVerificationSourcePrompt } from "./types.ts";

export function formatRequirementDefinitionPrompt(sourcePrompts: readonly TaskVerificationSourcePrompt[]): string {
  return [
    "REQUIREMENT AUDIT — DEFINE AUTHORITATIVE USER REQUIREMENTS",
    "Read each verbatim source prompt below. Decompose only user-authored requirements into atomic, independently verifiable items.",
    "Do not add repository policy, generic best practices, or requirements invented by the model.",
    "When prompts conflict, the later user instruction is authoritative. Preserve non-conflicting earlier requirements and reference every prompt index that informed the canonical requirement.",
    "Only ignore a whole prompt when it contains no surviving task requirement; explain whether it is non-task context or was fully superseded.",
    "Every source prompt index must be referenced by at least one requirement or listed in ignored_source_prompts with a concrete reason.",
    "The controller assigns R1, R2, ... IDs.",
    "",
    ...sourcePrompts.flatMap((prompt, index) => [
      `[Source prompt ${index + 1} | id=${prompt.id}]`,
      "<<<VERBATIM_USER_PROMPT",
      prompt.text,
      "VERBATIM_USER_PROMPT",
      "",
    ]),
    `Call ${REQUIREMENT_AUDIT_TOOL_NAME} with action "define", requirements, and ignored_source_prompts.`,
    "Do not submit a verdict in the same model turn.",
  ].join("\n");
}
