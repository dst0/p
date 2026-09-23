import type { AssistantMessage, Model, ToolResultMessage } from "@dst0/p-ai";
import type { CompletionMode } from "./completion-protocol.ts";
import type { AgentContext, AgentMessage, ThinkingLevel } from "./types.ts";

/** Context passed to `shouldStopAfterTurn`. */
export interface ShouldStopAfterTurnContext {
  /** The assistant message that completed the turn. */
  message: AssistantMessage;
  /** Tool result messages passed to the preceding `turn_end` event. */
  toolResults: ToolResultMessage[];
  /** Current agent context after the turn's assistant message and tool results have been appended. */
  context: AgentContext;
  /** Messages that this loop invocation will return if it exits at this point. Prompt runs include the initial prompt messages; continuation runs do not include pre-existing context messages. */
  newMessages: AgentMessage[];
}

/** Replacement runtime state used by the agent loop before starting another provider request. */
export interface AgentLoopTurnUpdate {
  /** Context for the next provider request. */
  context?: AgentContext;
  /** Model for the next provider request. */
  model?: Model<any>;
  /** Thinking level for the next provider request. */
  thinkingLevel?: ThinkingLevel;
  /**
   * Completion protocol for the rest of this run, for example an escalation from `implicit`
   * to `explicit_finish` after a task starts changing code. Omit to keep the current protocol.
   */
  completionMode?: CompletionMode;
  /**
   * Messages to append after the completed turn and before the next provider request.
   * The loop emits normal message lifecycle events for these messages so stateful
   * wrappers can persist them and later requests retain an exact cacheable prefix.
   */
  appendMessages?: AgentMessage[];
}

export interface PrepareNextTurnContext extends ShouldStopAfterTurnContext {}
