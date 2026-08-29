import type { AgentTool } from "@dst0/p-agent-core";
import type { ToolDefinition } from "../extensions/types.ts";
import { createBashTool, createBashToolDefinition } from "./bash.ts";
import { createEditTool, createEditToolDefinition } from "./edit.ts";
import { createFindTool, createFindToolDefinition } from "./find.ts";
import { createFinishWorkTool, createFinishWorkToolDefinition } from "./finish-work.ts";
import { createGenerateImageTool, createGenerateImageToolDefinition } from "./generate-image.ts";
import type { ToolName, ToolsOptions } from "./index.ts";
import {
  createRecallLearningsTool,
  createRecallLearningsToolDefinition,
  createRecordLearningTool,
  createRecordLearningToolDefinition,
} from "./learnings.ts";
import { createLsTool, createLsToolDefinition } from "./ls.ts";
import { createProcessTool, createProcessToolDefinition } from "./process.ts";
import { createReadTool, createReadToolDefinition } from "./read.ts";
import { createGrepTool, createGrepToolDefinition, createRgTool, createRgToolDefinition } from "./rg.ts";
import { createSemanticSearchTool, createSemanticSearchToolDefinition } from "./semantic-search.ts";
import { createSleepTool, createSleepToolDefinition } from "./sleep.ts";
import {
  createAskUserTool,
  createAskUserToolDefinition,
  createConfirmUserTool,
  createConfirmUserToolDefinition,
  createSubmitPlanTool,
  createSubmitPlanToolDefinition,
} from "./user-input.ts";
import { createWriteTool, createWriteToolDefinition } from "./write.ts";

export function createAllToolDefinitions(
  cwd: string,
  options?: ToolsOptions,
): Record<ToolName, ToolDefinition<any, any, any>> {
  const backgroundProcesses =
    options?.backgroundProcesses ?? options?.bash?.processManager ?? options?.process?.manager;
  return {
    semantic_search: createSemanticSearchToolDefinition(cwd),
    rg: createRgToolDefinition(cwd, options?.rg ?? options?.grep),
    grep: createGrepToolDefinition(cwd, options?.grep ?? options?.rg, "grep"),
    read: createReadToolDefinition(cwd, options?.read),
    bash: createBashToolDefinition(cwd, { ...options?.bash, processManager: backgroundProcesses }),
    edit: createEditToolDefinition(cwd, options?.edit),
    write: createWriteToolDefinition(cwd, options?.write),
    find: createFindToolDefinition(cwd, options?.find),
    ls: createLsToolDefinition(cwd, options?.ls),
    sleep: createSleepToolDefinition(),
    process: createProcessToolDefinition({ ...options?.process, manager: backgroundProcesses }),
    ask_user: createAskUserToolDefinition(),
    confirm_user: createConfirmUserToolDefinition(),
    submit_plan: createSubmitPlanToolDefinition(options?.submitPlan),
    finish_work: createFinishWorkToolDefinition(),
    record_learning: createRecordLearningToolDefinition(cwd),
    recall_learnings: createRecallLearningsToolDefinition(cwd),
    generate_image: createGenerateImageToolDefinition(cwd, options?.generateImage),
  };
}

export function createCodingTools(cwd: string, options?: ToolsOptions): AgentTool[] {
  const backgroundProcesses =
    options?.backgroundProcesses ?? options?.bash?.processManager ?? options?.process?.manager;
  return [
    createReadTool(cwd, options?.read),
    createBashTool(cwd, { ...options?.bash, processManager: backgroundProcesses }),
    createProcessTool({ ...options?.process, manager: backgroundProcesses }),
    createEditTool(cwd, options?.edit),
    createWriteTool(cwd, options?.write),
    createGenerateImageTool(cwd, options?.generateImage),
  ];
}

export function createReadOnlyTools(cwd: string, options?: ToolsOptions): AgentTool[] {
  return [
    createSemanticSearchTool(cwd),
    createReadTool(cwd, options?.read),
    createRgTool(cwd, options?.rg ?? options?.grep),
    createFindTool(cwd, options?.find),
    createLsTool(cwd, options?.ls),
  ];
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, AgentTool> {
  const backgroundProcesses =
    options?.backgroundProcesses ?? options?.bash?.processManager ?? options?.process?.manager;
  return {
    semantic_search: createSemanticSearchTool(cwd),
    rg: createRgTool(cwd, options?.rg ?? options?.grep),
    grep: createGrepTool(cwd, options?.grep ?? options?.rg, "grep"),
    read: createReadTool(cwd, options?.read),
    bash: createBashTool(cwd, { ...options?.bash, processManager: backgroundProcesses }),
    edit: createEditTool(cwd, options?.edit),
    write: createWriteTool(cwd, options?.write),
    find: createFindTool(cwd, options?.find),
    ls: createLsTool(cwd, options?.ls),
    sleep: createSleepTool(),
    process: createProcessTool({ ...options?.process, manager: backgroundProcesses }),
    ask_user: createAskUserTool(),
    confirm_user: createConfirmUserTool(),
    submit_plan: createSubmitPlanTool(options?.submitPlan),
    finish_work: createFinishWorkTool(),
    record_learning: createRecordLearningTool(cwd),
    recall_learnings: createRecallLearningsTool(cwd),
    generate_image: createGenerateImageTool(cwd, options?.generateImage),
  };
}
