import type { AssistantMessage, ToolResultMessage } from "@dst0/p-ai";
import type { AgentContext, AgentLoopConfig, AgentMessage } from "../types.ts";
import type { AgentEventSink } from "./types.ts";

export interface PreparedAgentNextTurn {
  config: AgentLoopConfig;
  context: AgentContext;
}

export async function prepareAgentNextTurn(
  message: AssistantMessage,
  toolResults: ToolResultMessage[],
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  emit: AgentEventSink,
): Promise<PreparedAgentNextTurn> {
  const snapshot = await config.prepareNextTurn?.({ message, toolResults, context: currentContext, newMessages });
  if (!snapshot) return { config, context: currentContext };

  const context = snapshot.context ?? currentContext;
  const nextConfig = {
    ...config,
    model: snapshot.model ?? config.model,
    reasoning:
      snapshot.thinkingLevel === undefined
        ? config.reasoning
        : snapshot.thinkingLevel === "off"
          ? undefined
          : snapshot.thinkingLevel,
  };
  for (const appendedMessage of snapshot.appendMessages ?? []) {
    await emit({ type: "message_start", message: appendedMessage });
    await emit({ type: "message_end", message: appendedMessage });
    context.messages.push(appendedMessage);
    newMessages.push(appendedMessage);
  }
  return { config: nextConfig, context };
}
