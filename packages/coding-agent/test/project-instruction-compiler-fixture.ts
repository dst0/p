import { writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentSession } from "../src/core/agent-session/agentsession.ts";
import { getProjectInstructionConstraintSourceText } from "../src/core/project-instructions/compiler-source-units.ts";
import {
  isUnmistakablyGlobalConstraint,
  materializeProjectInstructionCompilerResult,
} from "../src/core/project-instructions/compiler-validation.ts";
import { createProjectInstructionController } from "../src/core/project-instructions/index.ts";
import type {
  ProjectInstructionCompilerRequest,
  ProjectInstructionCompilerResult,
} from "../src/core/project-instructions/types.ts";

export function createProjectInstructionCompilation(
  request: ProjectInstructionCompilerRequest,
  triggers: Record<string, string> = {},
): ProjectInstructionCompilerResult {
  if (request.constraints.length === 0) {
    return {
      body: "No source constraints apply to every task.",
      triggers,
      classifications: {
        modules: Object.fromEntries(request.modules.map((module) => [module.id, "always-on"])),
        constraints: {},
      },
      alwaysOn: {},
    };
  }
  const alwaysOnConstraints = request.constraints.filter((constraint) =>
    isUnmistakablyGlobalConstraint(getProjectInstructionConstraintSourceText(constraint)),
  );
  const alwaysOnIds = new Set(alwaysOnConstraints.map((constraint) => constraint.id));
  const sourceGroundedTriggers: Record<string, string> = {};
  for (const module of request.modules) {
    const routedConstraint = request.constraints.find(
      (constraint) => constraint.moduleId === module.id && !alwaysOnIds.has(constraint.id),
    );
    if (routedConstraint) {
      const sourceWords = getProjectInstructionConstraintSourceText(routedConstraint).match(/[\p{L}\p{N}]+/gu) ?? [];
      sourceGroundedTriggers[module.id] = [sourceWords.slice(0, 10).join(" "), triggers[module.id]]
        .filter(Boolean)
        .join(" ");
    } else if (triggers[module.id]) sourceGroundedTriggers[module.id] = triggers[module.id];
  }
  return materializeProjectInstructionCompilerResult(
    {
      modules: Object.fromEntries(
        request.modules.map((module) => [
          module.id,
          request.constraints.some(
            (constraint) => constraint.moduleId === module.id && alwaysOnIds.has(constraint.id),
          ) || !request.constraints.some((constraint) => constraint.moduleId === module.id)
            ? "always-on"
            : "routed",
        ]),
      ),
      constraints: Object.fromEntries(
        request.constraints.map((constraint) => [
          constraint.id,
          alwaysOnIds.has(constraint.id) ? "always-on" : "routed",
        ]),
      ),
    },
    sourceGroundedTriggers,
    request.constraints,
  );
}

export function replaceFirstAlwaysOn(
  result: ProjectInstructionCompilerResult,
  replacement: string,
): ProjectInstructionCompilerResult {
  const firstId = Object.keys(result.alwaysOn)[0];
  if (!firstId) throw new Error("Expected an always-on constraint");
  result.alwaysOn[firstId] = replacement;
  result.body = Object.values(result.alwaysOn).join("\n");
  return result;
}

export async function installCacheRoutingProjectInstructions(
  session: AgentSession,
  cwd: string,
  agentsContent: string,
): Promise<void> {
  const agentsPath = join(cwd, "AGENTS.md");
  writeFileSync(agentsPath, agentsContent);
  const controller = createProjectInstructionController({
    cwd,
    getContextFiles: () => [{ path: agentsPath, content: agentsContent }],
    getSkills: () => [],
    compiler: async (request) =>
      createProjectInstructionCompilation(
        request,
        Object.fromEntries(
          request.modules.map((module) => [module.id, `request mentions ${module.title.toLocaleLowerCase("en-US")}`]),
        ),
      ),
  });
  await controller.refresh();
  session._projectInstructions = controller;
  session._buildRuntime({ activeToolNames: session.getActiveToolNames() });
}
