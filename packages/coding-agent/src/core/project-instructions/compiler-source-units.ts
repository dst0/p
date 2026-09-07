import type { ProjectInstructionClassifications, ProjectInstructionConstraintInput } from "./types.ts";

export function getProjectInstructionConstraintSourceText(constraint: ProjectInstructionConstraintInput): string {
  return [...constraint.headingContext.map((heading) => heading.content), constraint.content].join("\n");
}

export function materializeProjectInstructionAlwaysOn(
  classifications: ProjectInstructionClassifications,
  constraints: ProjectInstructionConstraintInput[],
): Record<string, string> {
  const emittedHeadings = new Set<string>();
  const entries: Array<[string, string]> = [];
  for (const constraint of constraints) {
    if (classifications.constraints[constraint.id] !== "always-on") continue;
    const sourceLines: string[] = [];
    for (const heading of constraint.headingContext) {
      if (emittedHeadings.has(heading.id)) continue;
      emittedHeadings.add(heading.id);
      sourceLines.push(heading.sourceText);
    }
    sourceLines.push(constraint.sourceText);
    entries.push([constraint.id, normalizeProjectInstructionSourceUnit(sourceLines.join(""))]);
  }
  return Object.fromEntries(entries);
}

export function normalizeProjectInstructionSourceUnit(content: string): string {
  return content.replace(/\r\n?/gu, "\n");
}

export function materializeProjectInstructionBody(alwaysOn: Record<string, string>): string {
  return Object.values(alwaysOn)
    .join("")
    .replace(/^\n+|\n+$/gu, "");
}
