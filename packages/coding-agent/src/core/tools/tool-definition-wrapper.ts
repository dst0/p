import type { AgentTool } from "@dst0/p-agent-core";
import type { ExtensionContext, ToolDefinition } from "../extensions/types.ts";
import { resolveToolDefinitionEffect } from "./tool-effects.ts";

/** Wrap a ToolDefinition into an AgentTool for the core runtime. */
export function wrapToolDefinition<TDetails = unknown>(
  definition: ToolDefinition<any, TDetails>,
  ctxFactory?: () => ExtensionContext,
  source: "builtin" | "declared" = "builtin",
): AgentTool<any, TDetails> {
  return {
    name: definition.name,
    label: definition.label,
    effect: resolveToolDefinitionEffect(definition, source),
    description: definition.description,
    parameters: definition.parameters,
    prepareArguments: definition.prepareArguments,
    executionMode: definition.executionMode,
    execute: (toolCallId, params, signal, onUpdate) =>
      definition.execute(toolCallId, params, signal, onUpdate, ctxFactory?.() as ExtensionContext),
  };
}

/** Wrap multiple ToolDefinitions into AgentTools for the core runtime. */
export function wrapToolDefinitions(
  definitions: ToolDefinition<any, any>[],
  ctxFactory?: () => ExtensionContext,
  source: "builtin" | "declared" = "builtin",
): AgentTool<any>[] {
  return definitions.map((definition) => wrapToolDefinition(definition, ctxFactory, source));
}

/**
 * Synthesize a minimal ToolDefinition from an AgentTool.
 *
 * This keeps AgentSession's internal registry definition-first even when a caller
 * provides plain AgentTool overrides that do not include prompt metadata or renderers.
 */
export function createToolDefinitionFromAgentTool(tool: AgentTool<any>): ToolDefinition<any, unknown> {
  return {
    name: tool.name,
    label: tool.label,
    effect: tool.effect,
    description: tool.description,
    parameters: tool.parameters as any,
    prepareArguments: tool.prepareArguments,
    executionMode: tool.executionMode,
    execute: async (toolCallId, params, signal, onUpdate) => tool.execute(toolCallId, params, signal, onUpdate),
  };
}
