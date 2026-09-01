import type { ToolDefinition } from "../../extensions/types.ts";
import {
  EvidenceVerificationSchema,
  REQUIREMENT_AUDIT_TOOL_NAME,
  TASK_VERIFICATION_TOOL_NAME,
  VerificationSchema,
} from "../constants.ts";
import { rejectedDefinitionNextActionGuardMessage } from "../requirement-definition-repair.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import type { EvidenceVerificationInput, VerificationInput, VerificationResult } from "../types.ts";

export function createTaskVerificationToolDefinition(
  self: TaskVerificationController,
): ToolDefinition<typeof VerificationSchema | typeof EvidenceVerificationSchema, VerificationResult> {
  return {
    name: TASK_VERIFICATION_TOOL_NAME,
    label: "Task Verification",
    description:
      self.mode === "evidence"
        ? 'Record or inspect fresh evidence and finish readiness for mutating tasks. Use action "status" whenever the next step is unclear.'
        : 'Record or inspect evidence-backed baseline, final semantic verification, and finish readiness for mutating tasks. Use action "status" whenever the required next step is unclear, especially after compaction or session restore.',
    promptSnippet:
      self.mode === "evidence"
        ? "record_task_verification(action, ...): map one completion checklist to fresh evidence before successful finish_work."
        : "record_task_verification(action, ...): declare mutation intent, prove baseline and final behavior, then call ready_to_finish with requirement-to-evidence mappings before successful finish_work.",
    promptGuidelines: self.mode === "evidence" ? evidenceGuidelines() : auditGuidelines(),
    parameters: self.mode === "evidence" ? EvidenceVerificationSchema : VerificationSchema,
    executionMode: "sequential",
    execute: async (_id, params) => {
      if (params.action !== "status" && self.restoreError) {
        const result = self.rejected(`Cannot update task verification: ${self.restoreError}.`);
        return { content: [{ type: "text" as const, text: result.message }], details: result };
      }
      if (self.mode === "audit" && params.action !== "status" && self.rejectedRequirementDefinitionDraft) {
        const result = self.rejected(rejectedDefinitionNextActionGuardMessage(self.rejectedRequirementDefinitionDraft));
        return { content: [{ type: "text" as const, text: result.message }], details: result };
      }
      const result = self.applyInput(params as VerificationInput | EvidenceVerificationInput);
      const message = result.status === "needs_action" ? self.withGuidance(result.message) : result.message;
      return { content: [{ type: "text" as const, text: message }], details: result };
    },
  };
}

function evidenceGuidelines(): string[] {
  return [
    `Call ${TASK_VERIFICATION_TOOL_NAME} with action "status" after compaction or whenever the completion gate is unclear.`,
    "After discovery and before the first workspace, external, or publication mutation, record exactly one concise completion_checklist of observable requested outcomes and failure boundaries. Batch that tool call immediately before the first mutation when possible.",
    "The checklist is not a clause matrix: group related behavior, omit clause IDs, and keep test commands, typechecks, builds, and generic file completeness as evidence rather than acceptance behavior.",
    'For an exact non-code file artifact, use the anchored checklist form `relative/path has exact bytes with a terminal newline; exact_file_bytes("relative/path","JSON-escaped UTF-8 text")` (or `with no terminal newline`) without repeating quoted content; later prove it with a literal diff or cmp assertion against that same task-owned path.',
    "When an authoritative format contract requires both a terminal delimiter and rejection of any truncation, include the exact boundary: removing only the final delimiter byte must be rejected.",
    "Evidence handles from prior mutation revisions become stale after any file edit. Rerun verification after the final mutation.",
    "Changed tests must pass a direct applicable test command before publication or successful completion.",
    "Complete every explicitly requested named artifact before final verification; a later write invalidates readiness.",
    "When the user requests tests or type checking, map successful current-revision evidence for each requested check.",
    "Call action 'ready_to_finish' once with evidence_refs_by_check aligned by index to the frozen completion checklist. Critical boundaries require focused selectors and the controller-provided same-run proof witness; a generic full-suite result or matching test name alone is insufficient.",
    "Do not classify task kinds, define atomic requirements, infer high-risk clauses, or call record_requirement_audit in evidence mode.",
    "Successful finish_work may omit verification_token for controller autofill; if supplied, it must exactly match the token returned by ready_to_finish.",
  ];
}

function auditGuidelines(): string[] {
  return [
    `Call ${TASK_VERIFICATION_TOOL_NAME} with action "status" at any time to recover the exact current requirement, eligible evidence handles, and next tool-call shape. Do this after compaction or whenever a gate is unclear.`,
    `The controller automatically records unambiguous mutation intent before the first mutating tool call. If that gate reports an ambiguous mixed effect, call ${TASK_VERIFICATION_TOOL_NAME} once with action "declare_task" and the dominant requested effect, then retry the mutation.`,
    "Workflow steps: 1. freeze selected requirement sources and collect the required baseline -> 2. apply file edits -> 3. rerun the exact baseline command -> 4. obtain the accepted complete requirement definition and verdict batch. Source-free tasks define before mutation; selecting any authoritative source defers the combined source-and-direct definition until evidence readiness. A successful exact replay automatically records final verification.",
    'When using static_trace for record_baseline, you MUST provide at least two non-error inspection evidence handles (e.g. evidence_refs: ["verification-evidence-1", "verification-evidence-2"]).',
    "Bug fixes, behavior changes, and refactors require evidence-backed baseline verification before production mutation.",
    'To create a failing regression test before implementation, authorize exact test paths with action "authorize_baseline_test"; only those test files may be edited until the failing focused test is recorded.',
    "Signal, restart, persistence, recovery, transaction, concurrency, migration, and indexing tasks require runtime reproduction or a failing focused regression test.",
    "Final verification must rerun the exact same reproduction command or focused regression test that established the baseline. Do not substitute static_review or generic npm run check.",
    "Evidence handles from prior mutation revisions become stale after any file edit. Re-run your verification command after editing to produce fresh handles for the current revision.",
    "Complete all requested file deliverables before final verification; any later write or edit advances the mutation revision and invalidates earlier evidence and readiness.",
    "When no exact baseline replay exists, record_final may omit evidence_refs and descriptive fields; the controller selects the latest eligible current-revision evidence and derives the method and observations.",
    "After final verification passes, call action 'ready_to_finish' with acceptance_checks and fresh evidence_refs. This opens finalization operations but does not issue a finish token.",
    `Then follow ${REQUIREMENT_AUDIT_TOOL_NAME}: record one complete evidence-backed verdict batch for the existing set; define only when the controller explicitly reports that no reusable definition exists.`,
    "Git commit/push require evidence readiness. Successful finish_work requires the later completion certificate and exact verification_token.",
  ];
}
