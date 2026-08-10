export { computeEditDiff, computeEditsDiff } from "./compute.ts";
export { generateDiffString } from "./diff-generation.ts";
export { adjustNewTextIndentation, applyEditsToNormalizedContent, generateUnifiedPatch } from "./indentation.ts";
export {
  detectLineEnding,
  fuzzyFindText,
  normalizeForFuzzyMatch,
  normalizeToLF,
  restoreLineEndings,
  stripBom,
} from "./text-normalization.ts";
export type { AppliedEditsResult, Edit, EditDiffError, EditDiffResult, FuzzyMatchResult } from "./types.ts";
