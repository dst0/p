import { normalizedSemanticAnchors, semanticAnchorsContradict } from "./semantic-subject.ts";

export interface QualifierBinding {
  id: "exact" | "lower-bound" | "order" | "universal" | "upper-bound";
  anchors: ReadonlySet<string>;
  values: ReadonlySet<string>;
}

export function hasGroupedQualifierCoverage(
  groups: readonly (readonly QualifierBinding[])[],
  selected: readonly QualifierBinding[],
): boolean {
  const ids = new Set(groups.flatMap((group) => group.map(({ id }) => id)));
  return [...ids].every((id) => {
    const alternatives = groups.map((group) => group.filter((binding) => binding.id === id));
    const maximum = Math.max(...alternatives.map(({ length }) => length));
    const candidates = alternatives.filter(({ length }) => length === maximum);
    const selectedForId = selected.filter((binding) => binding.id === id);
    return candidates.some((candidate) => hasOneToOneCoverage(candidate, selectedForId, 0, new Set()));
  });
}

export function maximumMatchedQualifierIndexes(
  required: readonly QualifierBinding[],
  selected: readonly QualifierBinding[],
): ReadonlySet<number> {
  const selectedAssignments = new Map<number, number>();
  const assign = (requiredIndex: number, visitedSelected: Set<number>): boolean =>
    selected.some((candidate, selectedIndex) => {
      if (visitedSelected.has(selectedIndex) || !bindingsMatch(required[requiredIndex]!, candidate, true)) return false;
      visitedSelected.add(selectedIndex);
      const previousRequired = selectedAssignments.get(selectedIndex);
      if (previousRequired !== undefined && !assign(previousRequired, visitedSelected)) return false;
      selectedAssignments.set(selectedIndex, requiredIndex);
      return true;
    });
  for (let index = 0; index < required.length; index++) assign(index, new Set());
  return new Set(selectedAssignments.values());
}

function bindingsMatch(required: QualifierBinding, selected: QualifierBinding, strictSubjects = false): boolean {
  if (!qualifierKindsMatch(required, selected)) return false;
  if ([...required.values].some((value) => !selected.values.has(value))) return false;
  if (required.anchors.size === 0) return true;
  const requiredAnchors = normalizedSemanticAnchors(required.anchors);
  const selectedAnchors = normalizedSemanticAnchors(selected.anchors);
  if (semanticAnchorsContradict(requiredAnchors, selectedAnchors)) return false;
  const overlap = [...requiredAnchors].filter((anchor) => selectedAnchors.has(anchor));
  const requiredOverlap = strictSubjects ? requiredAnchors.size : Math.min(2, requiredAnchors.size);
  return overlap.length >= requiredOverlap;
}

function qualifierKindsMatch(required: QualifierBinding, selected: QualifierBinding): boolean {
  if (required.id === selected.id) return true;
  if (!required.values.has("0") || !selected.values.has("0")) return false;
  return (
    (required.id === "exact" && selected.id === "upper-bound") ||
    (required.id === "upper-bound" && selected.id === "exact")
  );
}

function hasOneToOneCoverage(
  required: readonly QualifierBinding[],
  selected: readonly QualifierBinding[],
  requiredIndex: number,
  usedSelectedIndexes: ReadonlySet<number>,
): boolean {
  if (requiredIndex >= required.length) return true;
  return selected.some((candidate, selectedIndex) => {
    if (usedSelectedIndexes.has(selectedIndex) || !bindingsMatch(required[requiredIndex]!, candidate)) return false;
    return hasOneToOneCoverage(required, selected, requiredIndex + 1, new Set([...usedSelectedIndexes, selectedIndex]));
  });
}
