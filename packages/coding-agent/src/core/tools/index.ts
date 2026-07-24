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
  createLsTool,
  createLsToolDefinition,
  type LsOperations,
  type LsToolDetails,
  type LsToolInput,
  type LsToolOptions,
} from "./ls.ts";
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
  createWriteTool,
  createWriteToolDefinition,
  type WriteOperations,
  type WriteToolInput,
  type WriteToolOptions,
} from "./write.ts";

import type { AgentTool } from "@dst0/p-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";

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

import { type BashToolOptions, createBashTool, createBashToolDefinition } from "./bash.ts";
import { createEditTool, createEditToolDefinition, type EditToolOptions } from "./edit.ts";
import { createFindTool, createFindToolDefinition, type FindToolOptions } from "./find.ts";
import { createFinishWorkTool, createFinishWorkToolDefinition } from "./finish-work.ts";
import { createLsTool, createLsToolDefinition, type LsToolOptions } from "./ls.ts";
import { createReadTool, createReadToolDefinition, type ReadToolOptions } from "./read.ts";
import {
  createGrepTool,
  createGrepToolDefinition,
  createRgTool,
  createRgToolDefinition,
  type GrepToolOptions,
} from "./rg.ts";
import { createSemanticSearchTool, createSemanticSearchToolDefinition } from "./semantic-search.ts";
import { createSleepTool, createSleepToolDefinition } from "./sleep.ts";
import {
  createAskUserTool,
  createAskUserToolDefinition,
  createConfirmUserTool,
  createConfirmUserToolDefinition,
  createSubmitPlanTool,
  createSubmitPlanToolDefinition,
  type SubmitPlanToolOptions,
} from "./user-input.ts";
import { createWriteTool, createWriteToolDefinition, type WriteToolOptions } from "./write.ts";

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
  | "ask_user"
  | "confirm_user"
  | "submit_plan"
  | "finish_work";
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
  "ask_user",
  "confirm_user",
  "submit_plan",
  "finish_work",
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
  submitPlan?: SubmitPlanToolOptions;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
  switch (toolName) {
    case "semantic_search":
      return createSemanticSearchToolDefinition(cwd);
    case "rg":
      return createRgToolDefinition(cwd, options?.rg ?? options?.grep);
    case "grep":
      return createGrepToolDefinition(cwd, options?.grep ?? options?.rg, "grep");
    case "read":
      return createReadToolDefinition(cwd, options?.read);
    case "bash":
      return createBashToolDefinition(cwd, options?.bash);
    case "edit":
      return createEditToolDefinition(cwd, options?.edit);
    case "write":
      return createWriteToolDefinition(cwd, options?.write);
    case "find":
      return createFindToolDefinition(cwd, options?.find);
    case "ls":
      return createLsToolDefinition(cwd, options?.ls);
    case "sleep":
      return createSleepToolDefinition();
    case "ask_user":
      return createAskUserToolDefinition();
    case "confirm_user":
      return createConfirmUserToolDefinition();
    case "submit_plan":
      return createSubmitPlanToolDefinition(options?.submitPlan);
    case "finish_work":
      return createFinishWorkToolDefinition();
    default:
      throw new Error(`Unknown tool name: ${toolName}`);
  }
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
  switch (toolName) {
    case "semantic_search":
      return createSemanticSearchTool(cwd);
    case "rg":
      return createRgTool(cwd, options?.rg ?? options?.grep);
    case "grep":
      return createGrepTool(cwd, options?.grep ?? options?.rg, "grep");
    case "read":
      return createReadTool(cwd, options?.read);
    case "bash":
      return createBashTool(cwd, options?.bash);
    case "edit":
      return createEditTool(cwd, options?.edit);
    case "write":
      return createWriteTool(cwd, options?.write);
    case "find":
      return createFindTool(cwd, options?.find);
    case "ls":
      return createLsTool(cwd, options?.ls);
    case "sleep":
      return createSleepTool();
    case "ask_user":
      return createAskUserTool();
    case "confirm_user":
      return createConfirmUserTool();
    case "submit_plan":
      return createSubmitPlanTool(options?.submitPlan);
    case "finish_work":
      return createFinishWorkTool();
    default:
      throw new Error(`Unknown tool name: ${toolName}`);
  }
}

export function createCodingToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
  return [
    createReadToolDefinition(cwd, options?.read),
    createBashToolDefinition(cwd, options?.bash),
    createEditToolDefinition(cwd, options?.edit),
    createWriteToolDefinition(cwd, options?.write),
  ];
}

export function createReadOnlyToolDefinitions(cwd: string, options?: ToolsOptions): ToolDef[] {
  return [
    createSemanticSearchToolDefinition(cwd),
    createReadToolDefinition(cwd, options?.read),
    createRgToolDefinition(cwd, options?.rg ?? options?.grep),
    createFindToolDefinition(cwd, options?.find),
    createLsToolDefinition(cwd, options?.ls),
  ];
}

export function createAllToolDefinitions(cwd: string, options?: ToolsOptions): Record<ToolName, ToolDef> {
  return {
    semantic_search: createSemanticSearchToolDefinition(cwd),
    rg: createRgToolDefinition(cwd, options?.rg ?? options?.grep),
    grep: createGrepToolDefinition(cwd, options?.grep ?? options?.rg, "grep"),
    read: createReadToolDefinition(cwd, options?.read),
    bash: createBashToolDefinition(cwd, options?.bash),
    edit: createEditToolDefinition(cwd, options?.edit),
    write: createWriteToolDefinition(cwd, options?.write),
    find: createFindToolDefinition(cwd, options?.find),
    ls: createLsToolDefinition(cwd, options?.ls),
    sleep: createSleepToolDefinition(),
    ask_user: createAskUserToolDefinition(),
    confirm_user: createConfirmUserToolDefinition(),
    submit_plan: createSubmitPlanToolDefinition(options?.submitPlan),
    finish_work: createFinishWorkToolDefinition(),
  };
}

export function createCodingTools(cwd: string, options?: ToolsOptions): Tool[] {
  return [
    createReadTool(cwd, options?.read),
    createBashTool(cwd, options?.bash),
    createEditTool(cwd, options?.edit),
    createWriteTool(cwd, options?.write),
  ];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): Tool[] {
  return [
    createSemanticSearchTool(cwd),
    createReadTool(cwd, options?.read),
    createRgTool(cwd, options?.rg ?? options?.grep),
    createFindTool(cwd, options?.find),
    createLsTool(cwd, options?.ls),
  ];
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
  return {
    semantic_search: createSemanticSearchTool(cwd),
    rg: createRgTool(cwd, options?.rg ?? options?.grep),
    grep: createGrepTool(cwd, options?.grep ?? options?.rg, "grep"),
    read: createReadTool(cwd, options?.read),
    bash: createBashTool(cwd, options?.bash),
    edit: createEditTool(cwd, options?.edit),
    write: createWriteTool(cwd, options?.write),
    find: createFindTool(cwd, options?.find),
    ls: createLsTool(cwd, options?.ls),
    sleep: createSleepTool(),
    ask_user: createAskUserTool(),
    confirm_user: createConfirmUserTool(),
    submit_plan: createSubmitPlanTool(options?.submitPlan),
    finish_work: createFinishWorkTool(),
  };
}
