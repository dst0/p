import type { Agent, AgentContext, AgentMessage } from "@dst0/p-agent-core";
import type { AgentSession } from "./agent-session.ts";
import type { SettingsManager } from "./settings-manager.ts";
import { createTurnCheckpointMessages } from "./turn-checkpoint.ts";

export function installAgentSessionPrepareNextTurn(
	agent: Agent,
	session: AgentSession,
	settingsManager: SettingsManager,
): void {
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
		if (lastAssistantMessage) {
			await session.checkCompaction(lastAssistantMessage, false);
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
			appendMessages: nextTurnContext
				? createTurnCheckpointMessages(
						nextTurnContext,
						session.getSessionStateSnapshot().state,
						settingsManager.getCompactionRenderedStateMaxTokens(),
					)
				: undefined,
		};
	};
}
