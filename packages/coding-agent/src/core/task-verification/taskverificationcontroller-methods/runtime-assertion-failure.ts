import type { AfterToolCallContext } from "@dst0/p-agent-core";
import { isConfidentlyReadOnlyShellTool, isShellTool } from "../tool-classification.ts";
import { hasRuntimeAssertionFailure } from "./test-invocation-selection.ts";

export function isZeroExitRuntimeAssertionFailure(
  context: AfterToolCallContext,
  output: string,
  nativeIsError: boolean,
): boolean {
  return (
    !nativeIsError &&
    isShellTool(context.toolCall.name) &&
    !isConfidentlyReadOnlyShellTool(context.toolCall.name, context.args) &&
    hasRuntimeAssertionFailure(output)
  );
}
