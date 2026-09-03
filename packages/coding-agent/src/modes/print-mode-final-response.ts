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
  return messages
    .flatMap((message) => message.content.filter((content) => content.type === "text").map((content) => content.text))
    .join("");
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
    const toolCalls = assistant.content.filter((content) => content.type === "toolCall");
    const call = toolCalls[0];
    if (
      toolCalls.length !== 1 ||
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
  const finishCalls = finishCallMessage.content.filter((content) => content.type === "toolCall");
  const finishText = assistantMessagesText([finishCallMessage]);
  if (
    finishCalls.length !== 1 ||
    finishCalls[0]?.name !== "finish_work" ||
    finishCalls[0].id !== finishResult.toolCallId ||
    finishCalls[0].arguments.status !== "success" ||
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
  if (response.some((candidate) => candidate.content.some((content) => content.type === "toolCall"))) return undefined;
  const text = assistantMessagesText(response);
  return text.trim().length > 0 ? text : undefined;
}
