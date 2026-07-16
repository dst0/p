import type { PrepareNextTurnContext } from "@dst0/p-agent-core";
import { renderWorkingSessionState, type StructuredSessionState } from "./compaction/index.ts";
import { type CustomMessage, SLEEP_TOOL_NAME } from "./messages.ts";

export const TURN_CHECKPOINT_CUSTOM_TYPE = "turn_checkpoint";
export const SESSION_STATE_REMINDER_CUSTOM_TYPE = "session_state_reminder";
export const SESSION_STATE_REMINDER_INTERVAL_MS = 90_000;

const STATE_UPDATE_TOOL_NAMES = new Set(["update_session_state", "mark_session_progress"]);

export function createSessionStateReminderMessage(timestamp = Date.now()): CustomMessage {
	return {
		role: "custom",
		customType: SESSION_STATE_REMINDER_CUSTOM_TYPE,
		content: [
			"<session_state_reminder>",
			"About 90 seconds of active work have elapsed since the last plan-state check.",
			"Before the next action, compare completed work with the current Goal, Plan, Decisions, Files, and Risks.",
			"- If an existing plan item changed status, call mark_session_progress with its exact visible task text.",
			"- If scope, decisions, touched files, or risks changed, call update_session_state.",
			"- If nothing changed, continue without a state tool call.",
			"</session_state_reminder>",
		].join("\n"),
		display: false,
		timestamp,
	};
}

export function createTurnCheckpointMessages(
	context: PrepareNextTurnContext,
	state: StructuredSessionState,
	renderedStateMaxTokens: number,
): CustomMessage[] {
	const durableResults = context.toolResults.filter((result) => result.toolName !== SLEEP_TOOL_NAME);
	if (durableResults.length === 0) {
		return [];
	}

	const refreshWorkingState = durableResults.some(
		(result) => !result.isError && STATE_UPDATE_TOOL_NAMES.has(result.toolName),
	);
	const lines = [
		"<turn_checkpoint>",
		"The immediately preceding tool turn is complete. Treat these outcomes as facts:",
		...durableResults.map((result) => {
			const pointer = `tool-result:${result.toolCallId}`;
			return result.isError
				? `- ERROR ${result.toolName} (${pointer}): the action did not complete; address the preceding error before retrying.`
				: `- SUCCESS ${result.toolName} (${pointer}): the action completed; use the preceding result and advance.`;
		}),
		"Do not repeat an identical successful call unless relevant state changed or explicit revalidation/polling is required.",
		"Do not retry an unchanged failed call; first address its cause or change the arguments or plan.",
		...(refreshWorkingState
			? ["A refreshed <working_state> follows and is authoritative over earlier working-state snapshots."]
			: []),
		"</turn_checkpoint>",
	];
	const timestamp = Date.now();
	const messages: CustomMessage[] = [
		{
			role: "custom",
			customType: TURN_CHECKPOINT_CUSTOM_TYPE,
			content: lines.join("\n"),
			display: false,
			timestamp,
		},
	];

	if (refreshWorkingState) {
		const workingState = renderWorkingSessionState(state, renderedStateMaxTokens);
		if (workingState) {
			messages.push({
				role: "custom",
				customType: "working_state",
				content: workingState,
				display: false,
				timestamp: timestamp + 1,
			});
		}
	}

	return messages;
}
