import { readFixtureText } from "./fixture-files.ts";
import type { HiddenRubric } from "./hidden-verification.ts";

function isHiddenRubric(value: unknown): value is HiddenRubric {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.name === "string" &&
    typeof candidate.weight === "number" &&
    Number.isFinite(candidate.weight)
  );
}

export function readHiddenRubric(taskId: string): readonly HiddenRubric[] {
  const parsed: unknown = JSON.parse(readFixtureText(taskId, "rubric.json"));
  if (!Array.isArray(parsed) || !parsed.every(isHiddenRubric)) {
    throw new Error(`Invalid hidden rubric for ${taskId}`);
  }
  return parsed;
}
