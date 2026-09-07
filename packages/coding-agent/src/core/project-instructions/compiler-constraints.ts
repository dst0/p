import { scanProjectInstructionStructuralUnits } from "./compiler-structural-units.ts";
import { getMarkdownHeadingMarker } from "./markdown-structure.ts";
import type { ProjectInstructionConstraintInput, ProjectInstructionModuleInput } from "./types.ts";

interface HeadingState {
  id: string;
  content: string;
  level: number;
  sourceText: string;
  used: boolean;
}

export function buildProjectInstructionConstraints(
  modules: ProjectInstructionModuleInput[],
): ProjectInstructionConstraintInput[] {
  const constraints: ProjectInstructionConstraintInput[] = [];
  const inheritedHeadingIds = new Set(
    modules.flatMap((module) => (module.headingContext ?? []).map((heading) => heading.id)),
  );
  for (const [moduleIndex, module] of modules.entries()) {
    const headings: HeadingState[] = (module.headingContext ?? []).map(({ id, content, level, sourceText }) => ({
      id,
      content,
      level: level ?? getMarkdownHeadingMarker(content)?.length ?? 1,
      sourceText,
      used: true,
    }));
    const appendConstraint = (
      kind: ProjectInstructionConstraintInput["kind"],
      content: string,
      sourceText: string,
      headingContext: HeadingState[],
    ): void => {
      const context = headingContext.map(({ id, content: headingContent, sourceText: headingSourceText }) => ({
        id,
        content: headingContent,
        sourceText: headingSourceText,
      }));
      constraints.push({
        id: `constraint-${constraints.length + 1}`,
        moduleId: module.id,
        kind,
        headingContext: context,
        content,
        sourceText,
      });
    };
    const preserveUnusedHeading = (): void => {
      let orphanIndex = -1;
      for (let index = headings.length - 1; index >= 0; index--) {
        if (!headings[index]!.used && !inheritedHeadingIds.has(headings[index]!.id)) {
          orphanIndex = index;
          break;
        }
      }
      if (orphanIndex < 0) return;
      appendConstraint(
        "orphan-heading",
        headings[orphanIndex]!.content,
        headings[orphanIndex]!.sourceText,
        headings.slice(0, orphanIndex),
      );
      for (let index = 0; index <= orphanIndex; index++) headings[index]!.used = true;
    };
    for (const unit of scanProjectInstructionStructuralUnits(module.content).units) {
      if (unit.kind === "heading") {
        const level = unit.level;
        const retainedCount = headings.findIndex((heading) => heading.level >= level);
        if (retainedCount >= 0) {
          preserveUnusedHeading();
          headings.splice(retainedCount);
        }
        const sourceOrdinal = module.sourceOrdinal ?? moduleIndex + 1;
        const sourceOffset = (module.sourceStartOffset ?? 0) + unit.startOffset;
        headings.push({
          id: `heading-${sourceOrdinal}-${sourceOffset}`,
          content: unit.content,
          level,
          sourceText: unit.sourceText,
          used: false,
        });
        continue;
      }
      appendConstraint("content", unit.content, unit.sourceText, headings);
      for (const heading of headings) heading.used = true;
    }
    preserveUnusedHeading();
  }
  return constraints;
}
