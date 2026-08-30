export {
  BackgroundProcessManager,
  type BackgroundProcessSnapshot,
  type BackgroundProcessStartOptions,
  type BackgroundProcessStatus,
  type BackgroundProcessWaitOptions,
  defaultBackgroundProcessManager,
} from "./background-process.ts";
export {
  type BashOperations,
  type BashSpawnContext,
  type BashSpawnHook,
  type BashToolDetails,
  type BashToolInput,
  type BashToolOptions,
  createBashTool,
  createBashToolDefinition,
  createLocalBashOperations,
} from "./bash.ts";
export {
  createEditTool,
  createEditToolDefinition,
  type EditOperations,
  type EditToolDetails,
  type EditToolInput,
  type EditToolOptions,
} from "./edit.ts";
export { withFileMutationQueue } from "./file-mutation-queue.ts";
export {
  createFindTool,
  createFindToolDefinition,
  type FindOperations,
  type FindToolDetails,
  type FindToolInput,
  type FindToolOptions,
} from "./find.ts";
export {
  createFinishWorkTool,
  createFinishWorkToolDefinition,
  type FinishWorkGateCheck,
  type FinishWorkInput,
  type FinishWorkPayload,
  type FinishWorkToolOptions,
} from "./finish-work.ts";
export {
  createGenerateImageTool,
  createGenerateImageToolDefinition,
  type GenerateImageModelResolution,
  type GenerateImageOperations,
  type GenerateImageToolDetails,
  type GenerateImageToolInput,
  type GenerateImageToolOptions,
  generateImageSchema,
} from "./generate-image.ts";
export {
  createRecallLearningsTool,
  createRecallLearningsToolDefinition,
  createRecordLearningTool,
  createRecordLearningToolDefinition,
  type RecallLearningsToolDetails,
  type RecallLearningsToolInput,
  type RecordLearningToolDetails,
  type RecordLearningToolInput,
  recallLearningsSchema,
  recordLearningSchema,
} from "./learnings.ts";
export {
  createLsTool,
  createLsToolDefinition,
  type LsOperations,
  type LsToolDetails,
  type LsToolInput,
  type LsToolOptions,
} from "./ls.ts";
export {
  createProcessTool,
  createProcessToolDefinition,
  type ProcessToolDetails,
  type ProcessToolInput,
  type ProcessToolOptions,
} from "./process.ts";
export {
  createReadTool,
  createReadToolDefinition,
  type ReadOperations,
  type ReadToolDetails,
  type ReadToolInput,
  type ReadToolOptions,
} from "./read.ts";
export {
  createGrepTool,
  createGrepToolDefinition,
  createRgTool,
  createRgToolDefinition,
  type GrepOperations,
  type GrepToolDetails,
  type GrepToolInput,
  type GrepToolOptions,
} from "./rg.ts";
export {
  createSemanticSearchTool,
  createSemanticSearchToolDefinition,
  type SemanticSearchToolDetails,
  type SemanticSearchToolInput,
} from "./semantic-search.ts";
export { createSleepTool, createSleepToolDefinition, type SleepToolDetails, type SleepToolInput } from "./sleep.ts";
export {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  type TruncationOptions,
  type TruncationResult,
  truncateHead,
  truncateLine,
  truncateTail,
} from "./truncate.ts";
export {
  type AskUserToolDetails,
  type AskUserToolInput,
  type ConfirmUserToolDetails,
  type ConfirmUserToolInput,
  createAskUserTool,
  createAskUserToolDefinition,
  createConfirmUserTool,
  createConfirmUserToolDefinition,
  createSubmitPlanTool,
  createSubmitPlanToolDefinition,
  type SubmitPlanToolDetails,
  type SubmitPlanToolInput,
  type SubmitPlanToolOptions,
} from "./user-input.ts";
export {
  createWriteTool,
  createWriteToolDefinition,
  type WriteOperations,
  type WriteToolInput,
  type WriteToolOptions,
} from "./write.ts";

import type { AgentTool } from "@dst0/p-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import type { BackgroundProcessManager } from "./background-process.ts";
import type { BashToolOptions } from "./bash.ts";
import type { EditToolOptions } from "./edit.ts";
import type { FindToolOptions } from "./find.ts";
import type { GenerateImageToolOptions } from "./generate-image.ts";
import type { LsToolOptions } from "./ls.ts";
import type { ProcessToolOptions } from "./process.ts";
import type { ReadToolOptions } from "./read.ts";
import type { GrepToolOptions } from "./rg.ts";
import { createAllToolDefinitions, createNamedTool, createNamedToolDefinition } from "./tool-factories.ts";
import type { SubmitPlanToolOptions } from "./user-input.ts";
import type { WriteToolOptions } from "./write.ts";

export type Tool = AgentTool<any>;
export type ToolDef = ToolDefinition<any, any>;
export type ToolName =
  | "semantic_search"
  | "rg"
  | "grep"
  | "read"
  | "bash"
  | "edit"
  | "write"
  | "find"
  | "ls"
  | "sleep"
  | "process"
  | "ask_user"
  | "confirm_user"
  | "submit_plan"
  | "finish_work"
  | "record_learning"
  | "recall_learnings"
  | "generate_image";

export const allToolNames: Set<ToolName> = new Set([
  "semantic_search",
  "rg",
  "grep",
  "read",
  "bash",
  "edit",
  "write",
  "find",
  "ls",
  "sleep",
  "process",
  "ask_user",
  "confirm_user",
  "submit_plan",
  "finish_work",
  "record_learning",
  "recall_learnings",
  "generate_image",
]);

export interface ToolsOptions {
  read?: ReadToolOptions;
  bash?: BashToolOptions;
  write?: WriteToolOptions;
  edit?: EditToolOptions;
  rg?: GrepToolOptions;
  grep?: GrepToolOptions;
  find?: FindToolOptions;
  ls?: LsToolOptions;
  process?: ProcessToolOptions;
  backgroundProcesses?: BackgroundProcessManager;
  submitPlan?: SubmitPlanToolOptions;
  generateImage?: GenerateImageToolOptions;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
  return createNamedToolDefinition(toolName, cwd, options);
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
  return createNamedTool(toolName, cwd, options);
}

export function createCodingToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
  const allDefs = createAllToolDefinitions(cwd, options);
  return [allDefs.read, allDefs.bash, allDefs.process, allDefs.edit, allDefs.write, allDefs.generate_image];
}

export function createReadOnlyToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
  const allDefs = createAllToolDefinitions(cwd, options);
  return [allDefs.semantic_search, allDefs.read, allDefs.rg, allDefs.find, allDefs.ls];
}

export {
  createAllToolDefinitions,
  createAllTools,
  createCodingTools,
  createReadOnlyTools,
} from "./tool-factories.ts";
