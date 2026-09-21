import { type AgentMessage, isFinishWorkToolResult } from "@dst0/p-agent-core";
import type { AssistantMessage } from "@dst0/p-ai";

function isProviderLengthContinuationMessage(message: AgentMessage): boolean {
  return message.role === "user" && message.metadata?.pInternal === "provider_length_continuation";
}

export function getFinalResponseAssistantMessages(messages: readonly AgentMessage[]): AssistantMessage[] {
  let lastAssistantIndex = -1;
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index]?.role === "assistant") {
      lastAssistantIndex = index;
      break;
    }
  }
  if (lastAssistantIndex === -1) return [];

  let responseStart = lastAssistantIndex;
  let cursor = lastAssistantIndex;
  while (cursor >= 1) {
    const continuationMessage = messages[cursor - 1];
    if (continuationMessage?.role === "assistant" && continuationMessage.stopReason === "length") {
      responseStart = cursor - 1;
      cursor = responseStart;
      continue;
    }
    const precedingLengthMessage = messages[cursor - 2];
    if (
      cursor < 2 ||
      !continuationMessage ||
      !isProviderLengthContinuationMessage(continuationMessage) ||
      precedingLengthMessage?.role !== "assistant" ||
      precedingLengthMessage.stopReason !== "length"
    ) {
      break;
    }
    responseStart = cursor - 2;
    cursor = responseStart;
  }

  return messages
    .slice(responseStart, lastAssistantIndex + 1)
    .filter((message): message is AssistantMessage => message.role === "assistant");
}

export function assistantMessagesText(messages: readonly AssistantMessage[]): string {
  let text = "";
  for (let i = 0; i < messages.length; i++) {
    const message = messages[i];
    if (message?.content) {
      for (let j = 0; j < message.content.length; j++) {
        const content = message.content[j];
        if (content?.type === "text") {
          text += content.text;
        }
      }
    }
  }
  return text;
}

function findLastFinishWorkResultIndex(messages: readonly AgentMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (isFinishWorkToolResult(messages[index])) return index;
  }
  return -1;
}

function findMissingFinishRepairIndex(messages: readonly AgentMessage[], beforeIndex: number): number {
  for (let index = beforeIndex - 1; index >= 0; index--) {
    const message = messages[index];
    if (
      message?.role === "user" &&
      message.metadata?.pInternal === "completion_protocol_repair" &&
      message.metadata.completionProtocolRepairReason === "missing_finish_work_or_tool_call"
    ) {
      return index;
    }
  }
  return -1;
}

const MAX_COMPLETION_REPAIR_TOOL_CALLS = 8;
const COMPLETION_REPAIR_TOOLS = new Set(["record_task_verification", "record_requirement_audit", "finish_work"]);

function isVerificationOnlyRepairSequence(messages: readonly AgentMessage[]): boolean {
  if (messages.length < 2 || messages.length > MAX_COMPLETION_REPAIR_TOOL_CALLS * 2 || messages.length % 2 !== 0) {
    return false;
  }
  const seenToolCallIds = new Set<string>();
  for (let index = 0; index < messages.length; index += 2) {
    const assistant = messages[index];
    const result = messages[index + 1];
    if (assistant?.role !== "assistant" || result?.role !== "toolResult") return false;

    let call: any;
    let toolCallCount = 0;
    if (assistant.content) {
      for (let j = 0; j < assistant.content.length; j++) {
        const content = assistant.content[j];
        if (content?.type === "toolCall") {
          if (toolCallCount === 0) call = content;
          toolCallCount++;
        }
      }
    }

    if (
      toolCallCount !== 1 ||
      !call ||
      !COMPLETION_REPAIR_TOOLS.has(call.name) ||
      seenToolCallIds.has(call.id) ||
      result.toolCallId !== call.id ||
      result.toolName !== call.name
    ) {
      return false;
    }
    seenToolCallIds.add(call.id);
    if (call.name === "finish_work") {
      if (assistantMessagesText([assistant]).trim().length > 0) return false;
      const isTerminalPair = index === messages.length - 2;
      if (isTerminalPair !== !result.isError) return false;
    } else if (result.isError) {
      return false;
    }
  }
  return true;
}

export function getRepairedFinalResponse(messages: readonly AgentMessage[]): string | undefined {
  const finishResultIndex = findLastFinishWorkResultIndex(messages);
  const finishResult = messages[finishResultIndex];
  const finishCallMessage = messages[finishResultIndex - 1];
  if (
    finishResultIndex !== messages.length - 1 ||
    !isFinishWorkToolResult(finishResult) ||
    finishResult.isError ||
    finishResult.details?.status !== "success"
  ) {
    return undefined;
  }
  if (finishCallMessage?.role !== "assistant") return undefined;

  let finishCall: any;
  let finishCallCount = 0;
  if (finishCallMessage.content) {
    for (let i = 0; i < finishCallMessage.content.length; i++) {
      const content = finishCallMessage.content[i];
      if (content?.type === "toolCall") {
        if (finishCallCount === 0) finishCall = content;
        finishCallCount++;
      }
    }
  }

  const finishText = assistantMessagesText([finishCallMessage]);
  if (
    finishCallCount !== 1 ||
    finishCall?.name !== "finish_work" ||
    finishCall.id !== finishResult.toolCallId ||
    finishCall.arguments.status !== "success" ||
    finishText.trim().length > 0
  ) {
    return undefined;
  }
  const repairIndex = findMissingFinishRepairIndex(messages, finishResultIndex - 1);
  if (
    repairIndex === -1 ||
    messages[repairIndex - 1]?.role !== "assistant" ||
    !isVerificationOnlyRepairSequence(messages.slice(repairIndex + 1, finishResultIndex + 1))
  ) {
    return undefined;
  }
  const response = getFinalResponseAssistantMessages(messages.slice(0, repairIndex));

  let hasToolCall = false;
  for (let i = 0; i < response.length; i++) {
    const candidate = response[i];
    if (candidate?.content) {
      for (let j = 0; j < candidate.content.length; j++) {
        if (candidate.content[j]?.type === "toolCall") {
          hasToolCall = true;
          break;
        }
      }
    }
    if (hasToolCall) break;
  }
  if (hasToolCall) return undefined;

  const text = assistantMessagesText(response);
  return text.trim().length > 0 ? text : undefined;
}
