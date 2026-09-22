import type { BeforeToolCallContext, ResolvedToolEffect } from "@dst0/p-agent-core";
import { KNOWN_DIRECT_MUTATION_TOOLS } from "../constants.ts";
import type { TaskVerificationController } from "../taskverificationcontroller.ts";
import { isShellTool } from "../tool-classification.ts";
import { reserveTestMutation } from "./test-authoring-gate.ts";

/**
 * The LIGHT tier observes only built-in file and shell tools. Extension, MCP, search, and state tools
 * pass through untouched, so they neither enter the effect ledger nor create verification debt.
 */
export function observedInLightTier(context: { toolCall: { name: string }; effect?: ResolvedToolEffect }): boolean {
  const toolName = context.toolCall.name;
  return context.effect?.source === "builtin" && (KNOWN_DIRECT_MUTATION_TOOLS.has(toolName) || isShellTool(toolName));
}

/**
 * LIGHT-tier pre-call hook: never blocks, but keeps the test-path reservation so a changed test
 * is still owed a direct run if the task later escalates to STRICT.
 */
export function observeOnlyBeforeToolCall(self: TaskVerificationController, context: BeforeToolCallContext): undefined {
  if (!self.isAuthorizedBaselineTestMutation(context.toolCall.name, context.args)) {
    reserveTestMutation(self, context);
  }
  return undefined;
}
