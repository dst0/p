import type { EvidencePointer } from "../compaction.ts";
import {
  _scoreNormalizedComparableText,
  comparableTerms,
  mergeStringList,
  normalizeComparableText,
} from "./state-rendering.ts";
import type { PlanItem, PlanStatus, StatePatch, StructuredSessionState } from "./types.ts";

export function scoreComparableText(left: string, right: string): number {
  const normalizedLeft = normalizeComparableText(left);
  const normalizedRight = normalizeComparableText(right);
  if (!normalizedLeft || !normalizedRight) return 0;
  const leftTerms = comparableTerms(normalizedLeft);
  const rightTerms = comparableTerms(normalizedRight);
  return _scoreNormalizedComparableText(normalizedLeft, leftTerms, normalizedRight, rightTerms);
}

export function findPlanItemByIdOrText(plan: PlanItem[], id: string | undefined, text: string): PlanItem | undefined {
  if (id) {
    const byId = plan.find((item) => item.id === id);
    if (byId) return byId;
  }
  const normalizedText = normalizeComparableText(text);
  if (!normalizedText) return undefined;
  const exactText = plan.find((item) => normalizeComparableText(item.text) === normalizedText);
  if (exactText) return exactText;

  let best: { item: PlanItem; score: number } | undefined;
  for (const item of plan) {
    const score = scoreComparableText(item.text, text);
    if (score < 0.66) continue;
    if (!best || score > best.score) {
      best = { item, score };
    }
  }
  return best?.item;
}

export function shouldReplacePlanStatus(current: PlanStatus, incoming: PlanStatus): boolean {
  if (current === incoming) return true;
  if (current === "done" && incoming !== "done") return false;
  if ((current === "blocked" || current === "failed") && incoming === "not_started") return false;
  if (current === "in_progress" && incoming === "not_started") return false;
  return true;
}

export function reorderPlan(state: StructuredSessionState, orderedIds: string[]): void {
  const order = new Map(orderedIds.map((id, index) => [id, index]));
  state.plan = [...state.plan].sort((left, right) => {
    const leftOrder = order.get(left.id);
    const rightOrder = order.get(right.id);
    if (leftOrder === undefined && rightOrder === undefined) return 0;
    if (leftOrder === undefined) return 1;
    if (rightOrder === undefined) return -1;
    return leftOrder - rightOrder;
  });
}

export function pruneEvidenceEntryIds(plan: PlanItem[], evidence: EvidencePointer[]): void {
  const evidenceIds = new Set(evidence.map((e) => e.id));
  for (const item of plan) {
    item.evidenceEntryIds = item.evidenceEntryIds.filter((id) => evidenceIds.has(id));
  }
}

export function mergePlan(state: StructuredSessionState, patch: NonNullable<StatePatch["plan"]>): void {
  // Fast path: when there are no existing items, all incoming items are new
  if (state.plan.length === 0 && (patch.replace?.length ?? 0) === 0) {
    state.plan = (patch.add ?? []).map(
      (item): PlanItem => ({
        id: item.id,
        text: item.text,
        status: item.status,
        parentId: item.parentId,
        evidenceEntryIds: item.evidenceEntryIds ?? [],
      }),
    );
    return;
  }

  const orderedIds: string[] = [];
  const rememberOrder = (item: PlanItem): void => {
    if (!orderedIds.includes(item.id)) {
      orderedIds.push(item.id);
    }
  };
  if (patch.replace) {
    const nextPlan: PlanItem[] = [];
    for (const item of patch.replace) {
      const existing = findPlanItemByIdOrText(state.plan, item.id, item.text);
      nextPlan.push({
        ...(existing ?? item),
        id: existing?.id ?? item.id,
        text: item.text,
        status: item.status,
        parentId: item.parentId ?? existing?.parentId,
        evidenceEntryIds: mergeStringList(existing?.evidenceEntryIds ?? [], item.evidenceEntryIds),
      });
    }
    state.plan = nextPlan;
  }
  for (const item of patch.add ?? []) {
    const existing = findPlanItemByIdOrText(state.plan, item.id, item.text);
    if (!existing) {
      const added = {
        ...item,
        evidenceEntryIds: [...item.evidenceEntryIds],
      };
      state.plan.push(added);
      rememberOrder(added);
      continue;
    }
    if (item.status === "done" && item.evidenceEntryIds.length === 0) {
      // Allow reordering even when status update is suppressed
      rememberOrder(existing);
      continue;
    }
    if (shouldReplacePlanStatus(existing.status, item.status)) {
      existing.status = item.status;
    }
    if (existing.id === item.id) {
      existing.text = item.text;
    }
    if (item.parentId !== undefined) {
      existing.parentId = item.parentId;
    }
    existing.evidenceEntryIds = mergeStringList(existing.evidenceEntryIds, item.evidenceEntryIds);
    rememberOrder(existing);
  }
  for (const update of patch.update ?? []) {
    const existing = findPlanItemByIdOrText(state.plan, update.id, update.matchText ?? update.text ?? "");
    if (!existing) continue;
    if (update.status === "done" && (update.evidenceEntryIds?.length ?? existing.evidenceEntryIds.length) === 0) {
      // Allow reordering even when status update is suppressed
      rememberOrder(existing);
      continue;
    }
    if (update.text && existing.id === update.id) {
      existing.text = update.text;
    }
    if (update.parentId !== undefined) {
      existing.parentId = update.parentId;
    }
    if (update.status && shouldReplacePlanStatus(existing.status, update.status)) existing.status = update.status;
    existing.evidenceEntryIds = mergeStringList(existing.evidenceEntryIds, update.evidenceEntryIds);
    rememberOrder(existing);
  }
  // Remove items matched by id or text
  if (patch.remove && patch.remove.length > 0) {
    // ⚡ Bolt: Use a single filter pass over the list rather than filtering inside the removal loop
    state.plan = state.plan.filter((item) => {
      for (const removal of patch.remove!) {
        const matchId = typeof removal === "string" ? undefined : removal.id;
        const matchText = typeof removal === "string" ? removal : removal.text;
        if (findPlanItemByIdOrText([item], matchId, matchText)) {
          return false;
        }
      }
      return true;
    });
  }
  if (orderedIds.length > 0) {
    reorderPlan(state, orderedIds);
  }
  // Prune dead evidenceEntryIds (entryIds that don't match any evidence pointer)
  pruneEvidenceEntryIds(state.plan, state.evidence);
}

export function mergeEvidence(
  existing: EvidencePointer[],
  incoming: EvidencePointer[],
  maxKeep: number = 50,
): EvidencePointer[] {
  const indexById = new Map<string, number>();
  const result: EvidencePointer[] = [];

  // Process existing pointers, filtering dead references
  for (const pointer of existing) {
    // Filter out dead references (no entryId, no path, has retrieveWhen)
    const pathEmpty = pointer.path !== undefined && pointer.path.trim().length === 0;
    const isFile = pointer.kind === "file";
    const hasPath = pointer.path && pointer.path.trim().length > 0;
    const hasEntryId = pointer.entryId && pointer.entryId.trim().length > 0;
    const isToolResult = pointer.kind === "tool_result";
    if (
      !pointer.id ||
      pathEmpty ||
      (isFile && !hasPath) ||
      (!hasEntryId && !hasPath && !isToolResult && pointer.retrieveWhen)
    ) {
      continue;
    }
    indexById.set(pointer.id, result.length);
    result.push({ ...pointer });
  }

  // Process incoming pointers
  for (const pointer of incoming) {
    // Filter out dead references
    const pathEmpty = pointer.path !== undefined && pointer.path.trim().length === 0;
    const isFile = pointer.kind === "file";
    const hasPath = pointer.path && pointer.path.trim().length > 0;
    const hasEntryId = pointer.entryId && pointer.entryId.trim().length > 0;
    const isToolResult = pointer.kind === "tool_result";
    if (
      !pointer.id ||
      pathEmpty ||
      (isFile && !hasPath) ||
      (!hasEntryId && !hasPath && !isToolResult && pointer.retrieveWhen)
    ) {
      continue;
    }
    const existingIndex = indexById.get(pointer.id);
    if (existingIndex === undefined) {
      result.push({ ...pointer });
      indexById.set(pointer.id, result.length - 1);
    } else {
      const current = result[existingIndex];
      if (
        pointer.summary.length > (current?.summary.length ?? 0) ||
        pointer.retrieveWhen.length > (current?.retrieveWhen.length ?? 0)
      ) {
        result[existingIndex] = { ...pointer };
      }
    }
  }

  // Prune to maxKeep, keeping most recent
  if (result.length > maxKeep) {
    return result.slice(result.length - maxKeep);
  }
  return result;
}

export function mergeDecisions(state: StructuredSessionState, patch: NonNullable<StatePatch["decisions"]>): void {
  const byId = new Map(state.decisions.map((decision) => [decision.id, decision]));
  for (const item of patch.add ?? []) {
    const existing =
      byId.get(item.id) ??
      state.decisions.find(
        (decision) =>
          normalizeComparableText(decision.decision) === normalizeComparableText(item.decision) &&
          normalizeComparableText(decision.rationale) === normalizeComparableText(item.rationale),
      );
    if (existing) {
      existing.evidencePointers = mergeEvidence(existing.evidencePointers, item.evidencePointers);
      continue;
    }
    state.decisions.push({
      ...item,
      evidencePointers: item.evidencePointers.map((pointer) => ({
        ...pointer,
      })),
    });
  }
  for (const supersede of patch.supersede ?? []) {
    const current = byId.get(supersede.id);
    if (current) {
      current.status = "superseded";
      current.rationale = current.rationale
        ? `${current.rationale} Superseded: ${supersede.reason}`
        : `Superseded: ${supersede.reason}`;
    }
  }
}
