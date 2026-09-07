import type { ToolDefinition } from "../../extensions/types.ts";
import {
  EvidenceVerificationSchema,
  REQUIREMENT_AUDIT_TOOL_NAME,
  TASK_VERIFICATION_TOOL_NAME,
  VerificationSchema,
} from "../constants.ts";
import { inputCanRecoverStaleSourceOutputAuthorization } from "../critical-proof-source-output-revalidation.ts";
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
        ? 'Classify unrecognized requested intent, record one completion checklist for response-only or mutating tasks, and inspect fresh evidence and finish readiness. Use action "status" whenever the next step is unclear.'
        : 'Record or inspect evidence-backed baseline, final semantic verification, and finish readiness for mutating tasks. Use action "status" whenever the required next step is unclear, especially after compaction or session restore.',
    promptSnippet:
      self.mode === "evidence"
        ? "record_task_verification(action, ...): classify only unrecognized intent, record one completion checklist, then let the controller validate one current evidence batch before successful finish_work."
        : "record_task_verification(action, ...): declare mutation intent, prove baseline and final behavior, then call ready_to_finish with requirement-to-evidence mappings before successful finish_work.",
    promptGuidelines: self.mode === "evidence" ? evidenceGuidelines() : auditGuidelines(),
    parameters: self.mode === "evidence" ? EvidenceVerificationSchema : VerificationSchema,
    executionMode: "sequential",
    execute: async (_id, params) => {
      if (
        params.action !== "status" &&
        self.restoreError &&
        !inputCanRecoverStaleSourceOutputAuthorization(self, params)
      ) {
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
    'When zero-effect completion reports unclassified requested intent, call action "declare_task" once with the dominant effect. Use task_kind "investigation" only for a user-visible answer with no workspace or external effect; the same-prompt declaration cannot be changed.',
    "After discovery and before the first workspace, external, or publication mutation, record exactly one concise completion_checklist of observable requested outcomes and failure boundaries. Batch that tool call immediately before the first mutation when possible.",
    'For a response-only task, record exactly one completion_checklist after discovery and before finish_work, set verification_scope to "response_only", and do not call ready_to_finish.',
    'Set verification_scope from requested effects, not prompt language: "runtime_behavior" for executable behavior, "non_runtime_content" for documents/reports/static artifacts, "external_operation" for sends/schedules/approvals, and "response_only" only for a user-visible answer with no workspace or external effect. Omission is fail-closed runtime behavior.',
    "The checklist is not a clause matrix: group related behavior, omit clause IDs, and keep test commands, typechecks, builds, and generic file completeness as evidence rather than acceptance behavior.",
    "Before submitting the checklist, reread the user request and authoritative sources once. Within each selected behavior or failure boundary, preserve explicit qualifiers such as exactly/only/all, order, cardinality, atomicity, approval, timing, and named rejection boundaries; the controller does not reconstruct an exhaustive free-text clause matrix.",
    "When a referenced authoritative source is not recognized from an explicit prompt cue, include up to three relative paths in authoritative_source_paths in the same checklist call. The controller accepts only referenced, existing, safe Git-tracked files; an ordinary read never promotes an output target into a source.",
    "Only when the user explicitly asks to edit, move, or delete a selected authoritative source itself, require a standalone [source-output:relative/path] line in the latest direct user prompt. Then include that path in source_output_paths and name the exact path in one output-specific checklist item in the same pre-mutation call. If the marker is absent, ask the user for that exact standalone line. This prompt-epoch binding freezes the original authority while normal evidence verifies the requested output; never infer permission from action words or use it merely to silence a changed-source diagnostic.",
    "When the latest user instruction de-authorizes a previously selected source in any language, include its relative path in deauthorized_source_paths. Re-selecting it later in authoritative_source_paths explicitly reauthorizes it.",
    'For an exact non-code file artifact, use the anchored checklist form `relative/path has exact bytes with a terminal newline; exact_file_bytes("relative/path","JSON-escaped UTF-8 text")` (or `with no terminal newline`) without repeating quoted content; later prove it with a literal diff or cmp assertion against that same task-owned path.',
    "When an authoritative format contract requires both a terminal delimiter and rejection of any truncation, include the exact boundary: removing only the final delimiter byte must be rejected.",
    "Evidence handles from prior mutation revisions become stale after any file edit. Rerun verification after the final mutation.",
    "Changed tests must pass a direct applicable test command before publication or successful completion.",
    "Complete every explicitly requested named artifact before final verification; a later write invalidates readiness.",
    "When the user requests tests or type checking, run each requested check successfully after the final mutation; the controller selects the evidence automatically.",
    "A metadata-only external-effect receipt remains eligible after later effects. The controller associates each receipt with at most one distinct checklist item. It proves the exact checklist form `External effect [N] via tool TOOL completes successfully` (or `The requested external effect completes successfully`). A semantic remote outcome also requires a later declared readback whose tool returns native taskVerificationReadback proof bound to the write tool call and exact checklist criterion. A later receipt-bound outcome `not_confirmed` invalidates the earlier confirmation but never proves readiness. Shell, file, negative, wrong-resource, and unconfirmed reads do not prove remote state.",
    "After the final successful effect and final verification commands, call action 'ready_to_finish' once without manually mapping evidence handles. The controller selects one current evidence batch. Critical boundaries still require focused selectors and the controller-provided same-run proof witness; a generic full-suite result or matching test name alone is insufficient.",
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
