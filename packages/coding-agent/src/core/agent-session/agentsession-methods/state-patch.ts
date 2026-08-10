import { FINISH_WORK_TOOL_NAME } from "@dst0/p-agent-core";
import type { StatePatch, StructuredSessionState } from "../../compaction/index.ts";
import type { ToolDefinition } from "../../extensions/index.ts";
import type { AgentSession } from "../agentsession.ts";
import {
  MARK_SESSION_PROGRESS_SCHEMA,
  MARK_SESSION_PROGRESS_TOOL_NAME,
  UPDATE_SESSION_STATE_TOOL_NAME,
} from "../constants.ts";
import {
  capStateToolText,
  createStateToolStableId,
  hasStateToolPatchContent,
  normalizeStateText,
} from "../message-utils.ts";
import type { UpdateSessionStateInput } from "../session-types.ts";
import type { MarkSessionProgressInput, MarkSessionProgressResult } from "../state-types.ts";

export function do__createStatePatchFromUpdateSessionStateInput(
  _self: AgentSession,
  input: UpdateSessionStateInput,
  previous: StructuredSessionState,
  sourceEntryIds: string[],
  liveState: StructuredSessionState,
): StatePatch | undefined {
  if (input.action === "none") {
    return undefined;
  }
  const goal = normalizeStateText(input.goal ?? "");
  const rawPlanItems = (input.plan ?? [])
    .map((item) => ({
      op: item.op ?? "add",
      id: item.id?.trim() || createStateToolStableId("plan", item.text),
      parentId: item.parentId?.trim() || undefined,
      text: capStateToolText(item.text, 280),
      status: item.status ?? "not_started",
      evidenceEntryIds: [...sourceEntryIds],
    }))
    .filter((item) => item.text.length > 0);
  const planItemIdByReference = new Map<string, string>();
  for (const item of [...previous.plan, ...rawPlanItems]) {
    planItemIdByReference.set(normalizeStateText(item.id).toLowerCase(), item.id);
    planItemIdByReference.set(normalizeStateText(item.text).toLowerCase(), item.id);
  }
  for (const item of rawPlanItems) {
    if (!item.parentId) continue;
    const resolvedParentId = planItemIdByReference.get(normalizeStateText(item.parentId).toLowerCase());
    item.parentId = resolvedParentId && resolvedParentId !== item.id ? resolvedParentId : undefined;
  }
  const decisions = (input.decisions ?? [])
    .map((item) => ({
      id: createStateToolStableId("decision", item.decision),
      decision: capStateToolText(item.decision, 260),
      rationale: capStateToolText(item.rationale ?? "", 320),
      evidencePointers: [],
      status: "active" as const,
    }))
    .filter((item) => item.decision.length > 0);
  const touchedFiles = (input.touchedFiles ?? [])
    .map((file) => ({
      path: file.path.trim(),
      status: file.status ?? "modified",
      summary: capStateToolText(file.summary ?? "Touched during this session.", 320),
    }))
    .filter((file) => file.path.length > 0);
  const evidence = (input.evidence ?? [])
    .map((pointer) => ({
      id: createStateToolStableId("evidence", `${pointer.path ?? ""}:${pointer.summary}`),
      kind: pointer.kind ?? "message",
      path: normalizeStateText(pointer.path ?? "") || undefined,
      summary: capStateToolText(pointer.summary, 260),
      retrieveWhen: capStateToolText(pointer.retrieveWhen ?? "Need exact supporting evidence.", 260),
    }))
    .filter((pointer) => pointer.summary.length > 0);
  const risks = (input.risks ?? []).map((risk) => capStateToolText(risk, 260)).filter((risk) => risk.length > 0);
  const replaceCompletedPlan =
    input.action === "initial_plan" &&
    previous.plan.length > 0 &&
    previous.plan.every((item) => item.status === "done");
  const plan =
    rawPlanItems.length === 0
      ? undefined
      : input.action === "progress_update"
        ? {
            update: rawPlanItems.map((item) => ({
              id: item.id,
              matchText: item.text,
              text: item.text,
              status: item.status,
              evidenceEntryIds: item.evidenceEntryIds,
            })),
          }
        : replaceCompletedPlan
          ? { replace: rawPlanItems }
          : (() => {
              const addItems = rawPlanItems.filter((i) => i.op === "add");
              const updateItems = rawPlanItems
                .filter((i) => i.op === "update")
                .map((i) => ({
                  id: i.id,
                  matchText: i.text,
                  text: i.text,
                  status: i.status,
                  evidenceEntryIds: i.evidenceEntryIds,
                }));
              const removeItems = rawPlanItems
                .filter((i) => i.op === "remove")
                .map((i) => ({ id: i.id, text: i.text }));
              const p: NonNullable<StatePatch["plan"]> = {};
              if (addItems.length > 0) p.add = addItems;
              if (updateItems.length > 0) p.update = updateItems;
              if (removeItems.length > 0) p.remove = removeItems;
              return Object.keys(p).length > 0 ? p : undefined;
            })();
  const patch: StatePatch = {
    canonicalRequest:
      goal || liveState.canonicalRequest.originalRequests.length > 0
        ? {
            current: goal || undefined,
            sourceEntryIds,
            originalRequests: liveState.canonicalRequest.originalRequests,
          }
        : undefined,
    plan,

    decisions: decisions.length > 0 ? { add: decisions } : undefined,
    codebase: touchedFiles.length > 0 ? { touchedFiles, relevantSymbols: [] } : undefined,
    evidence: evidence.length > 0 ? { add: evidence } : undefined,
    audit: risks.length > 0 ? { knownRisks: risks } : undefined,
  };
  return hasStateToolPatchContent(patch) ? patch : undefined;
}

export function do__createMarkSessionProgressToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof MARK_SESSION_PROGRESS_SCHEMA, MarkSessionProgressResult> {
  return {
    name: MARK_SESSION_PROGRESS_TOOL_NAME,
    label: "Mark Session Progress",
    description: "Update the status of an existing session plan item without adding duplicate plan steps.",
    promptSnippet:
      "mark_session_progress(task, status): update an existing visible plan item by task text; use update_session_state replan for new tasks.",
    promptGuidelines: [
      "Use the exact visible task text from the working state whenever possible.",
      "Do not use this to create new plan items; call update_session_state with action replan when the task is new.",
      `Call ${MARK_SESSION_PROGRESS_TOOL_NAME} before ${FINISH_WORK_TOOL_NAME} after completing meaningful tool work.`,
    ],
    parameters: MARK_SESSION_PROGRESS_SCHEMA,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const result = self._applyMarkSessionProgress(params as MarkSessionProgressInput);
      return {
        content: [
          {
            type: "text",
            text:
              result.status === "updated"
                ? `Session progress updated. Task: ${result.matchedTask ?? result.task}.`
                : `Session progress task not found: ${result.task}. Call ${UPDATE_SESSION_STATE_TOOL_NAME} with action "replan" if this is new work.`,
          },
        ],
        details: result,
        isError: result.status === "not_found",
      };
    },
  };
}
