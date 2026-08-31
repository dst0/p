import { type AssistantMessage, validateToolArguments } from "@dst0/p-ai";
import { FINISH_WORK_TOOL_NAME } from "../completion-protocol.ts";
import { resolveToolEffect } from "../tool-effects.ts";
import type { AgentContext, AgentLoopConfig, AgentTool, AgentToolCall, AgentToolResult } from "../types.ts";
import {
  MALFORMED_TOOL_CALL_REPAIR_MESSAGE,
  MISSING_FINISH_WORK_REPAIR_MESSAGE,
  MIXED_FINISH_WORK_REPAIR_MESSAGE,
  REPETITIVE_MODEL_OUTPUT_REPAIR_MESSAGE,
} from "./constants.ts";
import {
  getStringValue,
  isRecord,
  prepareToolCallArguments,
  sanitizeToolCallIdSegment,
} from "./message-preparation.ts";
import { hasRepetitiveModelOutput } from "./response-processing.ts";
import type { CompletionProtocolRepair, ImmediateToolCallOutcome, PreparedToolCall } from "./types.ts";

export function getAssistantText(message: AssistantMessage): string {
  return message.content
    .flatMap((block) => {
      if (block.type === "text") return [block.text];
      if (block.type === "thinking") return [block.thinking];
      return [];
    })
    .join("\n");
}

export function hasMalformedOrTruncatedToolCall(message: AssistantMessage, toolCalls: AgentToolCall[]): boolean {
  if (message.stopReason === "length" || (message.stopReason === "toolUse" && toolCalls.length === 0)) {
    return true;
  }
  if (toolCalls.length > 0) {
    return false;
  }
  const text = getAssistantText(message);
  return (
    /<tool_call\b/i.test(text) ||
    /<function(?:=|\s)/i.test(text) ||
    /"tool_calls?"\s*:/i.test(text) ||
    /"function_call"\s*:/i.test(text)
  );
}

export function detectCompletionProtocolRepair(
  message: AssistantMessage,
  toolCalls: AgentToolCall[],
  hasMoreToolCalls: boolean,
): CompletionProtocolRepair | undefined {
  if (hasRepetitiveModelOutput(message)) {
    return {
      reason: "repetitive_model_output",
      message:
        toolCalls.length > 0 ? malformedToolCallRepairMessage(toolCalls) : REPETITIVE_MODEL_OUTPUT_REPAIR_MESSAGE,
      event: "malformed_tool_call_retry",
    };
  }

  if (hasMalformedOrTruncatedToolCall(message, toolCalls)) {
    return {
      reason: "malformed_or_truncated_tool_call",
      message: malformedToolCallRepairMessage(toolCalls),
      event: "malformed_tool_call_retry",
    };
  }

  const finishWorkCalls = toolCalls.filter((toolCall) => toolCall.name === FINISH_WORK_TOOL_NAME);
  if (finishWorkCalls.length > 0 && toolCalls.length !== 1) {
    return {
      reason: "mixed_finish_work_tool_call",
      message: MIXED_FINISH_WORK_REPAIR_MESSAGE,
      event: "malformed_tool_call_retry",
    };
  }

  if (toolCalls.length === 0 || !hasMoreToolCalls) {
    return {
      reason: "missing_finish_work_or_tool_call",
      message: MISSING_FINISH_WORK_REPAIR_MESSAGE,
      event: "missing_finish_work_retry",
    };
  }

  return undefined;
}

function malformedToolCallRepairMessage(toolCalls: AgentToolCall[]): string {
  const pendingCall = toolCalls.length === 1 ? toolCalls[0] : undefined;
  const toolName = pendingCall ? boundedRepairLabel(pendingCall.name, 80) : undefined;
  const argumentsRecord = pendingCall && isRecord(pendingCall.arguments) ? pendingCall.arguments : undefined;
  const path = boundedRepairLabel(
    getStringValue(argumentsRecord?.path) ?? getStringValue(argumentsRecord?.file_path) ?? "",
    200,
  );
  const pendingStep = toolName
    ? `The pending ${JSON.stringify(toolName)} call${path ? ` for path ${JSON.stringify(path)}` : ""} was not executed.`
    : "The incomplete response was not executed as a tool call.";
  return [
    MALFORMED_TOOL_CALL_REPAIR_MESSAGE,
    pendingStep,
    "Reapply already-known task and project constraints and retry only this pending step; do not restart planning or project discovery, and do not reread unchanged inputs.",
    "If the arguments were large, use smaller bounded tool calls.",
  ].join("\n");
}

function boundedRepairLabel(value: string, maxLength: number): string {
  return value
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .trim()
    .slice(0, maxLength);
}

export function createErrorToolResult(message: string): AgentToolResult<any> {
  return {
    content: [{ type: "text", text: message }],
    details: {},
  };
}

export function getWaitCheckValidationError(
  waitToolCall: AgentToolCall,
  tools: AgentTool[] | undefined,
): string | undefined {
  const check = isRecord(waitToolCall.arguments.check) ? waitToolCall.arguments.check : undefined;
  const name = getStringValue(check?.tool);
  const args = isRecord(check?.arguments) ? check.arguments : undefined;
  if (!name || !args) {
    return "sleep requires `check: { tool, arguments }`; a bare wait is not allowed";
  }
  if (name === "sleep") {
    return "sleep check cannot call sleep; it must inspect concrete external state";
  }
  if (name === FINISH_WORK_TOOL_NAME) {
    return "sleep check cannot call finish_work; it must inspect concrete external state";
  }
  const tool = tools?.find((candidate) => candidate.name === name);
  if (!tool) {
    return `sleep check tool ${name} not found`;
  }
  try {
    const checkToolCall: AgentToolCall = {
      type: "toolCall",
      id: `wait_check_${sanitizeToolCallIdSegment(waitToolCall.id)}`,
      name,
      arguments: args,
    };
    validateToolArguments(tool, prepareToolCallArguments(tool, checkToolCall));
  } catch (error) {
    return `Invalid sleep check for ${name}: ${error instanceof Error ? error.message : String(error)}`;
  }
  return undefined;
}

export async function prepareToolCall(
  currentContext: AgentContext,
  assistantMessage: AssistantMessage,
  toolCall: AgentToolCall,
  config: AgentLoopConfig,
  signal: AbortSignal | undefined,
): Promise<PreparedToolCall | ImmediateToolCallOutcome> {
  const tool = currentContext.tools?.find((t) => t.name === toolCall.name);
  if (!tool) {
    return {
      kind: "immediate",
      result: createErrorToolResult(`Tool ${toolCall.name} not found`),
      isError: true,
    };
  }
  if (toolCall.name === "sleep") {
    const waitCheckError = getWaitCheckValidationError(toolCall, currentContext.tools);
    if (waitCheckError) {
      return {
        kind: "immediate",
        result: createErrorToolResult(waitCheckError),
        isError: true,
      };
    }
  }

  try {
    const preparedToolCall = prepareToolCallArguments(tool, toolCall);
    const validatedArgs = validateToolArguments(tool, preparedToolCall);
    const effect = resolveToolEffect(tool.effect);
    if (config.beforeToolCall) {
      const beforeResult = await config.beforeToolCall(
        {
          assistantMessage,
          toolCall,
          args: validatedArgs,
          effect,
          context: currentContext,
        },
        signal,
      );
      if (signal?.aborted) {
        return {
          kind: "immediate",
          result: createErrorToolResult("Operation aborted"),
          isError: true,
        };
      }
      if (beforeResult?.block) {
        return {
          kind: "immediate",
          result: createErrorToolResult(beforeResult.reason || "Tool execution was blocked"),
          isError: true,
        };
      }
    }
    if (signal?.aborted) {
      return {
        kind: "immediate",
        result: createErrorToolResult("Operation aborted"),
        isError: true,
      };
    }
    return {
      kind: "prepared",
      toolCall,
      tool,
      args: validatedArgs,
      effect,
    };
  } catch (error) {
    return {
      kind: "immediate",
      result: createErrorToolResult(error instanceof Error ? error.message : String(error)),
      isError: true,
    };
  }
}
