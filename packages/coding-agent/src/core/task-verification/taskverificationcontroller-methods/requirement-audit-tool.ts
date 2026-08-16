import type { ToolDefinition } from "../../extensions/types.ts";
import { REQUIREMENT_AUDIT_TOOL_NAME, RequirementAuditSchema } from "../constants.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { VerificationResult } from "../types.ts";

export function do_createRequirementAuditToolDefinition(
  self: TaskVerificationController,
): ToolDefinition<typeof RequirementAuditSchema, VerificationResult> {
  return {
    name: REQUIREMENT_AUDIT_TOOL_NAME,
    label: "Requirement Audit",
    description:
      "Define authoritative atomic user requirements after evidence readiness, then record exactly one evidence-backed verdict per model turn.",
    promptSnippet:
      "Define atomic user requirements and verify them sequentially before a completion certificate can be issued.",
    promptGuidelines: [
      "Use action 'define' only when ready_to_finish asks for decomposition of the verbatim source prompts.",
      "Include only user requirements; do not invent best practices or duplicate repository policy gates.",
      "Reference every source prompt by 1-based index or explain why a non-task prompt is ignored.",
      "The controller assigns stable R1, R2, ... IDs; never supply IDs during definition.",
      "Record exactly one verdict per model turn, in controller order, with a reason for both true and false.",
      "Every passed verdict requires current non-error evidence_refs. Continue through all requirements after failures.",
    ],
    parameters: RequirementAuditSchema,
    executionMode: "sequential",
    execute: async (_id, params) => {
      const result = self.applyRequirementAudit(params);
      return { content: [{ type: "text", text: result.message }], details: result };
    },
  };
}
