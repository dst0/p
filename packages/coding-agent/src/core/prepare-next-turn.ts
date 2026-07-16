import type { Agent, AgentContext, AgentMessage } from "@dst0/p-agent-core";
import type { AgentSession } from "./agent-session.ts";
import type { SettingsManager } from "./settings-manager.ts";
import {
	createSessionStateReminderMessage,
	createTurnCheckpointMessages,
	SESSION_STATE_REMINDER_INTERVAL_MS,
} from "./turn-checkpoint.ts";

const STATE_MAINTENANCE_TOOL_NAMES = new Set(["update_session_state", "mark_session_progress"]);

export function installAgentSessionPrepareNextTurn(
	agent: Agent,
	session: AgentSession,
	settingsManager: SettingsManager,
): void {
	let lastStateCheckAt = Date.now();
	let lastReminderAt = 0;
	agent.prepareNextTurn = async (_signal, nextTurnContext) => {
		const messages = agent.state.messages;
		if (messages.length === 0) {
			return {
				model: agent.state.model,
				thinkingLevel: agent.state.thinkingLevel,
			};
		}

		const lastAssistantMessage = messages
			.slice()
			.reverse()
			.find((message) => message.role === "assistant") as Extract<AgentMessage, { role: "assistant" }> | undefined;
		const compacted = lastAssistantMessage ? await session.checkCompaction(lastAssistantMessage, false) : false;
		const now = Date.now();
		const successfulStateCheck =
			nextTurnContext?.toolResults.some(
				(result) => !result.isError && STATE_MAINTENANCE_TOOL_NAMES.has(result.toolName),
			) ?? false;
		if (compacted || successfulStateCheck) {
			lastStateCheckAt = now;
		}
		const state = session.getSessionStateSnapshot().state;
		const turnCheckpointMessages = nextTurnContext
			? createTurnCheckpointMessages(nextTurnContext, state, settingsManager.getCompactionRenderedStateMaxTokens())
			: [];
		const completedOrdinaryToolWork =
			nextTurnContext?.toolResults.some(
				(result) => !STATE_MAINTENANCE_TOOL_NAMES.has(result.toolName) && result.toolName !== "sleep",
			) ?? false;
		const reminderDue =
			completedOrdinaryToolWork &&
			state.plan.some((item) => item.status !== "done") &&
			now - Math.max(lastStateCheckAt, lastReminderAt) >= SESSION_STATE_REMINDER_INTERVAL_MS;
		if (reminderDue) {
			lastReminderAt = now;
			turnCheckpointMessages.push(createSessionStateReminderMessage(now + turnCheckpointMessages.length));
		}
		const replacementContext: AgentContext = {
			systemPrompt: agent.state.systemPrompt,
			messages: agent.state.messages.slice(),
			tools: agent.state.tools.slice(),
		};

		return {
			model: agent.state.model,
			thinkingLevel: agent.state.thinkingLevel,
			context: replacementContext,
			appendMessages: turnCheckpointMessages,
		};
	};
}
