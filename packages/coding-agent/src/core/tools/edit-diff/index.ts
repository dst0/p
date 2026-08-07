export {
  detectLineEnding,
  fuzzyFindText,
  normalizeForFuzzyMatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./helpers-part1.ts";
export { adjustNewTextIndentation, applyEditsToNormalizedContent, generateUnifiedPatch } from "./helpers-part2.ts";
export { generateDiffString } from "./helpers-part3.ts";
export { computeEditDiff, computeEditsDiff } from "./helpers-part4.ts";
export type { AppliedEditsResult, Edit, EditDiffError, EditDiffResult, FuzzyMatchResult } from "./types.ts";
