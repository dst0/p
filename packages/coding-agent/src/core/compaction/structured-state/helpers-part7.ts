import type { AgentMessage } from "@dst0/p-agent-core";
import { MAX_CANONICAL_REQUEST_CHARS } from "./constants.ts";
import { capSentence, compactWhitespace, isRecord } from "./helpers-part1.ts";
import { mergeStringList, normalizePatchGoal } from "./helpers-part2.ts";
import { createSessionStateUpdateBlockRegex, stripSessionStateUpdateBlocks } from "./helpers-part4.ts";
import {
  getStringField,
  getStringListField,
  hasStatePatchContent,
  parseConstraints,
  parseDecisionsFromUpdate,
  parseEvidenceFromUpdate,
  parsePlanItemsFromUpdate,
  parseTouchedFilesFromUpdate,
} from "./helpers-part6.ts";
import type { ParsedSessionStateUpdateBlock, StatePatch } from "./types.ts";

export function createStatePatchFromSessionStateUpdate(
  value: unknown,
  sourceEntryIds: string[],
): StatePatch | undefined {
  if (!isRecord(value)) {
    throw new Error("session_state_update must be an object");
  }
  if (value.type === "none") {
    return undefined;
  }
  if (value.type !== "patch") {
    throw new Error("session_state_update type must be none or patch");
  }

  const goal = normalizePatchGoal(getStringField(value, ["goal", "canonicalGoal", "canonicalRequest"]));
  const constraints = parseConstraints(value.constraints);
  const action = getStringField(value, ["action"]);
  const isReplaceAction = action === "initial_plan";
  const planItems = parsePlanItemsFromUpdate(value.plan ?? value.planItems, sourceEntryIds);
  const decisions = parseDecisionsFromUpdate(value.decisions);
  const touchedFiles = parseTouchedFilesFromUpdate(value.touchedFiles ?? value.touched_files ?? value.files);
  const plan =
    planItems.length > 0
      ? isReplaceAction
        ? { replace: planItems }
        : (() => {
            const addItems = planItems.filter((i) => !i.op || i.op === "add");
            const updateItems = planItems
              .filter((i) => i.op === "update")
              .map((i) => ({
                id: i.id,
                matchText: i.text,
                text: i.text,
                status: i.status,
                evidenceEntryIds: i.evidenceEntryIds,
              }));
            const removeItems = planItems.filter((i) => i.op === "remove").map((i) => ({ id: i.id, text: i.text }));
            const p: NonNullable<StatePatch["plan"]> = {};
            if (addItems.length > 0) p.add = addItems;
            if (updateItems.length > 0) p.update = updateItems;
            if (removeItems.length > 0) p.remove = removeItems;
            return Object.keys(p).length > 0 ? p : undefined;
          })()
      : undefined;
  const evidence = parseEvidenceFromUpdate(value.evidence ?? value.evidencePointers ?? value.evidence_pointers);
  const risks = getStringListField(value, ["risks", "knownRisks", "known_risks"]);
  const patch: StatePatch = {
    canonicalRequest: goal
      ? {
          current: capSentence(compactWhitespace(goal), MAX_CANONICAL_REQUEST_CHARS),
          sourceEntryIds,
        }
      : undefined,
    constraints: constraints.length > 0 ? { add: constraints } : undefined,
    plan,
    decisions: decisions.length > 0 ? { add: decisions } : undefined,
    codebase: touchedFiles.length > 0 ? { touchedFiles, relevantSymbols: [] } : undefined,
    evidence: evidence.length > 0 ? { add: evidence } : undefined,
    audit: risks.length > 0 ? { knownRisks: risks } : undefined,
  };
  return hasStatePatchContent(patch) ? patch : undefined;
}

export function mergeStatePatches(existing: StatePatch | undefined, incoming: StatePatch): StatePatch {
  if (!existing) return incoming;
  return {
    canonicalRequest: incoming.canonicalRequest ?? existing.canonicalRequest,
    constraints:
      existing.constraints || incoming.constraints
        ? {
            add: [...(existing.constraints?.add ?? []), ...(incoming.constraints?.add ?? [])],
            update: [...(existing.constraints?.update ?? []), ...(incoming.constraints?.update ?? [])],
          }
        : undefined,
    plan:
      existing.plan || incoming.plan
        ? {
            replace: incoming.plan?.replace ?? existing.plan?.replace,
            add: [...(existing.plan?.add ?? []), ...(incoming.plan?.add ?? [])],
            update: [...(existing.plan?.update ?? []), ...(incoming.plan?.update ?? [])],
          }
        : undefined,

    decisions:
      existing.decisions || incoming.decisions
        ? {
            add: [...(existing.decisions?.add ?? []), ...(incoming.decisions?.add ?? [])],
            supersede: [...(existing.decisions?.supersede ?? []), ...(incoming.decisions?.supersede ?? [])],
          }
        : undefined,
    codebase:
      existing.codebase || incoming.codebase
        ? {
            touchedFiles: [...(existing.codebase?.touchedFiles ?? []), ...(incoming.codebase?.touchedFiles ?? [])],
            relevantSymbols: [
              ...(existing.codebase?.relevantSymbols ?? []),
              ...(incoming.codebase?.relevantSymbols ?? []),
            ],
          }
        : undefined,
    evidence:
      existing.evidence || incoming.evidence
        ? {
            add: [...(existing.evidence?.add ?? []), ...(incoming.evidence?.add ?? [])],
          }
        : undefined,
    audit:
      existing.audit || incoming.audit
        ? {
            ...existing.audit,
            ...incoming.audit,
            knownRisks: mergeStringList(existing.audit?.knownRisks ?? [], incoming.audit?.knownRisks),
          }
        : undefined,
  };
}

export function parseSessionStateUpdateBlock(
  text: string,
  sourceEntryIds: string[] = [],
): ParsedSessionStateUpdateBlock {
  const matches = [...text.matchAll(createSessionStateUpdateBlockRegex())];
  if (matches.length === 0) {
    return { strippedText: text, malformed: false };
  }
  let patch: StatePatch | undefined;
  let malformed = false;
  let error: string | undefined;
  for (const match of matches) {
    const rawJson = match[1]?.trim() ?? "";
    try {
      const parsed: unknown = JSON.parse(rawJson);
      const nextPatch = createStatePatchFromSessionStateUpdate(parsed, sourceEntryIds);
      if (nextPatch) {
        patch = mergeStatePatches(patch, nextPatch);
      }
    } catch (caught) {
      malformed = true;
      error = caught instanceof Error ? caught.message : String(caught);
    }
  }
  return {
    strippedText: stripSessionStateUpdateBlocks(text),
    patch,
    malformed,
    error,
  };
}

export function getMessageTextForState(message: AgentMessage): string {
  switch (message.role) {
    case "user":
      return typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");
    case "assistant":
      return message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    case "toolResult":
      return message.content
        .filter((block) => block.type === "text")
        .map((block) => block.text)
        .join("\n");
    case "bashExecution":
      return `${message.command}\n${message.output}`;
    case "custom":
      return typeof message.content === "string"
        ? message.content
        : message.content
            .filter((block) => block.type === "text")
            .map((block) => block.text)
            .join("\n");
    case "branchSummary":
    case "compactionSummary":
      return message.summary;
  }
}
