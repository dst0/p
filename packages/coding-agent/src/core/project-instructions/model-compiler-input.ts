import { Buffer } from "node:buffer";
import type { ProjectInstructionCompilerRequest } from "./types.ts";

export const PROJECT_INSTRUCTION_COMPILER_SOURCE_MAX_BYTES = 512_000;

export function buildProjectInstructionCompilerLayout(request: ProjectInstructionCompilerRequest) {
  const moduleIds = new Set<string>();
  for (const module of request.modules) {
    if (moduleIds.has(module.id)) throw new Error(`Duplicate module id: ${module.id}`);
    moduleIds.add(module.id);
  }
  const constraintIds = new Set<string>();
  const constraintsByModule = new Map<string, ProjectInstructionCompilerRequest["constraints"]>();
  for (const constraint of request.constraints) {
    if (constraintIds.has(constraint.id)) throw new Error(`Duplicate constraint id: ${constraint.id}`);
    if (!moduleIds.has(constraint.moduleId))
      throw new Error(`Compiler constraint references unknown module: ${constraint.id}`);
    constraintIds.add(constraint.id);
    const grouped = constraintsByModule.get(constraint.moduleId);
    if (grouped) grouped.push(constraint);
    else constraintsByModule.set(constraint.moduleId, [constraint]);
  }
  const layout = request.modules.map((module) => ({ module, constraints: constraintsByModule.get(module.id) ?? [] }));
  if (layout.reduce((total, entry) => total + entry.constraints.length, 0) !== request.constraints.length) {
    throw new Error("Compiler positional layout did not consume every constraint exactly once");
  }
  return layout;
}

export function buildProjectInstructionCompilerInput(request: ProjectInstructionCompilerRequest): string {
  const sourceBytes = request.sources.reduce((total, source) => total + Buffer.byteLength(source.content, "utf8"), 0);
  if (sourceBytes > PROJECT_INSTRUCTION_COMPILER_SOURCE_MAX_BYTES) {
    throw new Error(
      `Complete project instruction sources exceed the ${PROJECT_INSTRUCTION_COMPILER_SOURCE_MAX_BYTES}-byte compiler source limit`,
    );
  }
  const layout = buildProjectInstructionCompilerLayout(request);
  return JSON.stringify({
    modules: layout.map(({ module: { id, title, sourceOrdinal }, constraints }) => {
      const headings = new Map(
        constraints.flatMap((constraint) =>
          constraint.headingContext.map((heading) => [heading.id, heading.content] as const),
        ),
      );
      return {
        id,
        title,
        sourceOrdinal: sourceOrdinal ?? 0,
        headings: [...headings],
        constraints: constraints.map(({ id: constraintId, kind, headingContext, content }) => [
          constraintId,
          kind,
          headingContext.map((heading) => heading.id),
          content,
        ]),
      };
    }),
  });
}
