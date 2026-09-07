import type { AgentMessage } from "@dst0/p-agent-core";

const MAX_COMPLETED_TOOL_ARGUMENT_CHARS = 4000;

/** Replace only already-executed oversized arguments in the prompt copy. */
export function compactCompletedToolCallArguments(messages: AgentMessage[]): AgentMessage[] {
  const completedToolCallIds = new Set<string>();
  let compactedMessages: AgentMessage[] | undefined;
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "toolResult") {
      completedToolCallIds.add(message.toolCallId);
      continue;
    }
    if (message.role !== "assistant" || completedToolCallIds.size === 0) continue;
    let changed = false;
    const content = message.content.map((block) => {
      if (
        block.type !== "toolCall" ||
        !completedToolCallIds.has(block.id) ||
        JSON.stringify(block.arguments).length <= MAX_COMPLETED_TOOL_ARGUMENT_CHARS
      ) {
        return block;
      }
      changed = true;
      return {
        ...block,
        arguments: {
          compacted: true,
          summary: `Completed ${block.name} arguments omitted from prompt context after execution completed.`,
        },
      };
    });
    if (changed) {
      compactedMessages ??= messages.slice();
      compactedMessages[index] = { ...message, content };
    }
  }
  return compactedMessages ?? messages;
}
