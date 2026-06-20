import type { ToolResultMessage } from "@dst0/p-ai";
import { type Static, Type } from "typebox";
import type { AgentMessage, AgentTool } from "./types.ts";

export const FINISH_WORK_TOOL_NAME = "finish_work";

export type CompletionMode = "implicit" | "explicit_finish" | "hybrid";

export interface CompletionProtocolLimits {
	maxTurns?: number;
	maxNoProgressTurns?: number;
	maxMalformedToolRetries?: number;
	maxEmptyAssistantRetries?: number;
	maxMissingFinishRetries?: number;
}

export type FinishWorkStatus = "success" | "partial" | "failed";

export interface FinishWorkPayload {
	status: FinishWorkStatus;
	summary: string;
	result?: string;
	files_changed?: string[];
	tests_run?: string[];
	remaining_work?: string[];
	notes?: string;
}

export const FINISH_WORK_SCHEMA = Type.Object({
	status: Type.Union([Type.Literal("success"), Type.Literal("partial"), Type.Literal("failed")]),
	summary: Type.String(),
	result: Type.Optional(Type.String()),
	files_changed: Type.Optional(Type.Array(Type.String())),
	tests_run: Type.Optional(Type.Array(Type.String())),
	remaining_work: Type.Optional(Type.Array(Type.String())),
	notes: Type.Optional(Type.String()),
});

type FinishWorkInput = Static<typeof FINISH_WORK_SCHEMA>;

function normalizeOptionalList(values: string[] | undefined): string[] | undefined {
	if (!values || values.length === 0) {
		return undefined;
	}
	return values;
}

export function normalizeFinishWorkPayload(input: FinishWorkInput): FinishWorkPayload {
	return {
		status: input.status,
		summary: input.summary,
		result: input.result,
		files_changed: normalizeOptionalList(input.files_changed),
		tests_run: normalizeOptionalList(input.tests_run),
		remaining_work: normalizeOptionalList(input.remaining_work),
		notes: input.notes,
	};
}

export function createFinishWorkTool(): AgentTool<typeof FINISH_WORK_SCHEMA, FinishWorkPayload> {
	return {
		name: FINISH_WORK_TOOL_NAME,
		label: "Finish Work",
		description:
			"Terminate the agent run with an explicit final status and summary. Call this exactly once when the task is complete, partially complete, or blocked.",
		parameters: FINISH_WORK_SCHEMA,
		executionMode: "sequential",
		async execute(_toolCallId, params) {
			const payload = normalizeFinishWorkPayload(params);
			return {
				content: [{ type: "text", text: payload.result ?? payload.summary }],
				details: payload,
				terminate: true,
			};
		},
	};
}

export function isFinishWorkToolResult(
	message: AgentMessage | undefined,
): message is ToolResultMessage<FinishWorkPayload> {
	return message?.role === "toolResult" && message.toolName === FINISH_WORK_TOOL_NAME;
}

export function getFinishWorkPayload(messages: readonly AgentMessage[]): FinishWorkPayload | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (isFinishWorkToolResult(message)) {
			return message.details;
		}
	}
	return undefined;
}
