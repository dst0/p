import type { AfterToolCallContext } from "@dst0/p-agent-core";
import { snapshotExternalReadbackProofDetails } from "./external-readback-proof.ts";

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
      details: snapshotExternalReadbackProofDetails(context.result.details),
    },
    isError: context.isError,
  };
}
