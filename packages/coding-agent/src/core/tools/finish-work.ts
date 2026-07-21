import { Text } from "@dst0/p-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition, ToolRenderContext, ToolRenderResultOptions } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

export interface FinishWorkPayload {
	status: "success" | "partial" | "failed";
	summary: string;
	result?: string;
	files_changed?: string[];
	tests_run?: string[];
	remaining_work?: string[];
	notes?: string;
}

const finishWorkSchema = Type.Object({
	status: Type.Union([Type.Literal("success"), Type.Literal("partial"), Type.Literal("failed")], {
		description: "Final status of the task",
	}),
	summary: Type.String({ description: "Concise summary of the completed work" }),
	result: Type.Optional(Type.String({ description: "Detailed result or output" })),
	files_changed: Type.Optional(Type.Array(Type.String({ description: "Files changed during this task" }))),
	tests_run: Type.Optional(Type.Array(Type.String({ description: "Tests run during this task" }))),
	remaining_work: Type.Optional(Type.Array(Type.String({ description: "Remaining incomplete work items" }))),
	notes: Type.Optional(Type.String({ description: "Additional notes or context" })),
});

export type FinishWorkInput = Static<typeof finishWorkSchema>;

function validateFinishWorkInput(input: FinishWorkInput): string | null {
	if (!input.summary || input.summary.trim().length === 0) {
		return "summary is required and must not be empty";
	}
	if (input.status === "success" && input.remaining_work?.length) {
		return 'status "success" is incompatible with non-empty remaining_work';
	}
	return null;
}

function formatFinishWorkResult(payload: FinishWorkPayload, theme: Theme): string {
	const lines: string[] = [];

	// Status line
	const statusIcon =
		payload.status === "success"
			? theme.fg("success", "✔")
			: payload.status === "partial"
				? theme.fg("warning", "◐")
				: theme.fg("error", "✖");

	const statusLabel =
		payload.status === "success"
			? theme.fg("success", "Success")
			: payload.status === "partial"
				? theme.fg("warning", "Partial")
				: theme.fg("error", "Failed");

	lines.push(`${statusIcon} ${statusLabel}`);
	lines.push("");

	// Summary
	if (payload.summary) {
		lines.push(theme.fg("text", payload.summary));
	}

	// Result (if different from summary)
	if (payload.result && payload.result !== payload.summary) {
		lines.push("");
		lines.push(payload.result);
	}

	// Files changed
	if (payload.files_changed?.length) {
		lines.push("");
		lines.push(theme.fg("muted", "Files:"));
		for (const file of payload.files_changed) {
			lines.push(`  ${theme.fg("text", file)}`);
		}
	}

	// Tests run
	if (payload.tests_run?.length) {
		lines.push("");
		lines.push(theme.fg("muted", "Tests:"));
		for (const test of payload.tests_run) {
			lines.push(`  ${theme.fg("text", test)}`);
		}
	}

	// Remaining work
	if (payload.remaining_work?.length) {
		lines.push("");
		lines.push(theme.fg("muted", "Remaining:"));
		for (const item of payload.remaining_work) {
			lines.push(`  ${theme.fg("warning", item)}`);
		}
	}

	// Notes
	if (payload.notes) {
		lines.push("");
		lines.push(theme.fg("dim", payload.notes));
	}

	return lines.join("\n");
}

export function createFinishWorkToolDefinition(): ToolDefinition<typeof finishWorkSchema, FinishWorkPayload> {
	return {
		name: "finish_work",
		label: "Finish Work",
		description: "Terminate the agent run with an explicit final status and summary.",
		promptSnippet: "Explicitly terminate the task with final status and user-visible result",
		promptGuidelines: [
			"Call finish_work exactly once when the task is complete, partially complete, or blocked.",
			"status 'success' is incompatible with non-empty remaining_work.",
			"summary is required and must not be empty.",
		],
		parameters: finishWorkSchema,
		execute: async (_toolCallId, input: FinishWorkInput, _signal, _onUpdate, _ctx) => {
			const error = validateFinishWorkInput(input);
			if (error) {
				throw new Error(`finish_work validation error: ${error}`);
			}
			return {
				content: [{ type: "text", text: `Task finished with status: ${input.status}` }],
				details: input as FinishWorkPayload,
			};
		},
		renderCall(_args, theme, _context: ToolRenderContext) {
			return new Text(theme.fg("toolTitle", theme.bold("finish_work")), 1, 0);
		},
		renderResult(result, _options: ToolRenderResultOptions, theme, _context: ToolRenderContext) {
			const payload = result.details as FinishWorkPayload;
			const text = formatFinishWorkResult(payload, theme);
			return new Text(text, 1, 0);
		},
	};
}

export function createFinishWorkTool() {
	return wrapToolDefinition(createFinishWorkToolDefinition());
}
