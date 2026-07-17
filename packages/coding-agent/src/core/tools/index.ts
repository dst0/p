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
export { createFinishWorkToolDefinition, type FinishWorkPayload } from "./finish-work.ts";
export {
	createGrepTool,
	createGrepToolDefinition,
	type GrepOperations,
	type GrepToolDetails,
	type GrepToolInput,
	type GrepToolOptions,
} from "./grep.ts";
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
import { createFinishWorkToolDefinition } from "./finish-work.ts";
import { createGrepTool, createGrepToolDefinition, type GrepToolOptions } from "./grep.ts";
import { createLsTool, createLsToolDefinition, type LsToolOptions } from "./ls.ts";
import { createReadTool, createReadToolDefinition, type ReadToolOptions } from "./read.ts";
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
	| "read"
	| "bash"
	| "edit"
	| "write"
	| "grep"
	| "find"
	| "ls"
	| "sleep"
	| "semantic_search"
	| "ask_user"
	| "confirm_user"
	| "submit_plan";
export const allToolNames: Set<ToolName> = new Set([
	"read",
	"bash",
	"edit",
	"write",
	"grep",
	"find",
	"ls",
	"sleep",
	"semantic_search",
	"ask_user",
	"confirm_user",
	"submit_plan",
]);

export interface ToolsOptions {
	read?: ReadToolOptions;
	bash?: BashToolOptions;
	write?: WriteToolOptions;
	edit?: EditToolOptions;
	grep?: GrepToolOptions;
	find?: FindToolOptions;
	ls?: LsToolOptions;
	submitPlan?: SubmitPlanToolOptions;
}

export function createToolDefinition(toolName: ToolName, cwd: string, options?: ToolsOptions): ToolDef {
	switch (toolName) {
		case "read":
			return createReadToolDefinition(cwd, options?.read);
		case "bash":
			return createBashToolDefinition(cwd, options?.bash);
		case "edit":
			return createEditToolDefinition(cwd, options?.edit);
		case "write":
			return createWriteToolDefinition(cwd, options?.write);
		case "grep":
			return createGrepToolDefinition(cwd, options?.grep);
		case "find":
			return createFindToolDefinition(cwd, options?.find);
		case "ls":
			return createLsToolDefinition(cwd, options?.ls);
		case "sleep":
			return createSleepToolDefinition();
		case "semantic_search":
			return createSemanticSearchToolDefinition(cwd);
		case "ask_user":
			return createAskUserToolDefinition();
		case "confirm_user":
			return createConfirmUserToolDefinition();
		case "submit_plan":
			return createSubmitPlanToolDefinition(options?.submitPlan);
		default:
			throw new Error(`Unknown tool name: ${toolName}`);
	}
}

export function createTool(toolName: ToolName, cwd: string, options?: ToolsOptions): Tool {
	switch (toolName) {
		case "read":
			return createReadTool(cwd, options?.read);
		case "bash":
			return createBashTool(cwd, options?.bash);
		case "edit":
			return createEditTool(cwd, options?.edit);
		case "write":
			return createWriteTool(cwd, options?.write);
		case "grep":
			return createGrepTool(cwd, options?.grep);
		case "find":
			return createFindTool(cwd, options?.find);
		case "ls":
			return createLsTool(cwd, options?.ls);
		case "sleep":
			return createSleepTool();
		case "semantic_search":
			return createSemanticSearchTool(cwd);
		case "ask_user":
			return createAskUserTool();
		case "confirm_user":
			return createConfirmUserTool();
		case "submit_plan":
			return createSubmitPlanTool(options?.submitPlan);
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
		createReadToolDefinition(cwd, options?.read),
		createGrepToolDefinition(cwd, options?.grep),
		createFindToolDefinition(cwd, options?.find),
		createLsToolDefinition(cwd, options?.ls),
	];
}

export function createAllToolDefinitions(
	cwd: string,
	options?: ToolsOptions,
): Record<ToolName, ToolDef> & { finish_work: ToolDef } {
	return {
		read: createReadToolDefinition(cwd, options?.read),
		bash: createBashToolDefinition(cwd, options?.bash),
		edit: createEditToolDefinition(cwd, options?.edit),
		write: createWriteToolDefinition(cwd, options?.write),
		grep: createGrepToolDefinition(cwd, options?.grep),
		find: createFindToolDefinition(cwd, options?.find),
		ls: createLsToolDefinition(cwd, options?.ls),
		sleep: createSleepToolDefinition(),
		semantic_search: createSemanticSearchToolDefinition(cwd),
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
		createReadTool(cwd, options?.read),
		createGrepTool(cwd, options?.grep),
		createFindTool(cwd, options?.find),
		createLsTool(cwd, options?.ls),
	];
}

export function createAllTools(cwd: string, options?: ToolsOptions): Record<ToolName, Tool> {
	return {
		read: createReadTool(cwd, options?.read),
		bash: createBashTool(cwd, options?.bash),
		edit: createEditTool(cwd, options?.edit),
		write: createWriteTool(cwd, options?.write),
		grep: createGrepTool(cwd, options?.grep),
		find: createFindTool(cwd, options?.find),
		ls: createLsTool(cwd, options?.ls),
		sleep: createSleepTool(),
		semantic_search: createSemanticSearchTool(cwd),
		ask_user: createAskUserTool(),
		confirm_user: createConfirmUserTool(),
		submit_plan: createSubmitPlanTool(options?.submitPlan),
	};
}
