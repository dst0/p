import { Text } from "@dst0/p-tui";
import { Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";

// Re-exported from @dst0/p-agent-core
export interface FinishWorkPayload {
	status: "success" | "partial" | "failed";
	summary: string;
	result?: string;
	files_changed?: string[];
	tests_run?: string[];
	remaining_work?: string[];
	notes?: string;
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

const finishWorkSchema = Type.Object({});

export function createFinishWorkToolDefinition(): ToolDefinition<typeof finishWorkSchema, FinishWorkPayload> {
	return {
		name: "finish_work",
		label: "Finish Work",
		description: "Terminate the agent run with an explicit final status and summary.",
		parameters: finishWorkSchema,
		execute: async () => ({ content: [], details: {} as FinishWorkPayload }),
		renderCall(_args, theme) {
			return new Text(theme.fg("toolTitle", theme.bold("finish_work")), 1, 0);
		},
		renderResult(result, _options, theme) {
			const payload = result.details as FinishWorkPayload;
			const text = formatFinishWorkResult(payload, theme);
			return new Text(text, 1, 0);
		},
	};
}
