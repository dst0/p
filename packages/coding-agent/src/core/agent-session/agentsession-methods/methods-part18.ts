import type { ToolDefinition } from "../../extensions/index.ts";
import type { RunSubagentInput, RunSubagentResult } from "../../subagents.ts";
import type { AgentSession } from "../agentsession.ts";
import { KEEP_CONTEXT_SCHEMA, RUN_SUBAGENT_SCHEMA } from "../constants.ts";
import { isRecord } from "../helpers-part1.ts";

export function do__createKeepContextToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof KEEP_CONTEXT_SCHEMA, any> {
  return {
    name: "keep_context",
    label: "Keep Context",
    description:
      "Control how a large tool result is preserved in future context. " +
      "Use self to summarize long outputs or pin important evidence before it gets automatically stubbed.",
    parameters: KEEP_CONTEXT_SCHEMA,
    execute: async (_toolCallId, params) => {
      const input = params as {
        toolCallId: string;
        summary?: string;
        relevantLines?: string[];
        pin?: boolean;
      };
      const message = self.agent.state.messages.find(
        (m) => m.role === "toolResult" && (m as any).toolCallId === input.toolCallId,
      ) as any | undefined;

      if (!message) {
        return {
          content: [
            {
              type: "text",
              text: `Error: Tool result with ID ${input.toolCallId} not found.`,
            },
          ],
          details: { error: "not_found" },
          isError: true,
        };
      }

      message.details = {
        ...(isRecord(message.details) ? message.details : {}),
        contextExtract:
          input.summary || input.relevantLines
            ? {
                summary: input.summary || "",
                relevantLines: input.relevantLines || [],
                source: "service_model" as const,
              }
            : message.details?.contextExtract,
        keepInContext: input.pin ?? message.details?.keepInContext,
      };

      return {
        content: [
          {
            type: "text",
            text: `Context settings updated for tool result ${input.toolCallId}.`,
          },
        ],
        details: { status: "updated" },
      };
    },
  };
}

export function do__createRunSubagentToolDefinition(
  self: AgentSession,
): ToolDefinition<typeof RUN_SUBAGENT_SCHEMA, RunSubagentResult> {
  return {
    name: "run_subagent",
    label: "Run Subagent",
    description:
      "Run a read-only subagent with restricted permissions for noisy exploration tasks. " +
      "The parent context receives only a concise digest; the full subagent session is stored separately. " +
      "Use 'explore' for codebase exploration, 'scout' for web research, 'review' for code review.",
    promptSnippet:
      "run_subagent(profile, task): run a read-only subagent (explore, scout, review) with restricted permissions",
    promptGuidelines: [
      "Use 'explore' for codebase exploration (read, grep, ls only).",
      "Use 'scout' for web/dependency research.",
      "Use 'review' for read-only code review.",
      "Parent context receives only a digest; raw subagent session is stored separately.",
    ],
    parameters: RUN_SUBAGENT_SCHEMA,
    executionMode: "sequential",
    execute: async (_toolCallId, params) => {
      const input = params as RunSubagentInput;
      const result = await self._runSubagent(input);
      return {
        content: [{ type: "text", text: self._formatSubagentResult(result) }],
        details: result,
      };
    },
  };
}
