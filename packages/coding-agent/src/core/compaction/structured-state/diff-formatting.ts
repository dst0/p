import { STATE_RENDER_MARKERS } from "./constants.ts";
import {
  createLiveConversationMarkdown,
  extractPlanItems,
  hasDurablePreviousGoal,
  mergeStructuredSessionState,
} from "./section-rendering.ts";
import {
  capSentence,
  collectOriginalUserRequests,
  compactWhitespace,
  createInitialStructuredSessionState,
  findLatestActionableRequest,
  normalizeCanonicalRequest,
} from "./state-extraction.ts";
import { findPlanItemByIdOrText } from "./state-formatting.ts";
import { createEvidencePointers, extractDecisions, mergeStringList } from "./state-rendering.ts";
import type {
  LiveStructuredStateInput,
  OrderedPlanItem,
  PlanItem,
  PlanStatus,
  StatePatch,
  StructuredSessionState,
} from "./types.ts";

export function createStatePatchFromLiveSession(input: LiveStructuredStateInput): StatePatch {
  const sourceEntryIds = input.entries.map((entry) => entry.id).filter((id) => id.length > 0);
  const originalRequests = collectOriginalUserRequests(
    input.entries,
    input.previous?.canonicalRequest.originalRequests,
  );
  const latestCorrection = [...originalRequests].reverse().find((request) => request.kind === "correction");
  const latestRequest = [...originalRequests].reverse().find((request) => request.kind !== "correction");
  const latestActionableRequest = findLatestActionableRequest(originalRequests);
  const previousGoal = normalizeCanonicalRequest(input.previous?.canonicalRequest.current ?? "");
  const preservePreviousGoal = hasDurablePreviousGoal(input.previous);
  const goal =
    normalizeCanonicalRequest(latestCorrection?.summary ?? "") ||
    (preservePreviousGoal ? "" : normalizeCanonicalRequest(latestActionableRequest?.summary ?? "")) ||
    previousGoal ||
    normalizeCanonicalRequest(latestRequest?.summary ?? "");
  const liveMarkdown = createLiveConversationMarkdown(input.entries);
  const planItems = extractPlanItems(liveMarkdown, sourceEntryIds);
  const decisions = extractDecisions(liveMarkdown);
  const evidence = createEvidencePointers({
    sessionId: input.sessionId,
    entries: input.entries,
    summary: liveMarkdown,
  });

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
      : originalRequests.length > 0
        ? { sourceEntryIds, originalRequests }
        : undefined,
    plan: planItems.length > 0 ? { add: planItems } : undefined,
    decisions: decisions.length > 0 ? { add: decisions } : undefined,
    evidence: evidence.length > 0 ? { add: evidence } : undefined,
  };
}

export function createLiveStructuredSessionState(input: LiveStructuredStateInput): StructuredSessionState {
  const previous = input.previous ?? createInitialStructuredSessionState(input.sessionId);
  const patch = createStatePatchFromLiveSession(input);
  return mergeStructuredSessionState(previous, patch);
}

export function planStatusPriority(status: PlanStatus): number {
  switch (status) {
    case "done":
      return 0;
    case "in_progress":
      return 1;
    case "failed":
      return 2;
    case "blocked":
      return 3;
    case "not_started":
      return 4;
  }
}

export function getOrderedPlanTree(plan: PlanItem[]): OrderedPlanItem[] {
  if (plan.length === 0) return [];

  const itemMap = new Map<string, PlanItem>();
  const childrenMap = new Map<string | undefined, PlanItem[]>();

  for (const item of plan) {
    itemMap.set(item.id, item);
  }

  for (const item of plan) {
    const parentId = item.parentId && itemMap.has(item.parentId) ? item.parentId : undefined;
    if (!childrenMap.has(parentId)) {
      childrenMap.set(parentId, []);
    }
    childrenMap.get(parentId)!.push(item);
  }

  const result: OrderedPlanItem[] = [];
  const visiting = new Set<string>();

  function traverse(parentId: string | undefined, depth: number) {
    const children = (childrenMap.get(parentId) ?? [])
      .slice()
      .sort((a, b) => planStatusPriority(a.status) - planStatusPriority(b.status));
    for (let i = 0; i < children.length; i++) {
      const child = children[i]!;
      if (visiting.has(child.id)) continue;
      visiting.add(child.id);
      const isLastChild = i === children.length - 1;
      result.push({
        item: child,
        depth,
        isLastChild,
        active: false,
      });
      traverse(child.id, depth + 1);
      visiting.delete(child.id);
    }
  }

  traverse(undefined, 0);

  const visited = new Set(result.map((r) => r.item.id));
  const orphans = plan
    .filter((item) => !visited.has(item.id))
    .sort((a, b) => planStatusPriority(a.status) - planStatusPriority(b.status));
  for (const item of orphans) {
    result.push({
      item,
      depth: 0,
      isLastChild: true,
      active: false,
    });
  }

  const activeCandidate = result.filter((r) => r.item.status === "in_progress").sort((a, b) => b.depth - a.depth)[0];

  if (activeCandidate) {
    activeCandidate.active = true;
  }

  return result;
}

export function findMatchingPlanItem(plan: PlanItem[], text: string): PlanItem | undefined {
  return findPlanItemByIdOrText(plan, undefined, text);
}

export function renderPlanStatusMarker(status: PlanStatus): string {
  switch (status) {
    case "done":
      return STATE_RENDER_MARKERS.done;
    case "in_progress":
      return STATE_RENDER_MARKERS.inProgress;
    case "failed":
      return STATE_RENDER_MARKERS.failed;
    case "blocked":
      return STATE_RENDER_MARKERS.blocked;
    case "not_started":
      return STATE_RENDER_MARKERS.notStarted;
  }
}

export function capPromptLine(text: string, maxChars: number): string {
  return capSentence(compactWhitespace(text), maxChars);
}

export function renderList(items: string[]): string[] {
  if (items.length === 0) return ["- (none)"];
  return items.map((item) => `- ${item}`);
}

export function capCheckpoint(checkpoint: string, maxTokens: number): string {
  const maxChars = Math.max(500, maxTokens * 4);
  if (checkpoint.length <= maxChars) return checkpoint;
  const suffix = `\nRisks:\n- ${STATE_RENDER_MARKERS.risk} checkpoint truncated to fit rendered state budget\n</session_checkpoint>`;
  const prefix = checkpoint.slice(0, Math.max(0, maxChars - suffix.length));
  const lastLineBreak = prefix.lastIndexOf("\n");
  return `${prefix.slice(0, lastLineBreak > 0 ? lastLineBreak : prefix.length)}${suffix}`;
}

export function renderStructuredSessionCheckpoint(state: StructuredSessionState, maxTokens: number): string {
  const orderedTree = getOrderedPlanTree(state.plan);
  const plan = orderedTree.slice(0, 12).map(({ item, depth, isLastChild, active }) => {
    const indent = depth > 0 ? `${"  ".repeat(depth - 1)}${isLastChild ? "└─ " : "├─ "}` : "";
    const activeText = active ? " 👈 (active)" : "";
    return `${indent}${renderPlanStatusMarker(item.status)} ${capPromptLine(item.text, 220)}${activeText}`;
  });
  const decisions = state.decisions
    .filter((decision) => decision.status === "active")
    .slice(-8)
    .map((decision) =>
      capPromptLine(`${decision.decision}${decision.rationale ? `: ${decision.rationale}` : ""}`, 240),
    );
  const touchedFiles = state.codebase.touchedFiles
    .slice(-20)
    .map((file) => `${file.status}: ${file.path} - ${capPromptLine(file.summary, 180)}`);
  const knownRisks = state.audit.knownRisks.map((risk) => `${STATE_RENDER_MARKERS.risk} ${capPromptLine(risk, 220)}`);
  const lines = [
    "<session_checkpoint>",
    `${STATE_RENDER_MARKERS.goal} Goal: ${
      capPromptLine(normalizeCanonicalRequest(state.canonicalRequest.current), 520) || "(no user request recorded yet)"
    }`,
    "Plan:",
    ...(plan.length > 0 ? plan : [`${STATE_RENDER_MARKERS.notStarted} (none)`]),
    "Decisions:",
    ...renderList(decisions),
    "Files:",
    ...renderList(touchedFiles),
    "Risks:",
    ...renderList(knownRisks),
    "</session_checkpoint>",
  ];
  return capCheckpoint(lines.join("\n"), maxTokens);
}

export function hasMeaningfulStructuredSessionState(state: StructuredSessionState): boolean {
  return (
    state.canonicalRequest.current.trim().length > 0 ||
    (state.canonicalRequest.originalRequests?.length ?? 0) > 0 ||
    state.constraints.length > 0 ||
    state.plan.length > 0 ||
    state.decisions.length > 0 ||
    state.codebase.touchedFiles.length > 0 ||
    state.evidence.length > 0 ||
    state.audit.knownRisks.length > 0
  );
}

export function capWorkingState(workingState: string, maxTokens: number): string {
  const maxChars = Math.max(500, maxTokens * 4);
  if (workingState.length <= maxChars) return workingState;
  const suffix = `\nRisks:\n- ${STATE_RENDER_MARKERS.risk} working state truncated to fit rendered state budget\n</working_state>`;
  const prefix = workingState.slice(0, Math.max(0, maxChars - suffix.length));
  const lastLineBreak = prefix.lastIndexOf("\n");
  return `${prefix.slice(0, lastLineBreak > 0 ? lastLineBreak : prefix.length)}${suffix}`;
}

export function renderWorkingSessionState(state: StructuredSessionState, maxTokens: number): string | undefined {
  if (!hasMeaningfulStructuredSessionState(state)) {
    return undefined;
  }
  const orderedTree = getOrderedPlanTree(state.plan);
  const plan = orderedTree.slice(0, 12).map(({ item, depth, isLastChild, active }) => {
    const indent = depth > 0 ? `${"  ".repeat(depth - 1)}${isLastChild ? "└─ " : "├─ "}` : "";
    const activeText = active ? " 👈 (active)" : "";
    return `${indent}${renderPlanStatusMarker(item.status)} ${capPromptLine(item.text, 220)}${activeText}`;
  });
  const touchedFiles = state.codebase.touchedFiles
    .slice(-16)
    .map((file) => `${file.status}: ${file.path} - ${capPromptLine(file.summary, 180)}`);
  const risks = state.audit.knownRisks.map((risk) => `${STATE_RENDER_MARKERS.risk} ${capPromptLine(risk, 220)}`);
  const decisions = state.decisions
    .filter((decision) => decision.status === "active")
    .slice(-8)
    .map((decision) =>
      capPromptLine(`${decision.decision}${decision.rationale ? `: ${decision.rationale}` : ""}`, 240),
    );
  const lines = [
    "<working_state>",
    `${STATE_RENDER_MARKERS.goal} Goal: ${
      capPromptLine(normalizeCanonicalRequest(state.canonicalRequest.current), 520) || "(no user request recorded yet)"
    }`,
    "Plan:",
    ...(plan.length > 0 ? plan : [`${STATE_RENDER_MARKERS.notStarted} (none)`]),
    "Decisions:",
    ...renderList(decisions),
    "Files:",
    ...renderList(touchedFiles),
    "Risks:",
    ...renderList(risks),
    "</working_state>",
  ];
  return capWorkingState(lines.join("\n"), maxTokens);
}
