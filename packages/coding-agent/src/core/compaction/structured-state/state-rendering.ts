import type { EvidencePointer } from "../compaction.ts";
import {
  COMPARABLE_TEXT_STOP_WORDS,
  NORMALIZE_ACTION_REGEX,
  NORMALIZE_PARENS_REGEX,
  NORMALIZE_PREFIX_REGEX,
  NORMALIZE_SPACE_REGEX,
  normalizationCache,
  TERM_SPLIT_REGEX,
  termsCache,
} from "./constants.ts";
import {
  collectOriginalUserRequests,
  createPlainSummaryFallback,
  extractBulletLines,
  extractLooseSections,
  extractOptionalSection,
  extractSection,
  findLatestActionableRequest,
  isPlaceholderGoal,
  normalizeCanonicalRequest,
} from "./state-extraction.ts";
import type {
  Decision,
  OriginalUserRequest,
  StatePatch,
  StructuredSessionState,
  StructuredStateUpdateInput,
  TouchedFile,
} from "./types.ts";

export function createStableId(prefix: string, text: string): string {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${prefix}-${(hash >>> 0).toString(16)}`;
}

export function extractDecisions(markdown: string): Decision[] {
  const decisionText = [
    extractOptionalSection(markdown, "Key Decisions"),
    extractOptionalSection(markdown, "Decisions"),
    ...extractLooseSections(markdown, ["Key Decisions", "Decisions"]),
  ]
    .filter((value): value is string => value !== undefined && value.trim().length > 0)
    .join("\n");
  const seen = new Set<string>();
  const decisions: Decision[] = [];
  for (const line of extractBulletLines(decisionText)) {
    const normalized = line.replace(/^\*\*(.*?)\*\*:\s*/, "$1: ");
    const [decision, ...rationaleParts] = normalized.split(": ");
    const rationale = rationaleParts.join(": ").trim();
    const id = createStableId("decision", normalized);
    if (seen.has(id)) continue;
    seen.add(id);
    decisions.push({
      id,
      decision: decision.trim() || normalized,
      rationale,
      evidencePointers: [],
      status: "active",
    });
  }
  return decisions;
}

export function createEvidencePointers(input: StructuredStateUpdateInput): EvidencePointer[] {
  const pointers: EvidencePointer[] = [];
  for (const entry of input.entries) {
    if (entry.type === "message" && entry.message.role === "toolResult") {
      pointers.push({
        id: `tool-result:${entry.message.toolCallId}`,
        kind: "tool_result",
        entryId: entry.id,
        summary: `${entry.message.toolName} ${entry.message.isError ? "error" : "success"} result`,
        retrieveWhen: `Need exact raw output from ${entry.message.toolName}.`,
      });
    } else if (entry.type === "message" && entry.message.role === "bashExecution") {
      pointers.push({
        id: `bash:${entry.id}`,
        kind: "bash",
        entryId: entry.id,
        summary: `Bash command: ${entry.message.command}`,
        retrieveWhen: "Need exact bash command output.",
      });
    }
  }
  for (const file of input.readFiles ?? []) {
    pointers.push({
      id: `file:${createStableId("path", file)}`,
      kind: "file",
      path: file,
      summary: `Read file ${file}`,
      retrieveWhen: "Need exact file content read earlier in the session.",
    });
  }
  return pointers;
}

export function mergeStringList(existing: string[], incoming: string[] | undefined): string[] {
  if (!incoming) return existing;
  const seen = new Set(existing);
  const result = [...existing];
  for (const item of incoming) {
    const trimmed = item.trim();
    if (trimmed && !seen.has(trimmed)) {
      result.push(trimmed);
      seen.add(trimmed);
    }
  }
  return result;
}

export function createStatePatchFromSummary(input: StructuredStateUpdateInput): StatePatch {
  const timestamp = input.timestamp ?? new Date().toISOString();
  const sourceEntryIds = input.entries.map((entry) => entry.id).filter((id) => id.length > 0);
  const summaryGoal = extractSection(input.summary, "Goal").trim();
  const originalRequests = collectOriginalUserRequests(
    input.entries,
    input.previous?.canonicalRequest.originalRequests,
  );
  const latestCorrection = [...originalRequests].reverse().find((request) => request.kind === "correction");
  const latestRequest = [...originalRequests].reverse().find((request) => request.kind !== "correction");
  const latestActionableRequest = findLatestActionableRequest(originalRequests);
  const normalizedSummaryGoal = normalizeCanonicalRequest(summaryGoal);
  const goal =
    normalizeCanonicalRequest(latestCorrection?.summary ?? "") ||
    normalizeCanonicalRequest(latestActionableRequest?.summary ?? "") ||
    (isPlaceholderGoal(normalizedSummaryGoal) ? "" : normalizedSummaryGoal) ||
    normalizeCanonicalRequest(input.previous?.canonicalRequest.current ?? "") ||
    normalizeCanonicalRequest(latestRequest?.summary ?? "") ||
    createPlainSummaryFallback(input.summary);
  const decisions = extractDecisions(input.summary);
  const evidence = createEvidencePointers(input);
  const touchedFiles = [
    ...(input.readFiles ?? []).map(
      (path): TouchedFile => ({
        path,
        status: "read",
        summary: "Read during compacted session history.",
      }),
    ),
    ...(input.modifiedFiles ?? []).map(
      (path): TouchedFile => ({
        path,
        status: "modified",
        summary: "Modified during compacted session history.",
      }),
    ),
  ];

  return {
    canonicalRequest: goal
      ? {
          current: goal,
          sourceEntryIds: mergeStringList(
            sourceEntryIds,
            originalRequests.map((request) => request.entryId),
          ),
          originalRequests,
        }
      : undefined,
    decisions: decisions.length > 0 ? { add: decisions } : undefined,
    codebase: touchedFiles.length > 0 ? { touchedFiles, relevantSymbols: [] } : undefined,
    evidence: evidence.length > 0 ? { add: evidence } : undefined,
    audit: {
      lastCompactionAt: timestamp,
      compactionCount: (input.previous?.audit.compactionCount ?? 0) + 1,
      knownRisks: input.audit?.risks ?? [],
    },
  };
}

export function normalizePatchGoal(goal: string): string {
  const normalized = normalizeCanonicalRequest(goal);
  return isPlaceholderGoal(normalized) ? "" : normalized;
}

export function mergeOriginalRequests(
  existing: OriginalUserRequest[],
  incoming: OriginalUserRequest[],
): OriginalUserRequest[] {
  const byId = new Map(existing.map((request) => [request.id, { ...request }]));
  for (const request of incoming) {
    byId.set(request.id, { ...request });
  }
  return [...byId.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

export function mergeCanonicalRequest(
  state: StructuredSessionState,
  patch: Partial<StructuredSessionState["canonicalRequest"]>,
): void {
  const current = normalizePatchGoal(patch.current ?? "");
  if (current && current !== state.canonicalRequest.current) {
    if (state.canonicalRequest.current) {
      state.canonicalRequest.superseded.push({
        old: state.canonicalRequest.current,
        replacedBy: current,
        reason: "Compaction summary updated canonical goal.",
        entryId: patch.sourceEntryIds?.at(-1) ?? "",
      });
    }
    state.canonicalRequest.current = current;
  }
  state.canonicalRequest.sourceEntryIds = mergeStringList(state.canonicalRequest.sourceEntryIds, patch.sourceEntryIds);
  state.canonicalRequest.originalRequests = mergeOriginalRequests(
    state.canonicalRequest.originalRequests ?? [],
    patch.originalRequests ?? [],
  );
  state.canonicalRequest.superseded = [...state.canonicalRequest.superseded, ...(patch.superseded ?? [])];
}

export function mergeConstraints(state: StructuredSessionState, patch: NonNullable<StatePatch["constraints"]>): void {
  const byId = new Map(state.constraints.map((constraint) => [constraint.id, constraint]));
  for (const constraint of patch.add ?? []) {
    if (!byId.has(constraint.id)) {
      state.constraints.push({ ...constraint });
      byId.set(constraint.id, constraint);
    }
  }
  for (const update of patch.update ?? []) {
    const current = byId.get(update.id);
    if (!current) continue;
    if (current.status === "active" && update.patch.status && update.patch.status !== "active") {
      continue;
    }
    Object.assign(current, update.patch);
  }
}

export function normalizeComparableText(text: string): string {
  let cached = normalizationCache.get(text);
  if (cached !== undefined) return cached;

  // Reset cache if it gets too large to prevent memory leak
  if (normalizationCache.size > 2000) normalizationCache.clear();

  cached = text
    .toLowerCase()
    .replace(NORMALIZE_PREFIX_REGEX, "")
    .replace(NORMALIZE_ACTION_REGEX, "")
    .replace(NORMALIZE_PARENS_REGEX, "")
    .replace(NORMALIZE_SPACE_REGEX, " ")
    .trim();
  normalizationCache.set(text, cached);
  return cached;
}

export function comparableTerms(text: string): Set<string> {
  let cached = termsCache.get(text);
  if (cached !== undefined) return cached;

  // Reset cache if it gets too large to prevent memory leak
  if (termsCache.size > 2000) termsCache.clear();

  cached = new Set(
    text
      .split(TERM_SPLIT_REGEX)
      .map((term) => term.trim())
      .filter((term) => term.length > 1 && !COMPARABLE_TEXT_STOP_WORDS.has(term)),
  );
  termsCache.set(text, cached);
  return cached;
}

export function _scoreNormalizedComparableText(
  normalizedLeft: string,
  leftTerms: Set<string>,
  normalizedRight: string,
  rightTerms: Set<string>,
): number {
  if (normalizedLeft === normalizedRight) return 1;
  if (normalizedLeft.length >= 12 && normalizedRight.length >= 12) {
    if (normalizedLeft.includes(normalizedRight) || normalizedRight.includes(normalizedLeft)) {
      return 0.95;
    }
  }
  if (leftTerms.size === 0 || rightTerms.size === 0) return 0;
  let shared = 0;
  for (const term of leftTerms) {
    if (rightTerms.has(term)) {
      shared++;
    }
  }
  if (shared < 2) return 0;
  const containment = shared / Math.min(leftTerms.size, rightTerms.size);
  const dice = (2 * shared) / (leftTerms.size + rightTerms.size);
  return Math.max(containment >= 0.8 ? containment : 0, dice);
}
