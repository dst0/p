import { type AssistantMessage, EventStream, validateToolArguments } from "@dst0/p-ai";
import { type CompletionMode, createFinishWorkTool, FINISH_WORK_TOOL_NAME } from "../completion-protocol.ts";
import type { AgentContext, AgentEvent, AgentLoopConfig, AgentMessage, AgentTool, AgentToolCall } from "../types.ts";
import { DEFAULT_COMPLETION_MODE, EMPTY_USAGE } from "./constants.ts";
import type { AgentEventSink, CompletionProtocolState } from "./types.ts";

export function createAgentStream(): EventStream<AgentEvent, AgentMessage[]> {
  return new EventStream<AgentEvent, AgentMessage[]>(
    (event: AgentEvent) => event.type === "agent_end",
    (event: AgentEvent) => (event.type === "agent_end" ? event.messages : []),
  );
}
export function resolveCompletionMode(config: AgentLoopConfig): CompletionMode {
  return config.completionMode ?? DEFAULT_COMPLETION_MODE;
}
export function createCompletionProtocolState(): CompletionProtocolState {
  return {
    turns: 0,
    noProgressTurns: 0,
    consecutiveWaitingTurns: 0,
    malformedToolRetries: 0,
    emptyAssistantRetries: 0,
    missingFinishRetries: 0,
    allowImplicitCompletion: false,
  };
}

export function isCompletionProtocolEnabled(mode: CompletionMode): boolean {
  return mode === "explicit_finish" || mode === "hybrid";
}
export function withCompletionProtocolTools(context: AgentContext, mode: CompletionMode): AgentContext {
  if (!isCompletionProtocolEnabled(mode)) {
    return context;
  }
  const tools = context.tools ?? [];
  return {
    ...context,
    tools: [...tools.filter((tool) => tool.name !== FINISH_WORK_TOOL_NAME), createFinishWorkTool()],
  };
}

export function createTerminalAssistantMessage(
  config: AgentLoopConfig,
  diagnostic: string,
  stopReason: "error" | "aborted",
): AssistantMessage {
  return {
    role: "assistant",
    content: [{ type: "text", text: diagnostic }],
    api: config.model.api,
    provider: config.model.provider,
    model: config.model.id,
    usage: EMPTY_USAGE,
    stopReason,
    errorMessage: diagnostic,
    timestamp: Date.now(),
  };
}

export async function emitAbortedTurn(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  emit: AgentEventSink,
  diagnostic: string,
): Promise<void> {
  const message = createTerminalAssistantMessage(config, diagnostic, "aborted");
  currentContext.messages.push(message);
  newMessages.push(message);
  await emit({ type: "turn_start" });
  await emit({ type: "message_start", message });
  await emit({ type: "message_end", message });
  await emit({ type: "turn_end", message, toolResults: [] });
  await emit({ type: "agent_end", messages: newMessages });
}

export async function emitProtocolFailure(
  currentContext: AgentContext,
  newMessages: AgentMessage[],
  config: AgentLoopConfig,
  emit: AgentEventSink,
  mode: CompletionMode,
  event: "max_turns_without_finish_work" | "no_progress_stop" | "waiting_loop_stop",
  diagnostic: string,
  turnAlreadyStarted: boolean,
): Promise<void> {
  await emit({ type: "completion_protocol", completionMode: mode, event, reason: diagnostic });
  if (!turnAlreadyStarted) {
    await emit({ type: "turn_start" });
  }
  const message = createTerminalAssistantMessage(config, diagnostic, "error");
  currentContext.messages.push(message);
  newMessages.push(message);
  await emit({ type: "message_start", message });
  await emit({ type: "message_end", message });
  await emit({ type: "turn_end", message, toolResults: [] });
  await emit({ type: "agent_end", messages: newMessages });
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
export function getStringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function sanitizeToolCallIdSegment(value: string): string {
  return value.replace(/[^A-Za-z0-9_.:-]+/g, "_").slice(0, 48) || "tool";
}

export function prepareToolCallArguments(tool: AgentTool<any>, toolCall: AgentToolCall): AgentToolCall {
  if (!tool.prepareArguments) {
    return toolCall;
  }
  const preparedArguments = tool.prepareArguments(toolCall.arguments);
  if (preparedArguments === toolCall.arguments) {
    return toolCall;
  }
  return {
    ...toolCall,
    arguments: preparedArguments as Record<string, any>,
  };
}

export function createValidatedWaitCheckToolCall(
  waitToolCall: AgentToolCall,
  tools: AgentTool[] | undefined,
): AgentToolCall | undefined {
  const check = isRecord(waitToolCall.arguments.check) ? waitToolCall.arguments.check : undefined;
  const name = getStringValue(check?.tool);
  const args = isRecord(check?.arguments) ? check.arguments : undefined;
  if (!name || !args || name === "sleep" || name === FINISH_WORK_TOOL_NAME) {
    return undefined;
  }
  const tool = tools?.find((candidate) => candidate.name === name);
  if (!tool) {
    return undefined;
  }
  const toolCall: AgentToolCall = {
    type: "toolCall",
    id: `wait_check_${sanitizeToolCallIdSegment(waitToolCall.id)}`,
    name,
    arguments: args,
  };
  try {
    validateToolArguments(tool, prepareToolCallArguments(tool, toolCall));
  } catch {
    return undefined;
  }
  return toolCall;
}

export function expandWaitCheckToolCalls(message: AssistantMessage, tools: AgentTool[] | undefined): AssistantMessage {
  const expandedContent: AssistantMessage["content"] = [];
  let expanded = false;
  for (const block of message.content) {
    expandedContent.push(block);
    if (block.type !== "toolCall" || block.name !== "sleep") {
      continue;
    }
    const checkToolCall = createValidatedWaitCheckToolCall(block, tools);
    if (!checkToolCall) {
      continue;
    }
    expandedContent.push(checkToolCall);
    expanded = true;
  }
  return expanded ? { ...message, content: expandedContent } : message;
}

export function isClosingMarkdownFence(line: string, opener: string): boolean {
  const match = line.match(/^\s*(```+|~~~+)\s*$/);
  return match !== null && match[1][0] === opener[0] && match[1].length >= opener.length;
}

export function splitMarkdownFenceSegments(value: string): Array<{ fenced: boolean; text: string }> {
  const segments: Array<{ fenced: boolean; text: string }> = [];
  const lines = value.split(/(\r?\n)/);
  let activeFence: string | undefined;
  let text = "";
  for (let index = 0; index < lines.length; index += 2) {
    const line = lines[index] ?? "";
    const lineEnd = lines[index + 1] ?? "";
    const opener = line.match(/^\s*(```+|~~~+)/)?.[1];
    if (!activeFence && opener) {
      if (text) segments.push({ fenced: false, text });
      activeFence = opener;
      text = line + lineEnd;
    } else {
      text += line + lineEnd;
      if (activeFence && isClosingMarkdownFence(line, activeFence)) {
        segments.push({ fenced: true, text });
        activeFence = undefined;
        text = "";
      }
    }
  }
  if (text) segments.push({ fenced: activeFence !== undefined, text });
  return segments;
}

export function normalizeMisplacedToolArguments(value: unknown): Record<string, unknown> {
  if (isRecord(value)) {
    return value;
  }
  if (typeof value !== "string") {
    return {};
  }
  const text = value.trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return {};
  }
  try {
    const parsed = JSON.parse(text) as unknown;
    if (isRecord(parsed)) return parsed;
  } catch {
    return {};
  }
  return {};
}

export function isFullyRecoverableMisplacedToolArguments(body: string): boolean {
  const text = body.trim();
  if (!text) return true;
  const parameterPattern = /<parameter=([A-Za-z0-9_.:-]+)\s*>([\s\S]*?)<\/parameter>/gi;
  if ([...text.matchAll(parameterPattern)].length > 0) {
    return text.replace(parameterPattern, "").trim().length === 0;
  }
  const argumentsMatch = text.match(/^<arguments>\s*([\s\S]*?)\s*<\/arguments>$/i);
  const jsonText = argumentsMatch?.[1]?.trim() ?? text;
  try {
    return isRecord(JSON.parse(jsonText) as unknown);
  } catch {
    return false;
  }
}

export function serializeCanonicalMisplacedToolArguments(value: Record<string, unknown>): string | undefined {
  const output: string[] = [];
  const stack: Array<{ text: string } | { value: unknown }> = [{ value }];
  try {
    while (stack.length > 0) {
      const frame = stack.pop();
      if (!frame) break;
      if ("text" in frame) {
        output.push(frame.text);
        continue;
      }
      if (Array.isArray(frame.value)) {
        output.push("[");
        stack.push({ text: "]" });
        for (let index = frame.value.length - 1; index >= 0; index--) {
          stack.push({ value: frame.value[index] });
          if (index > 0) stack.push({ text: "," });
        }
        continue;
      }
      if (isRecord(frame.value)) {
        const keys = Object.keys(frame.value).sort();
        output.push("{");
        stack.push({ text: "}" });
        for (let index = keys.length - 1; index >= 0; index--) {
          const key = keys[index];
          stack.push({ value: frame.value[key] }, { text: ":" }, { text: JSON.stringify(key) });
          if (index > 0) stack.push({ text: "," });
        }
        continue;
      }
      const encoded = JSON.stringify(frame.value);
      if (encoded === undefined) return undefined;
      output.push(encoded);
    }
    return output.join("");
  } catch {
    return undefined;
  }
}
