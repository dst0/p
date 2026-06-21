import type { AgentTool } from "@dst0/p-agent-core";
import { Text } from "@dst0/p-tui";
import { type Static, Type } from "typebox";
import type { Theme } from "../../modes/interactive/theme/theme.ts";
import type { ToolDefinition } from "../extensions/types.ts";
import { wrapToolDefinition } from "./tool-definition-wrapper.ts";

const sleepSchema = Type.Object({
	seconds: Type.Number({ description: "Seconds to wait before retrying" }),
});

export type SleepToolInput = Static<typeof sleepSchema>;

export interface SleepToolDetails {
	seconds: number;
}

function formatSleepCall(args: { seconds?: number } | undefined, theme: Theme): string {
	const seconds = Number.isFinite(args?.seconds) ? Math.max(0, args?.seconds ?? 0) : 0;
	return `${theme.fg("toolTitle", theme.bold("sleep"))} ${theme.fg("toolOutput", `${seconds}s`)}`;
}

export function createSleepToolDefinition(): ToolDefinition<typeof sleepSchema, SleepToolDetails> {
	return {
		name: "sleep",
		label: "sleep",
		description: "Wait for a short period before retrying a queued request.",
		promptSnippet: "Wait before retrying a queued request",
		parameters: sleepSchema,
		async execute(_toolCallId, { seconds }: SleepToolInput, signal?: AbortSignal) {
			const safeSeconds = Number.isFinite(seconds) ? Math.min(60, Math.max(0, seconds)) : 0;
			await new Promise<void>((resolve, reject) => {
				if (signal?.aborted) {
					reject(new Error("Operation aborted"));
					return;
				}
				const timeout = setTimeout(() => {
					signal?.removeEventListener("abort", onAbort);
					resolve();
				}, safeSeconds * 1000);
				const onAbort = () => {
					clearTimeout(timeout);
					reject(new Error("Operation aborted"));
				};
				signal?.addEventListener("abort", onAbort, { once: true });
			});
			return {
				content: [{ type: "text", text: `Slept for ${safeSeconds} seconds.` }],
				details: { seconds: safeSeconds },
			};
		},
		renderCall(args, theme, context) {
			const text = (context.lastComponent as Text | undefined) ?? new Text("", 0, 0);
			text.setText(formatSleepCall(args, theme));
			return text;
		},
	};
}

export function createSleepTool(): AgentTool<typeof sleepSchema> {
	return wrapToolDefinition(createSleepToolDefinition());
}
