import type { IndexingProgress } from "../src/index.ts";

export function isPhaseProgressMonotonic(values: IndexingProgress[]): boolean {
  return values.every(
    (value, index) =>
      index === 0 || value.phase !== values[index - 1].phase || value.percent >= values[index - 1].percent,
  );
}
