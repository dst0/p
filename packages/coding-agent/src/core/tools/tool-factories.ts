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

function resolveBackgroundProcessManager(options?: ToolsOptions) {
  return options?.backgroundProcesses ?? options?.bash?.processManager ?? options?.process?.manager;
}

export function createNamedToolDefinition(
  toolName: ToolName,
  cwd: string,
  options?: ToolsOptions,
): ToolDefinition<any, any, any> {
  const backgroundProcesses = resolveBackgroundProcessManager(options);
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
      return createBashToolDefinition(cwd, { ...options?.bash, processManager: backgroundProcesses });
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
    case "process":
      return createProcessToolDefinition({ ...options?.process, manager: backgroundProcesses });
    case "ask_user":
      return createAskUserToolDefinition();
    case "confirm_user":
      return createConfirmUserToolDefinition();
    case "submit_plan":
      return createSubmitPlanToolDefinition(options?.submitPlan);
    case "finish_work":
      return createFinishWorkToolDefinition();
    case "record_learning":
      return createRecordLearningToolDefinition(cwd);
    case "recall_learnings":
      return createRecallLearningsToolDefinition(cwd);
    case "generate_image":
      return createGenerateImageToolDefinition(cwd, options?.generateImage);
  }
}

export function createNamedTool(toolName: ToolName, cwd: string, options?: ToolsOptions): AgentTool {
  const backgroundProcesses = resolveBackgroundProcessManager(options);
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
      return createBashTool(cwd, { ...options?.bash, processManager: backgroundProcesses });
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
    case "process":
      return createProcessTool({ ...options?.process, manager: backgroundProcesses });
    case "ask_user":
      return createAskUserTool();
    case "confirm_user":
      return createConfirmUserTool();
    case "submit_plan":
      return createSubmitPlanTool(options?.submitPlan);
    case "finish_work":
      return createFinishWorkTool();
    case "record_learning":
      return createRecordLearningTool(cwd);
    case "recall_learnings":
      return createRecallLearningsTool(cwd);
    case "generate_image":
      return createGenerateImageTool(cwd, options?.generateImage);
  }
}

export function createAllToolDefinitions(
  cwd: string,
  options?: ToolsOptions,
): Record<ToolName, ToolDefinition<any, any, any>> {
  const backgroundProcesses = resolveBackgroundProcessManager(options);
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
  const backgroundProcesses = resolveBackgroundProcessManager(options);
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
  const backgroundProcesses = resolveBackgroundProcessManager(options);
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
