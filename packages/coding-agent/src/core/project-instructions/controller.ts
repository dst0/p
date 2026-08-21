import type { Skill } from "../skills.ts";
import { prepareProjectInstructions } from "./processor.ts";
import type {
  PreparedProjectInstructions,
  ProjectInstructionCompiler,
  ProjectInstructionController,
  ProjectInstructionSourceInput,
  ProjectInstructionState,
} from "./types.ts";

interface CreateProjectInstructionControllerOptions {
  cwd: string;
  cacheDir?: string;
  getContextFiles(): ProjectInstructionSourceInput[];
  getSkills(): Skill[];
  compiler?: ProjectInstructionCompiler;
  getCompilerIdentity?(): string;
  compilerFailureBackoffMs?: number;
}

export function createProjectInstructionState(current?: PreparedProjectInstructions): ProjectInstructionState {
  return { current };
}

export function createProjectInstructionController(
  options: CreateProjectInstructionControllerOptions,
): ProjectInstructionController {
  const state = createProjectInstructionState();
  return {
    state,
    async refresh() {
      const prepared = await prepareProjectInstructions({
        cwd: options.cwd,
        cacheDir: options.cacheDir,
        contextFiles: options.getContextFiles(),
        skills: options.getSkills(),
        compiler: options.compiler,
        compilerIdentity: options.getCompilerIdentity?.(),
        compilerFailureBackoffMs: options.compilerFailureBackoffMs,
      });
      state.current = prepared;
      return prepared;
    },
  };
}
