import type { AfterToolCallContext } from "@dst0/p-agent-core";

export function snapshotNativeToolCallContext(context: AfterToolCallContext): AfterToolCallContext {
  return {
    ...context,
    toolCall: {
      ...context.toolCall,
      arguments: structuredClone(context.toolCall.arguments),
    },
    args: structuredClone(context.args),
    result: {
      ...context.result,
      content: context.result.content.map((part) => ({ ...part })),
      details: undefined,
    },
    isError: context.isError,
  };
}
