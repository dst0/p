import type { EvidencePointer } from "../compaction.ts";
import { STATE_RENDER_MARKERS } from "./constants.ts";
import { capSentence, compactWhitespace, isRecord } from "./helpers-part1.ts";
import { createStableId, mergeStringList } from "./helpers-part2.ts";
import { parsePlanStatus } from "./helpers-part4.ts";
import type {
  Constraint,
  ConstraintEnforceability,
  ConstraintSource,
  ConstraintStatus,
  Decision,
  EvidenceKind,
  FileTouchStatus,
  PlanItem,
  PlanStatus,
  StatePatch,
  TouchedFile,
} from "./types.ts";

export function getStringField(record: Record<string, unknown>, keys: string[]): string {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
    if (isRecord(value) && typeof value.current === "string" && value.current.trim().length > 0) {
      return value.current.trim();
    }
  }
  return "";
}

export function parseConstraintSource(value: unknown): ConstraintSource {
  return value === "user" || value === "system" || value === "project" || value === "inferred" ? value : "inferred";
}

export function parseConstraintStatus(value: unknown): ConstraintStatus {
  return value === "active" || value === "superseded" || value === "rejected" ? value : "active";
}

export function parseConstraintEnforceability(value: unknown): ConstraintEnforceability {
  return value === "prompt" || value === "runtime_check" || value === "test" || value === "manual" ? value : "prompt";
}

export function parseConstraints(value: unknown): Constraint[] {
  if (!Array.isArray(value)) return [];
  const constraints: Constraint[] = [];
  for (const item of value) {
    const text = typeof item === "string" ? item : isRecord(item) ? getStringField(item, ["text", "constraint"]) : "";
    if (!text) continue;
    const source = isRecord(item) ? parseConstraintSource(item.source) : "inferred";
    const status = isRecord(item) ? parseConstraintStatus(item.status) : "active";
    const enforceability = isRecord(item) ? parseConstraintEnforceability(item.enforceability) : "prompt";
    const id = isRecord(item)
      ? getStringField(item, ["id"]) || createStableId("constraint", text)
      : createStableId("constraint", text);
    constraints.push({
      id,
      text: capSentence(compactWhitespace(text), 320),
      source,
      status,
      enforceability,
    });
  }
  return constraints;
}

export function parsePlanStatusValue(value: unknown): PlanStatus {
  if (typeof value !== "string") return "not_started";
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[\s-]+/g, "_");
  switch (normalized) {
    case STATE_RENDER_MARKERS.done:
    case "done":
    case "complete":
    case "completed":
      return "done";
    case STATE_RENDER_MARKERS.inProgress:
    case "in_progress":
    case "current":
    case "active":
      return "in_progress";
    case STATE_RENDER_MARKERS.failed:
    case "failed":
    case "fail":
      return "failed";
    case STATE_RENDER_MARKERS.blocked:
    case "blocked":
    case "blocker":
      return "blocked";
    case STATE_RENDER_MARKERS.notStarted:
    case "not_started":
    case "todo":
    case "pending":
      return "not_started";
    default:
      return parsePlanStatus(value);
  }
}

export function parseStringList(value: unknown): string[] {
  if (typeof value === "string" && value.trim().length > 0) {
    return [value.trim()];
  }
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
    .map((item) => item.trim());
}

export function getStringListField(record: Record<string, unknown>, keys: string[]): string[] {
  for (const key of keys) {
    const value = record[key];
    const parsed = parseStringList(value);
    if (parsed.length > 0) return parsed;
  }
  return [];
}

export function parsePlanItemsFromUpdate(
  value: unknown,
  sourceEntryIds: string[],
): Array<PlanItem & { op?: "add" | "update" | "remove" }> {
  const rawItems = Array.isArray(value)
    ? value
    : isRecord(value) && Array.isArray(value.items)
      ? value.items
      : isRecord(value) && Array.isArray(value.add)
        ? value.add
        : [];
  const items: Array<PlanItem & { op?: "add" | "update" | "remove" }> = [];
  for (const item of rawItems) {
    const text = typeof item === "string" ? item : isRecord(item) ? getStringField(item, ["text", "item", "task"]) : "";
    if (!text) continue;
    const status = isRecord(item) ? parsePlanStatusValue(item.status ?? item.state) : "not_started";
    const op = isRecord(item)
      ? (getStringField(item, ["op", "operation"]) as "add" | "update" | "remove" | undefined)
      : undefined;
    const entryIds = isRecord(item) ? getStringListField(item, ["evidenceEntryIds", "evidence_entry_ids"]) : [];
    const parentId = isRecord(item)
      ? getStringField(item, ["parentId", "parent_id", "parent"]) || undefined
      : undefined;
    items.push({
      id: isRecord(item) ? getStringField(item, ["id"]) || createStableId("plan", text) : createStableId("plan", text),
      text: capSentence(compactWhitespace(text), 280),
      status,
      parentId,
      op,
      evidenceEntryIds: mergeStringList([...sourceEntryIds], entryIds),
    });
  }
  return items;
}

export function parseDecisionsFromUpdate(value: unknown): Decision[] {
  if (!Array.isArray(value)) return [];
  const decisions: Decision[] = [];
  for (const item of value) {
    const decision =
      typeof item === "string" ? item : isRecord(item) ? getStringField(item, ["decision", "text", "summary"]) : "";
    if (!decision) continue;
    const rationale = isRecord(item) ? getStringField(item, ["rationale", "reason"]) : "";
    decisions.push({
      id: isRecord(item)
        ? getStringField(item, ["id"]) || createStableId("decision", decision)
        : createStableId("decision", decision),
      decision: capSentence(compactWhitespace(decision), 260),
      rationale: capSentence(compactWhitespace(rationale), 320),
      evidencePointers: [],
      status: "active",
    });
  }
  return decisions;
}

export function parseFileTouchStatus(value: unknown): FileTouchStatus {
  return value === "read" || value === "modified" || value === "created" || value === "deleted" ? value : "modified";
}

export function parseTouchedFilesFromUpdate(value: unknown): TouchedFile[] {
  if (!Array.isArray(value)) return [];
  const files: TouchedFile[] = [];
  for (const item of value) {
    const path = typeof item === "string" ? item : isRecord(item) ? getStringField(item, ["path", "file"]) : "";
    if (!path) continue;
    files.push({
      path,
      status: isRecord(item) ? parseFileTouchStatus(item.status) : "modified",
      summary: isRecord(item)
        ? getStringField(item, ["summary", "reason"]) || "Touched during this session."
        : "Touched during this session.",
    });
  }
  return files;
}

export function parseEvidenceKind(value: unknown): EvidenceKind {
  return value === "message" ||
    value === "tool_result" ||
    value === "bash" ||
    value === "file" ||
    value === "web" ||
    value === "artifact"
    ? value
    : "message";
}

export function parseEvidenceFromUpdate(value: unknown): EvidencePointer[] {
  if (!Array.isArray(value)) return [];
  const pointers: EvidencePointer[] = [];
  for (const item of value) {
    const summary =
      typeof item === "string" ? item : isRecord(item) ? getStringField(item, ["summary", "text", "description"]) : "";
    if (!summary) continue;
    const path = isRecord(item) ? getStringField(item, ["path"]) : "";
    pointers.push({
      id: isRecord(item)
        ? getStringField(item, ["id"]) || createStableId("evidence", `${path}:${summary}`)
        : createStableId("evidence", summary),
      kind: isRecord(item) ? parseEvidenceKind(item.kind) : "message",
      entryId: isRecord(item) ? getStringField(item, ["entryId", "entry_id"]) || undefined : undefined,
      path: path || undefined,
      summary: capSentence(compactWhitespace(summary), 260),
      retrieveWhen: isRecord(item)
        ? getStringField(item, ["retrieveWhen", "retrieve_when"]) || "Need exact supporting evidence."
        : "Need exact supporting evidence.",
    });
  }
  return pointers;
}

export function hasStatePatchContent(patch: StatePatch): boolean {
  return (
    patch.canonicalRequest !== undefined ||
    (patch.constraints?.add?.length ?? 0) > 0 ||
    (patch.constraints?.update?.length ?? 0) > 0 ||
    (patch.plan?.replace?.length ?? 0) > 0 ||
    (patch.plan?.add?.length ?? 0) > 0 ||
    (patch.plan?.update?.length ?? 0) > 0 ||
    (patch.decisions?.add?.length ?? 0) > 0 ||
    (patch.decisions?.supersede?.length ?? 0) > 0 ||
    (patch.codebase?.touchedFiles?.length ?? 0) > 0 ||
    (patch.codebase?.relevantSymbols?.length ?? 0) > 0 ||
    (patch.evidence?.add?.length ?? 0) > 0 ||
    patch.audit !== undefined
  );
}
